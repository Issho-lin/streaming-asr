# sherpa-onnx WebAssembly 浏览器端实时语音转文字接入指南

本文档说明如何从 sherpa-onnx 模型构建 WebAssembly 运行时，并将其集成到任意前端项目中，例如原生 HTML、Vue、React、Vite、Next.js 等。

---

## 1. 准备模型文件

需要一个 sherpa-onnx 支持的流式 ASR 模型，例如：

### 1.1 模型下载地址
https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models?utm_source=chatgpt.com

```text
sherpa-onnx-streaming-zipformer-zh-fp16-2025-06-30/
├── encoder.fp16.onnx
├── decoder.fp16.onnx
├── joiner.fp16.onnx
└── tokens.txt
```

浏览器端构建时需要把它们重命名为：

```text
encoder.onnx
decoder.onnx
joiner.onnx
tokens.txt
```

---

## 2. 获取 sherpa-onnx 源码

```bash
git clone https://github.com/k2-fsa/sherpa-onnx
cd sherpa-onnx
```

---

## 3. 安装 WebAssembly 构建工具

### 3.1 安装 Emscripten

sherpa-onnx 的 WASM 构建依赖 `emcc`。

```bash
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install 4.0.23
./emsdk activate 4.0.23
source ./emsdk_env.sh
```

确认：

```bash
emcc --version
```

### 3.2 安装 CMake

构建脚本还需要 `cmake`。

```bash
cmake --version
```

如果没有，macOS 可以先尝试安装 Homebrew 的 core 版本：

```bash
HOMEBREW_NO_AUTO_UPDATE=1 brew install homebrew/core/cmake
```

如果遇到 Homebrew 自动更新很慢，`HOMEBREW_NO_AUTO_UPDATE=1` 可以跳过本次自动更新。

如果遇到类似下面的 cask 报错：

```text
Cask 'cmake' definition is invalid: 'conflicts_with' stanza failed with: Unknown key: :formula
```

说明本地 Homebrew / cask 定义可能不兼容，可以改用 CMake 官方安装包安装：

```text
https://cmake.org/download/
```

安装完成后重新确认：

```bash
cmake --version
```

能正常输出版本号后，再继续执行 sherpa-onnx 的 WASM 构建脚本。

---

## 4. 放置模型到 sherpa-onnx WASM assets 目录

把模型解压复制到：

```text
sherpa-onnx/wasm/asr/assets/
```

并重命名：

```bash
cp model/xxx/encoder.fp16.onnx sherpa-onnx/wasm/asr/assets/encoder.onnx
cp model/xxx/decoder.fp16.onnx sherpa-onnx/wasm/asr/assets/decoder.onnx
cp model/xxx/joiner.fp16.onnx sherpa-onnx/wasm/asr/assets/joiner.onnx
cp model/xxx/tokens.txt sherpa-onnx/wasm/asr/assets/tokens.txt
```

这一步很关键。sherpa-onnx WASM 构建时会把 `assets` 里的模型打包进 `.data` 文件。

---

## 5. 构建 sherpa-onnx WebAssembly ASR

进入 sherpa-onnx 源码目录：

```bash
cd sherpa-onnx
./build-wasm-simd-asr.sh
```

成功后会生成：

```text
sherpa-onnx/build-wasm-simd-asr/install/bin/wasm/asr/
├── app-asr.js
├── index.html
├── sherpa-onnx-asr.js
├── sherpa-onnx-wasm-main-asr.js
├── sherpa-onnx-wasm-main-asr.wasm
└── sherpa-onnx-wasm-main-asr.data
```

核心产物是：

```text
sherpa-onnx-asr.js
sherpa-onnx-wasm-main-asr.js
sherpa-onnx-wasm-main-asr.wasm
sherpa-onnx-wasm-main-asr.data
```

---

## 6. 准备给前端项目使用的运行时目录

在你的前端项目中，建议放到静态资源目录。

### 原生 HTML / Vite / Vue / React / Next.js / Nuxt

```text
public/sherpa-onnx/
├── sherpa-onnx-asr.js
├── sherpa-onnx-wasm-main-asr.js
├── sherpa-onnx-wasm-main-asr.wasm
└── sherpa-onnx-wasm-main-asr.data
```

部署后它们应该能通过 URL 访问：

```text
/sherpa-onnx/sherpa-onnx-asr.js
/sherpa-onnx/sherpa-onnx-wasm-main-asr.js
/sherpa-onnx/sherpa-onnx-wasm-main-asr.wasm
/sherpa-onnx/sherpa-onnx-wasm-main-asr.data
```

---

## 7. 前端项目如何接入

### 7.1 核心接入思路

浏览器端集成分为四步：

```text
加载 sherpa-onnx JS API
加载 sherpa-onnx WASM runtime
创建 OnlineRecognizer
采集麦克风音频并流式送入 recognizer
```

建议封装成框架无关模块，例如：

```text
src/asr/SherpaStreamingAsr.js
```

然后 Vue、React、原生 HTML 都调用这个模块。

---

## 8. 通用 JS 封装

### 8.1 动态加载脚本

```js
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existed = document.querySelector(`script[src="${src}"]`);
    if (existed) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`无法加载 ${src}`));
    document.body.appendChild(script);
  });
}
```

### 8.2 初始化 sherpa-onnx WASM

```js
let moduleInstance = null;

async function initSherpaRuntime(wasmBaseUrl = '/sherpa-onnx') {
  await loadScript(`${wasmBaseUrl}/sherpa-onnx-asr.js`);

  globalThis.Module = {
    locateFile(path, scriptDirectory = '') {
      if (path.endsWith('.wasm') || path.endsWith('.data')) {
        return `${wasmBaseUrl}/${path}`;
      }

      return scriptDirectory + path;
    },

    setStatus(status) {
      // 可选：映射 Emscripten 状态到你的 UI
      // 例如：Downloading data... / Running...
    },

    onRuntimeInitialized() {
      moduleInstance = globalThis.Module;
    },
  };

  await loadScript(`${wasmBaseUrl}/sherpa-onnx-wasm-main-asr.js`);

  await new Promise((resolve) => {
    const timer = window.setInterval(() => {
      if (moduleInstance || globalThis.Module?.calledRun) {
        window.clearInterval(timer);
        moduleInstance = globalThis.Module;
        resolve();
      }
    }, 50);
  });

  return moduleInstance;
}
```

### 8.3 创建 OnlineRecognizer

如果模型已按 1–6 步打进 `.data` 文件，直接使用默认配置：

```js
function createSherpaRecognizer(moduleInstance) {
  if (!globalThis.createOnlineRecognizer) {
    throw new Error('createOnlineRecognizer 不存在，请确认 sherpa-onnx-asr.js 是否已加载');
  }

  const recognizer = globalThis.createOnlineRecognizer(moduleInstance);
  const stream = recognizer.createStream();

  return {
    recognizer,
    stream,
  };
}
```

不要传不完整 config，例如：

```js
createOnlineRecognizer(moduleInstance, {
  sampleRate: 16000,
});
```

这可能覆盖默认配置，导致：

```text
Cannot use 'in' operator to search for 'transducer' in undefined
```

---

## 9. 通用 ASR 类

```js
export class SherpaStreamingAsr {
  constructor(options = {}) {
    this.wasmBaseUrl = options.wasmBaseUrl || '/sherpa-onnx';
    this.sampleRate = 16000;

    this.module = null;
    this.recognizer = null;
    this.stream = null;

    this.audioContext = null;
    this.mediaStream = null;
    this.sourceNode = null;
    this.processorNode = null;

    this.lastPartial = '';
    this.onPartial = options.onPartial || (() => {});
    this.onFinal = options.onFinal || (() => {});
    this.onStatus = options.onStatus || (() => {});
  }

  async init() {
    this.onStatus('loading');

    this.module = await initSherpaRuntime(this.wasmBaseUrl);

    this.onStatus('creating');

    const { recognizer, stream } = createSherpaRecognizer(this.module);
    this.recognizer = recognizer;
    this.stream = stream;

    this.onStatus('ready');
  }

  async start() {
    if (!this.recognizer || !this.stream) {
      await this.init();
    }

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.audioContext = new AudioContext();
    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processorNode.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const samples = this.downsampleTo16k(input, this.audioContext.sampleRate);
      this.decode(samples);
    };

    this.sourceNode.connect(this.processorNode);
    this.processorNode.connect(this.audioContext.destination);

    this.onStatus('recording');
  }

  async stop() {
    this.processorNode?.disconnect();
    this.sourceNode?.disconnect();
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    await this.audioContext?.close();

    this.processorNode = null;
    this.sourceNode = null;
    this.mediaStream = null;
    this.audioContext = null;

    if (this.lastPartial) {
      this.onFinal(this.lastPartial);
      this.lastPartial = '';
    }

    this.onStatus('ready');
  }

  decode(samples) {
    this.stream.acceptWaveform(this.sampleRate, samples);

    while (this.recognizer.isReady(this.stream)) {
      this.recognizer.decode(this.stream);
    }

    const result = this.recognizer.getResult(this.stream);
    const text = typeof result === 'string' ? result : result.text;

    if (text && text !== this.lastPartial) {
      this.lastPartial = text;
      this.onPartial(text);
    }

    if (this.recognizer.isEndpoint(this.stream)) {
      if (this.lastPartial) {
        this.onFinal(this.lastPartial);
      }

      this.recognizer.reset(this.stream);
      this.lastPartial = '';
      this.onPartial('');
    }
  }

  downsampleTo16k(input, inputSampleRate) {
    if (inputSampleRate === this.sampleRate) return input;

    const ratio = inputSampleRate / this.sampleRate;
    const outputLength = Math.floor(input.length / ratio);
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i += 1) {
      output[i] = input[Math.floor(i * ratio)];
    }

    return output;
  }
}
```

---

## 10. 原生 HTML 接入示例

```html
<button id="init">初始化模型</button>
<button id="start">开始识别</button>
<button id="stop">停止识别</button>

<div id="status">等待初始化</div>
<div id="partial"></div>
<div id="final"></div>

<script type="module">
  import { SherpaStreamingAsr } from './SherpaStreamingAsr.js';

  const asr = new SherpaStreamingAsr({
    wasmBaseUrl: '/sherpa-onnx',
    onStatus(status) {
      document.querySelector('#status').textContent = status;
    },
    onPartial(text) {
      document.querySelector('#partial').textContent = text;
    },
    onFinal(text) {
      document.querySelector('#final').textContent += `${text}\n`;
    },
  });

  document.querySelector('#init').onclick = () => asr.init();
  document.querySelector('#start').onclick = () => asr.start();
  document.querySelector('#stop').onclick = () => asr.stop();
</script>
```

---

## 11. Vue 项目接入示例

### 11.1 放置静态资源

Vite + Vue 项目中：

```text
public/sherpa-onnx/
```

访问路径：

```js
'/sherpa-onnx'
```

### 11.2 封装 composable

```js
// src/composables/useSherpaAsr.js
import { ref } from 'vue';
import { SherpaStreamingAsr } from '@/asr/SherpaStreamingAsr';

export function useSherpaAsr() {
  const status = ref('idle');
  const partialText = ref('');
  const finalText = ref('');

  const asr = new SherpaStreamingAsr({
    wasmBaseUrl: '/sherpa-onnx',
    onStatus(value) {
      status.value = value;
    },
    onPartial(text) {
      partialText.value = text;
    },
    onFinal(text) {
      finalText.value += `${text}\n`;
    },
  });

  return {
    status,
    partialText,
    finalText,
    init: () => asr.init(),
    start: () => asr.start(),
    stop: () => asr.stop(),
  };
}
```

### 11.3 Vue 组件中使用

```vue
<script setup>
import { computed } from 'vue';
import { useSherpaAsr } from '@/composables/useSherpaAsr';

const {
  status,
  partialText,
  finalText,
  init,
  start,
  stop,
} = useSherpaAsr();

const statusText = computed(() => {
  const map = {
    idle: '等待初始化',
    loading: '正在加载 WASM 和模型',
    creating: '正在创建识别器',
    ready: '模型已就绪',
    recording: '正在识别',
    error: '初始化失败',
  };

  return map[status.value] || status.value;
});
</script>

<template>
  <section>
    <p>{{ statusText }}</p>

    <button @click="init" :disabled="status !== 'idle' && status !== 'error'">
      初始化模型
    </button>

    <button @click="start" :disabled="status !== 'ready'">
      开始识别
    </button>

    <button @click="stop" :disabled="status !== 'recording'">
      停止识别
    </button>

    <h3>实时结果</h3>
    <p>{{ partialText }}</p>

    <h3>最终文本</h3>
    <pre>{{ finalText }}</pre>
  </section>
</template>
```

---

## 12. React 项目接入示例

### 12.1 放置静态资源

React / Vite / CRA 中：

```text
public/sherpa-onnx/
```

访问路径：

```js
'/sherpa-onnx'
```

### 12.2 封装 hook

```js
import { useMemo, useState } from 'react';
import { SherpaStreamingAsr } from './SherpaStreamingAsr';

export function useSherpaAsr() {
  const [status, setStatus] = useState('idle');
  const [partialText, setPartialText] = useState('');
  const [finalText, setFinalText] = useState('');

  const asr = useMemo(() => {
    return new SherpaStreamingAsr({
      wasmBaseUrl: '/sherpa-onnx',
      onStatus: setStatus,
      onPartial: setPartialText,
      onFinal(text) {
        setFinalText((value) => `${value}${text}\n`);
      },
    });
  }, []);

  return {
    status,
    partialText,
    finalText,
    init: () => asr.init(),
    start: () => asr.start(),
    stop: () => asr.stop(),
  };
}
```

### 12.3 React 组件中使用

```jsx
import { useSherpaAsr } from './useSherpaAsr';

const statusMap = {
  idle: '等待初始化',
  loading: '正在加载 WASM 和模型',
  creating: '正在创建识别器',
  ready: '模型已就绪',
  recording: '正在识别',
  error: '初始化失败',
};

export function AsrPanel() {
  const {
    status,
    partialText,
    finalText,
    init,
    start,
    stop,
  } = useSherpaAsr();

  return (
    <section>
      <p>{statusMap[status] || status}</p>

      <button onClick={init} disabled={status !== 'idle' && status !== 'error'}>
        初始化模型
      </button>

      <button onClick={start} disabled={status !== 'ready'}>
        开始识别
      </button>

      <button onClick={stop} disabled={status !== 'recording'}>
        停止识别
      </button>

      <h3>实时结果</h3>
      <p>{partialText}</p>

      <h3>最终文本</h3>
      <pre>{finalText}</pre>
    </section>
  );
}
```

---

## 13. 部署注意事项

### 13.1 必须通过 HTTP/HTTPS 访问

不能直接双击 HTML。

本地开发：

```bash
npm run dev
```

或：

```bash
npm start
```

生产环境需要部署到 Web 服务。

### 13.2 `.wasm` MIME 类型

服务器需要正确返回：

```text
application/wasm
```

否则浏览器可能无法加载 WASM。

### 13.3 `.data` 文件不能丢

```text
sherpa-onnx-wasm-main-asr.data
```

它包含构建时打包进去的模型资源。

### 13.4 路径必须一致

如果资源放在：

```text
public/sherpa-onnx/
```

前端就用：

```js
wasmBaseUrl: '/sherpa-onnx'
```

如果资源放在：

```text
public/assets/asr/
```

前端就用：

```js
wasmBaseUrl: '/assets/asr'
```

### 13.5 不要让底层状态覆盖业务状态

Emscripten 有自己的：

```js
Module.setStatus(status)
```

它会返回类似：

```text
Downloading data...
Running...
```

建议只在 `loading` 阶段使用它更新 UI。

业务状态自己维护：

```text
idle
loading
creating
ready
recording
error
```

### 13.6 麦克风权限

`getUserMedia` 通常要求：

```text
https
```

或本地：

```text
localhost
```

生产环境要用 HTTPS。

---

## 14. 常见问题

### Q1：初始化时报 `Cannot use 'in' operator to search for 'transducer' in undefined`

通常是传了不完整 config。

如果模型已经打进 `.data`，直接：

```js
createOnlineRecognizer(moduleInstance);
```

不要传半截配置。

### Q2：初始化一直显示 Running...

`Running...` 是 Emscripten runtime 状态，不是识别状态。

建议映射成：

```text
正在初始化 WASM 运行时
```

### Q3：按钮已可点，但状态还显示加载中

说明底层 `Module.setStatus` 异步覆盖了页面状态。

解决：维护业务状态机，`ready` 之后忽略底层状态。

### Q4：能不能不打包进 `.data`，直接加载 onnx？

理论上可以，但需要修改 sherpa-onnx WASM 加载和文件系统逻辑。官方示例默认更推荐把模型放进 `wasm/asr/assets`，构建成 `.data`。

### Q5：为什么初始化包这么大？

因为 `.data` 里包含模型资源。浏览器端本地推理的代价就是首次加载较重。
