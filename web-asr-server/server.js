const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Busboy = require('busboy');
const ffmpegPath = require('ffmpeg-static');
const { WebSocketServer } = require('ws');
const sherpa_onnx = require('sherpa-onnx-node');

// ============ 配置 ============
const PORT = process.env.PORT || 6006;
const SAMPLE_RATE = 16000;
const UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024;
const TAIL_PADDING_SECONDS = 0.5;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MODEL_DIR = process.env.MODEL_DIR || path.join(__dirname, 'models', 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20');
const SUPPORTED_UPLOAD_EXTENSIONS = new Set(['.wav', '.mp3', '.m4a']);

const RECOGNIZER_CONFIG = {
  featConfig: {
    sampleRate: SAMPLE_RATE,
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

function validateEnvironment() {
  if (!ffmpegPath) {
    console.error('未找到 ffmpeg 可执行文件，无法支持 wav/mp3/m4a 上传转写');
    process.exit(1);
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
  const requestPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relativePath);

  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

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

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function getRecognizerText(result) {
  if (typeof result === 'string') {
    return result;
  }

  return result && typeof result.text === 'string' ? result.text : '';
}

function int16BufferToFloat32(buffer) {
  const sampleCount = Math.floor(buffer.length / 2);
  const samples = new Float32Array(sampleCount);

  for (let i = 0; i < sampleCount; i += 1) {
    samples[i] = buffer.readInt16LE(i * 2) / 32768.0;
  }

  return samples;
}

function decodePendingFrames(stream) {
  while (recognizer.isReady(stream)) {
    recognizer.decode(stream);
  }
}

function tailPaddingSamples() {
  return new Float32Array(SAMPLE_RATE * TAIL_PADDING_SECONDS);
}

function feedRecognizer(stream, samples) {
  stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples });
  decodePendingFrames(stream);

  return {
    text: getRecognizerText(recognizer.getResult(stream)),
    endpoint: recognizer.isEndpoint(stream),
  };
}

function transcribeFloat32Samples(samples) {
  const stream = recognizer.createStream();
  const chunkSize = SAMPLE_RATE;
  let lastText = '';

  for (let offset = 0; offset < samples.length; offset += chunkSize) {
    const chunk = samples.subarray(offset, offset + chunkSize);
    const { text } = feedRecognizer(stream, chunk);
    if (text) {
      lastText = text;
    }
  }

  const finalPass = feedRecognizer(stream, tailPaddingSamples());
  if (finalPass.text) {
    lastText = finalPass.text;
  }

  if (finalPass.endpoint) {
    recognizer.reset(stream);
  }

  return lastText.trim();
}

async function transcodeAudioToPcm(filePath) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let stderr = '';

    const ffmpeg = spawn(ffmpegPath, [
      '-v', 'error',
      '-i', filePath,
      '-f', 's16le',
      '-acodec', 'pcm_s16le',
      '-ac', '1',
      '-ar', String(SAMPLE_RATE),
      'pipe:1',
    ]);

    ffmpeg.stdout.on('data', (chunk) => {
      chunks.push(chunk);
    });

    ffmpeg.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    ffmpeg.on('error', (err) => {
      reject(err);
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || 'ffmpeg 转码失败'));
        return;
      }

      resolve(Buffer.concat(chunks));
    });
  });
}

async function transcribeAudioFile(filePath) {
  const pcmBuffer = await transcodeAudioToPcm(filePath);

  if (pcmBuffer.length === 0) {
    throw new Error('音频转码结果为空，请检查上传文件是否有效');
  }

  return transcribeFloat32Samples(int16BufferToFloat32(pcmBuffer));
}

async function removeDirectory(dirPath) {
  if (!dirPath) {
    return;
  }

  await fs.promises.rm(dirPath, { recursive: true, force: true });
}

async function parseMultipartAudioUpload(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      reject(new Error('请求必须使用 multipart/form-data，并通过 file 字段上传音频'));
      return;
    }

    const busboy = Busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fileSize: UPLOAD_LIMIT_BYTES,
      },
    });

    let tempDir = '';
    let uploadFilePath = '';
    let uploadError = null;
    let fileSeen = false;
    let fileTooLarge = false;
    let fileWritePromise = Promise.resolve();

    const cleanup = async () => {
      await removeDirectory(tempDir);
    };

    busboy.on('file', (fieldname, file, info) => {
      if (fieldname !== 'file' || fileSeen) {
        file.resume();
        return;
      }

      fileSeen = true;
      const originalName = path.basename(info.filename || 'audio');
      const extension = path.extname(originalName).toLowerCase();

      if (!SUPPORTED_UPLOAD_EXTENSIONS.has(extension)) {
        uploadError = new Error('仅支持 wav/mp3/m4a 文件上传');
        file.resume();
        return;
      }

      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-asr-upload-'));
      uploadFilePath = path.join(tempDir, `source${extension}`);
      const output = fs.createWriteStream(uploadFilePath);

      file.on('limit', () => {
        fileTooLarge = true;
      });

      fileWritePromise = new Promise((resolveWrite, rejectWrite) => {
        output.on('finish', resolveWrite);
        output.on('error', rejectWrite);
        file.on('error', rejectWrite);
      });

      file.pipe(output);
    });

    busboy.on('error', async (err) => {
      await cleanup();
      reject(err);
    });

    busboy.on('finish', async () => {
      try {
        await fileWritePromise;

        if (uploadError) {
          throw uploadError;
        }

        if (fileTooLarge) {
          throw new Error(`音频文件过大，限制 ${Math.floor(UPLOAD_LIMIT_BYTES / 1024 / 1024)}MB`);
        }

        if (!fileSeen || !uploadFilePath) {
          throw new Error('未收到音频文件，请通过 file 字段上传 wav/mp3/m4a');
        }

        resolve({
          filePath: uploadFilePath,
          cleanup,
        });
      } catch (err) {
        await cleanup();
        reject(err);
      }
    });

    req.pipe(busboy);
  });
}

async function handleTranscribe(req, res) {
  let upload;

  try {
    upload = await parseMultipartAudioUpload(req);
    const text = await transcribeAudioFile(upload.filePath);

    sendJson(res, 200, {
      success: true,
      text,
    });
  } catch (err) {
    const statusCode = err.message.includes('multipart/form-data')
      || err.message.includes('仅支持')
      || err.message.includes('未收到音频文件')
      || err.message.includes('过大')
      ? 400
      : 500;

    sendJson(res, statusCode, {
      success: false,
      error: err.message,
    });
  } finally {
    if (upload) {
      await upload.cleanup();
    }
  }
}

async function handleRequest(req, res) {
  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, {
      status: 'ok',
      sampleRate: SAMPLE_RATE,
      uploadFormats: Array.from(SUPPORTED_UPLOAD_EXTENSIONS).map((ext) => ext.slice(1)),
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/transcribe') {
    await handleTranscribe(req, res);
    return;
  }

  serveStatic(req, res);
}

// ============ 主逻辑 ============
validateModelFiles();
validateEnvironment();

console.log('正在加载模型...');
const recognizer = new sherpa_onnx.OnlineRecognizer(RECOGNIZER_CONFIG);
console.log('模型加载完成');

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error('请求处理失败:', err);
    sendJson(res, 500, {
      success: false,
      error: '服务器内部错误',
    });
  });
});
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('新客户端连接');

  const stream = recognizer.createStream();
  let lastText = '';

  const processSamples = (samples) => {
    const { text, endpoint } = feedRecognizer(stream, samples);

    if (text && text !== lastText) {
      lastText = text;
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'partial', text }));
      }
    }

    if (endpoint) {
      if (lastText && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'final', text: lastText }));
      }
      recognizer.reset(stream);
      lastText = '';
    }
  };

  ws.on('message', (data, isBinary) => {
    if (!isBinary) {
      // 文本消息用于控制信令
      const msg = data.toString();
      if (msg === 'done') {
        // 客户端发送结束信号，添加尾部静音以触发 endpoint
        processSamples(tailPaddingSamples());
      }
      return;
    }

    // 二进制消息：PCM 音频数据 (Int16LE)
    const int16Array = new Int16Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 2));
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i += 1) {
      float32Array[i] = int16Array[i] / 32768.0;
    }

    processSamples(float32Array);
  });

  ws.on('close', () => {
    console.log('客户端断开连接');
  });

  ws.on('error', (err) => {
    console.error('WebSocket 错误:', err.message);
  });

  // 通知客户端已就绪
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'ready' }));
  }
});

server.listen(PORT, () => {
  console.log(`服务器已启动: http://localhost:${PORT}`);
  console.log(`WebSocket 地址: ws://localhost:${PORT}/ws`);
  console.log(`文件上传接口: http://localhost:${PORT}/api/transcribe`);
});
