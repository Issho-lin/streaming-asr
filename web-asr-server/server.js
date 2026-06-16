const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const sherpa_onnx = require('sherpa-onnx-node');

// ============ 配置 ============
const PORT = process.env.PORT || 6006;
const MODEL_DIR = process.env.MODEL_DIR || path.join(__dirname, 'models', 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20');

const RECOGNIZER_CONFIG = {
  featConfig: {
    sampleRate: 16000,
    featureDim: 80,
  },
  modelConfig: {
    transducer: {
      encoder: path.join(MODEL_DIR, 'encoder-epoch-99-avg-1.onnx'),
      decoder: path.join(MODEL_DIR, 'decoder-epoch-99-avg-1.onnx'),
      joiner: path.join(MODEL_DIR, 'joiner-epoch-99-avg-1.onnx'),
    },
    tokens: path.join(MODEL_DIR, 'tokens.txt'),
    numThreads: 2,
    provider: 'cpu',
    debug: 0,
  },
  enableEndpoint: true,
  rule1MinTrailingSilence: 2.4,
  rule2MinTrailingSilence: 1.2,
  rule3MinUtteranceLength: 20,
};

// ============ 验证模型文件 ============
function validateModelFiles() {
  const files = [
    RECOGNIZER_CONFIG.modelConfig.transducer.encoder,
    RECOGNIZER_CONFIG.modelConfig.transducer.decoder,
    RECOGNIZER_CONFIG.modelConfig.transducer.joiner,
    RECOGNIZER_CONFIG.modelConfig.tokens,
  ];

  for (const file of files) {
    if (!fs.existsSync(file)) {
      console.error(`模型文件不存在: ${file}`);
      console.error(`\n请先下载模型:\n  npm run download-model\n`);
      process.exit(1);
    }
  }
}

// ============ 静态文件服务 ============
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// ============ 主逻辑 ============
validateModelFiles();

console.log('正在加载模型...');
const recognizer = new sherpa_onnx.OnlineRecognizer(RECOGNIZER_CONFIG);
console.log('模型加载完成');

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('新客户端连接');

  const stream = recognizer.createStream();
  let lastText = '';

  ws.on('message', (data, isBinary) => {
    if (!isBinary) {
      // 文本消息用于控制信令
      const msg = data.toString();
      if (msg === 'done') {
        // 客户端发送结束信号，添加尾部静音以触发 endpoint
        const tailPadding = new Float32Array(16000 * 0.5);
        stream.acceptWaveform({ sampleRate: 16000, samples: tailPadding });
      }
      return;
    }

    // 二进制消息：PCM 音频数据 (Int16LE)
    const int16Array = new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }

    stream.acceptWaveform({ sampleRate: 16000, samples: float32Array });

    while (recognizer.isReady(stream)) {
      recognizer.decode(stream);
    }

    const result = recognizer.getResult(stream);
    const text = typeof result === 'string' ? result : result.text;

    if (text && text !== lastText) {
      lastText = text;
      ws.send(JSON.stringify({ type: 'partial', text }));
    }

    if (recognizer.isEndpoint(stream)) {
      if (lastText) {
        ws.send(JSON.stringify({ type: 'final', text: lastText }));
      }
      recognizer.reset(stream);
      lastText = '';
    }
  });

  ws.on('close', () => {
    // 连接关闭时输出最后的结果
    if (lastText) {
      ws.send(JSON.stringify({ type: 'final', text: lastText }));
    }
    console.log('客户端断开连接');
  });

  ws.on('error', (err) => {
    console.error('WebSocket 错误:', err.message);
  });

  // 通知客户端已就绪
  ws.send(JSON.stringify({ type: 'ready' }));
});

server.listen(PORT, () => {
  console.log(`服务器已启动: http://localhost:${PORT}`);
  console.log(`WebSocket 地址: ws://localhost:${PORT}/ws`);
});
