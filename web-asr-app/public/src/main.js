const SAMPLE_RATE = 16000;
const RUNTIME_VERSION = '20260616-debug-off';

const els = {
  initButton: document.querySelector('#initButton'),
  startButton: document.querySelector('#startButton'),
  stopButton: document.querySelector('#stopButton'),
  wasmPath: document.querySelector('#wasmPath'),
  partialText: document.querySelector('#partialText'),
  finalText: document.querySelector('#finalText'),
  statusDot: document.querySelector('#statusDot'),
  statusText: document.querySelector('#statusText'),
};

let moduleInstance = null;
let recognizer = null;
let stream = null;
let audioContext = null;
let mediaStream = null;
let sourceNode = null;
let processorNode = null;
let lastPartial = '';
let initPromise = null;
let appState = 'idle';

function setStatus(text, type = '') {
  els.statusText.textContent = text;
  els.statusDot.className = `dot ${type}`.trim();
}

function setAppState(state) {
  appState = state;

  const statusMap = {
    idle: ['正在准备模型', ''],
    loading: ['正在加载 WASM 和模型', 'recording'],
    creating: ['正在创建识别器', 'recording'],
    ready: ['模型已就绪', 'ready'],
    recording: ['正在识别', 'recording'],
    error: ['初始化失败', 'error'],
  };

  const [text, type] = statusMap[state];
  setStatus(text, type);
}

function appendFinal(text) {
  const value = text.trim();
  if (!value) return;

  els.finalText.classList.remove('empty');
  els.finalText.textContent = els.finalText.textContent === '暂无内容'
    ? value
    : `${els.finalText.textContent}\n${value}`;
}

function normalizePath(path) {
  return path.replace(/\/$/, '');
}

async function assertRuntimeFile(base, filename) {
  const url = `${base}/${filename}`;
  const response = await fetch(url, { method: 'HEAD' });

  if (!response.ok) {
    throw new Error(
      `缺少浏览器运行时文件：${url}\n\n请把 sherpa-onnx 官方 WebAssembly ASR 构建产物放到 public 目录：\n- sherpa-onnx-asr.js\n- sherpa-onnx-wasm-main-asr.js\n- sherpa-onnx-wasm-main-asr.wasm\n\n然后刷新页面重新初始化。`
    );
  }
}

async function loadScript(src) {
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`无法加载 ${src}`));
    document.body.appendChild(script);
  });
}

async function initSherpaModule(wasmPath) {
  const base = normalizePath(wasmPath);

  await assertRuntimeFile(base, 'sherpa-onnx-asr.js');
  await assertRuntimeFile(base, 'sherpa-onnx-wasm-main-asr.js');
  await assertRuntimeFile(base, 'sherpa-onnx-wasm-main-asr.wasm');

  if (!globalThis.createOnlineRecognizer) {
    await loadScript(`${base}/sherpa-onnx-asr.js?v=${RUNTIME_VERSION}`);
  }

  globalThis.Module = {
    locateFile(path, scriptDirectory = '') {
      if (path.endsWith('.wasm') || path.endsWith('.data')) {
        return `${base}/${path}`;
      }
      return scriptDirectory + path;
    },
    setStatus(status) {
      if (appState !== 'loading') return;

      if (status === 'Running...') {
        setStatus('正在初始化 WASM 运行时', 'recording');
        return;
      }

      if (status?.startsWith('Downloading data...')) {
        setStatus('正在加载模型资源', 'recording');
        return;
      }

      setStatus(status || '正在加载 WASM 和模型', 'recording');
    },
    onRuntimeInitialized() {
      moduleInstance = globalThis.Module;
    },
  };

  if (!globalThis.Module.calledRun) {
    await loadScript(`${base}/sherpa-onnx-wasm-main-asr.js?v=${RUNTIME_VERSION}`);
  }

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

function createRecognizer(module) {
  if (!globalThis.createOnlineRecognizer) {
    throw new Error('缺少 createOnlineRecognizer，请确认 sherpa-onnx-asr.js 已放在 public 目录。');
  }

  return globalThis.createOnlineRecognizer(module);
}

async function initialize() {
  if (recognizer && stream) return;
  if (initPromise) return initPromise;

  els.initButton.disabled = true;
  els.startButton.disabled = true;
  setAppState('loading');

  initPromise = (async () => {
    try {
      const module = await initSherpaModule(els.wasmPath.value);
      setAppState('creating');
      recognizer = createRecognizer(module);
      stream = recognizer.createStream();

      els.startButton.disabled = false;
      els.wasmPath.disabled = true;
      setAppState('ready');
    } catch (error) {
      initPromise = null;
      els.initButton.disabled = false;
      setAppState('error');
      els.partialText.textContent = error.message;
      throw error;
    }
  })();

  return initPromise;
}

function downsampleTo16k(input, inputSampleRate) {
  if (inputSampleRate === SAMPLE_RATE) return input;

  const ratio = inputSampleRate / SAMPLE_RATE;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i += 1) {
    output[i] = input[Math.floor(i * ratio)];
  }

  return output;
}

function decodeSamples(samples) {
  stream.acceptWaveform(SAMPLE_RATE, samples);

  while (recognizer.isReady(stream)) {
    recognizer.decode(stream);
  }

  const result = recognizer.getResult(stream);
  const text = typeof result === 'string' ? result : result.text;
  if (text && text !== lastPartial) {
    els.partialText.textContent = text;
    lastPartial = text;
  }

  if (recognizer.isEndpoint(stream)) {
    appendFinal(lastPartial);
    recognizer.reset(stream);
    lastPartial = '';
    els.partialText.textContent = '等待下一句话';
  }
}

async function start() {
  if (!recognizer || !stream) {
    await initialize();
  }

  if (!recognizer || !stream) return;

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  audioContext = new AudioContext();
  sourceNode = audioContext.createMediaStreamSource(mediaStream);
  processorNode = audioContext.createScriptProcessor(4096, 1, 1);

  processorNode.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const samples = downsampleTo16k(input, audioContext.sampleRate);
    decodeSamples(samples);
  };

  sourceNode.connect(processorNode);
  processorNode.connect(audioContext.destination);

  els.startButton.disabled = true;
  els.stopButton.disabled = false;
  els.partialText.textContent = '正在听写';
  setAppState('recording');
}

async function stop() {
  processorNode?.disconnect();
  sourceNode?.disconnect();
  mediaStream?.getTracks().forEach((track) => track.stop());
  await audioContext?.close();

  processorNode = null;
  sourceNode = null;
  mediaStream = null;
  audioContext = null;

  if (lastPartial) appendFinal(lastPartial);
  lastPartial = '';

  els.startButton.disabled = false;
  els.stopButton.disabled = true;
  els.partialText.textContent = '已停止';
  setAppState('ready');
}

els.initButton.addEventListener('click', initialize);
els.startButton.addEventListener('click', start);
els.stopButton.addEventListener('click', stop);
