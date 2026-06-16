# Streaming ASR

实时流式语音识别（ASR）项目，提供浏览器端和服务端两种方案。

## 项目结构

```text
streaming-asr/
├── web-asr-app/       # 浏览器端方案：WASM 本地识别，无需服务端算力
├── web-asr-server/    # 服务端方案：WebSocket 流式传输，服务端识别
├── model/             # 本地模型文件
├── sherpa-onnx/       # sherpa-onnx 源码（WASM 编译用）
└── emsdk/             # Emscripten SDK（WASM 编译工具链）
```

## 方案对比

| 特性 | web-asr-app | web-asr-server |
|------|-------------|----------------|
| 识别位置 | 浏览器端（WASM） | 服务端（Node.js） |
| 网络依赖 | 仅加载页面时需要 | 持续 WebSocket 连接 |
| 服务端算力 | 不需要 | 需要 |
| 模型 | zipformer 中文 | zipformer 中英双语 |
| 依赖安装 | 无需 npm install | 需要 npm install |

## 快速开始

### 方案一：浏览器端识别（web-asr-app）

```bash
cd web-asr-app
npm start
```

访问 http://localhost:6006

### 方案二：服务端识别（web-asr-server）

```bash
cd web-asr-server
npm install
npm run download-model
npm start
```

访问 http://localhost:6006
