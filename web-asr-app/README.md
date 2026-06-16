# Web ASR App

这是一个可独立分发的浏览器端实时语音转文字应用。

## 运行要求

- Node.js 18 或更高版本
- Chrome / Edge 等现代浏览器
- 浏览器允许麦克风权限

不需要安装 npm 依赖。

## 启动

```bash
npm start
```

默认访问：

```text
http://localhost:6006
```

如需修改端口：

```bash
PORT=7000 npm start
```

## 目录结构

```text
web-asr-app/
├── package.json
├── server.js
├── check-runtime.js
├── README.md
└── public/
    ├── index.html
    ├── src/
    │   ├── main.js
    │   └── styles.css
    ├── sherpa-onnx/
    │   ├── sherpa-onnx-asr.js
    │   ├── sherpa-onnx-wasm-main-asr.js
    │   ├── sherpa-onnx-wasm-main-asr.wasm
    │   └── sherpa-onnx-wasm-main-asr.data
```

## 说明

页面打开后不会自动加载模型；点击“初始化模型”后才会加载 WASM 和模型资源。状态变为“模型已就绪”后，点击“开始识别”即可请求麦克风权限并开始实时转写。

`sherpa-onnx-wasm-main-asr.data` 是构建时生成的预加载资源包，里面包含浏览器运行需要的 ASR 模型资源。不要删除它。

如果要发给别人，只需要发送整个 `web-asr-app` 目录。
