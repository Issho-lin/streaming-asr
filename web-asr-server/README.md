# Web ASR Server

服务端实时流式语音转文字 Web 应用。

## 特性

- **服务端识别**：使用 Node.js + sherpa-onnx 在服务端进行语音识别
- **真流式传输**：浏览器麦克风音频通过 WebSocket 实时传输到服务端
- **实时反馈**：流式返回识别中间结果和最终结果
- **文件上传转写**：支持通过 HTTP 上传 `wav`、`mp3`、`m4a` 音频并返回整段文本
- **中英双语**：支持中文和英文混合识别
- **端点检测**：自动检测句子结束，分句输出

## 技术栈

- **后端**：Node.js + WebSocket (ws) + sherpa-onnx-node
- **音频转码**：ffmpeg-static
- **前端**：原生 JavaScript + WebSocket API + Web Audio API
- **模型**：sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20（Transducer 流式模型）

## 运行要求

- Node.js 16 或更高版本
- Chrome / Edge 等现代浏览器
- 浏览器允许麦克风权限
- 约 200MB 磁盘空间（包含模型文件）

## 快速开始

### 1. 安装依赖

```bash
cd web-asr-server
npm install
```

### 2. 下载模型

```bash
npm run download-model
```

模型会自动下载到 `models/` 目录（约 70MB）。

### 3. 启动服务

```bash
npm start
```

默认访问地址：

```
http://localhost:6006
```

自定义端口：

```bash
PORT=8080 npm start
```

### 4. 使用

1. 打开浏览器访问 `http://localhost:6006`
2. 允许麦克风权限
3. 点击"开始识别"按钮
4. 对着麦克风说话
5. 实时查看识别结果

## API 接口

### 1. 健康检查

```bash
curl http://localhost:6006/health
```

返回示例：

```json
{
  "status": "ok",
  "sampleRate": 16000,
  "uploadFormats": ["wav", "mp3", "m4a"]
}
```

### 2. HTTP 文件上传转写

请求：

```bash
curl -X POST http://localhost:6006/api/transcribe \
  -F "file=@/path/to/audio.mp3"
```

支持格式：

- `wav`
- `mp3`
- `m4a`

返回示例：

```json
{
  "success": true,
  "text": "你好，这是识别结果"
}
```

失败示例：

```json
{
  "success": false,
  "error": "仅支持 wav/mp3/m4a 文件上传"
}
```

说明：

- 上传字段名固定为 `file`
- 服务端会先把音频统一转成 `16kHz / 单声道 / PCM` 再识别
- 默认上传大小限制为 `25MB`

### 3. WebSocket 流式识别

连接地址：

```text
ws://localhost:6006/ws
```

客户端发送：

- 二进制消息：`Int16LE PCM` 音频帧，`16kHz`、单声道
- 文本消息：`done`，表示当前音频输入结束

服务端返回：

```json
{"type":"ready"}
{"type":"partial","text":"你好"}
{"type":"final","text":"你好世界"}
```

## 目录结构

```
web-asr-server/
├── package.json              # 项目配置
├── server.js                 # 后端服务器（WebSocket + HTTP）
├── scripts/
│   └── download-model.js     # 模型下载脚本
├── public/
│   ├── index.html            # 前端页面
│   └── src/
│       ├── main.js           # 前端逻辑（录音 + WebSocket 通信）
│       └── styles.css        # 样式
└── models/                   # 模型文件目录（自动生成）
    └── sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/
        ├── encoder-epoch-99-avg-1.onnx
        ├── decoder-epoch-99-avg-1.onnx
        ├── joiner-epoch-99-avg-1.onnx
        └── tokens.txt
```

## 工作原理

### 前端流程

1. 浏览器通过 `getUserMedia` 获取麦克风音频流
2. 使用 `AudioContext` 和 `ScriptProcessorNode` 处理音频
3. 将音频降采样到 16kHz，转换为 Int16 PCM 格式
4. 通过 WebSocket 实时发送二进制音频数据到服务端
5. 接收服务端返回的 JSON 格式识别结果

### 后端流程

1. 加载 sherpa-onnx 流式识别模型（OnlineRecognizer）
2. 监听 WebSocket 连接（路径：`/ws`）
3. 为每个连接创建独立的识别流（stream）
4. 接收客户端发送的 PCM 音频帧
5. 调用 `acceptWaveform` 喂入音频数据
6. 调用 `decode` 进行解码
7. 通过 `getResult` 获取中间识别结果，实时推送给客户端
8. 通过 `isEndpoint` 检测句子结束，输出最终结果并重置流

### 协议格式

**客户端 → 服务端**：
- 二进制消息：Int16LE PCM 音频数据（16kHz，单声道）
- 文本消息 `"done"`：表示音频输入结束

**服务端 → 客户端**（JSON）：
```json
{"type": "ready"}                    // 连接就绪
{"type": "partial", "text": "你好"}   // 中间结果
{"type": "final", "text": "你好世界"} // 最终结果
```

## 自定义配置

### 更换模型

修改 [`server.js`](file:///Users/linqibin/Documents/code/agents/streaming-asr/web-asr-server/server.js#L9-L10) 中的 `MODEL_DIR` 和 `RECOGNIZER_CONFIG`：

```javascript
const MODEL_DIR = path.join(__dirname, 'models', '你的模型目录');

const RECOGNIZER_CONFIG = {
  featConfig: {
    sampleRate: 16000,
    featureDim: 80,
  },
  modelConfig: {
    transducer: {
      encoder: path.join(MODEL_DIR, 'encoder.onnx'),
      decoder: path.join(MODEL_DIR, 'decoder.onnx'),
      joiner: path.join(MODEL_DIR, 'joiner.onnx'),
    },
    tokens: path.join(MODEL_DIR, 'tokens.txt'),
    numThreads: 2,
    provider: 'cpu',
  },
  // 其他配置...
};
```

支持的模型架构：
- **Transducer (RNN-T)**：推荐，低延迟，适合实时流式
- **Paraformer**：准确度高
- **Zipformer-CTC**：轻量级

可用模型列表：https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models

### 端点检测参数

修改 [`server.js`](file:///Users/linqibin/Documents/code/agents/streaming-asr/web-asr-server/server.js#L27-L30) 中的端点检测规则：

```javascript
enableEndpoint: true,
rule1MinTrailingSilence: 2.4,  // 规则1：尾部静音时长（秒）
rule2MinTrailingSilence: 1.2,  // 规则2：尾部静音时长（秒）
rule3MinUtteranceLength: 20,   // 规则3：最短话语长度（秒）
```

## 与浏览器端版本的对比

| 特性 | 浏览器端版 (web-asr-app) | 服务端版 (web-asr-server) |
|------|-------------------------|--------------------------|
| 识别位置 | 浏览器 WASM | 服务端 Node.js |
| 模型加载 | 每个客户端独立加载 | 服务端统一加载 |
| 网络流量 | 仅模型下载（一次性） | 持续音频流传输 |
| 性能 | 依赖客户端性能 | 依赖服务器性能 |
| 延迟 | 低（本地计算） | 稍高（网络传输） |
| 并发支持 | 每个客户端独立 | 服务端批处理 |
| 离线可用 | 是（模型缓存后） | 否 |
| 适用场景 | 单用户、注重隐私 | 多用户、集中管理 |

## 常见问题

### 1. 安装 `sherpa-onnx-node` 失败

sherpa-onnx-node 包含原生模块，需要编译环境：

- macOS：安装 Xcode Command Line Tools
- Linux：安装 build-essential、python3
- Windows：安装 Visual Studio Build Tools

### 2. 麦克风无法访问

- 确保浏览器已授权麦克风权限
- HTTPS 环境下才能访问麦克风（本地 localhost 除外）
- 检查系统麦克风设置

### 3. 识别结果不准确

- 确保麦克风音质良好
- 尽量减少环境噪音
- 调整 `enableEndpoint` 参数
- 尝试更换识别模型

## 参考资料

- [sherpa-onnx 官方文档](https://k2-fsa.github.io/sherpa/onnx/)
- [sherpa-onnx WebSocket 文档](https://csukuangfj.github.io/sherpa/onnx/websocket/online-websocket.html)
- [预训练模型列表](https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models)
- [sherpa-onnx-node npm 包](https://www.npmjs.com/package/sherpa-onnx-node)

## 许可证

本项目遵循 MIT 许可证。

sherpa-onnx 模型和库遵循各自的许可证，详见官方仓库。
