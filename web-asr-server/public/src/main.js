const SAMPLE_RATE = 16000;

const els = {
  startButton: document.querySelector('#startButton'),
  stopButton: document.querySelector('#stopButton'),
  partialText: document.querySelector('#partialText'),
  finalText: document.querySelector('#finalText'),
  statusDot: document.querySelector('#statusDot'),
  statusText: document.querySelector('#statusText'),
};

let ws = null;
let audioContext = null;
let mediaStream = null;
let sourceNode = null;
let processorNode = null;
let appState = 'idle';

function setStatus(text, type = '') {
  els.statusText.textContent = text;
  els.statusDot.className = `dot ${type}`.trim();
}

function setAppState(state) {
  appState = state;

  const statusMap = {
    idle: ['正在连接服务器', ''],
    connecting: ['正在连接服务器', 'recording'],
    ready: ['服务器已就绪', 'ready'],
    recording: ['正在识别', 'recording'],
    error: ['连接失败', 'error'],
  };

  const [text, type] = statusMap[state] || ['', ''];
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

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  setAppState('connecting');
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('WebSocket 连接成功');
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === 'ready') {
        setAppState('ready');
        els.startButton.disabled = false;
        return;
      }

      if (data.type === 'partial') {
        els.partialText.textContent = data.text;
      }

      if (data.type === 'final') {
        appendFinal(data.text);
        els.partialText.textContent = '等待下一句话';
      }
    } catch (err) {
      console.error('解析消息失败:', err);
    }
  };

  ws.onerror = (err) => {
    console.error('WebSocket 错误:', err);
    setAppState('error');
  };

  ws.onclose = () => {
    console.log('WebSocket 连接关闭');
    if (appState !== 'error') {
      setAppState('idle');
      setTimeout(connectWebSocket, 2000);
    }
  };
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

function float32ToInt16(float32Array) {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const val = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = val < 0 ? val * 0x8000 : val * 0x7FFF;
  }
  return int16Array;
}

async function start() {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    alert('WebSocket 未连接，请稍后重试');
    return;
  }

  try {
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
      if (ws.readyState !== WebSocket.OPEN) return;

      const input = event.inputBuffer.getChannelData(0);
      const samples = downsampleTo16k(input, audioContext.sampleRate);
      const int16Samples = float32ToInt16(samples);

      ws.send(int16Samples.buffer);
    };

    sourceNode.connect(processorNode);
    processorNode.connect(audioContext.destination);

    els.startButton.disabled = true;
    els.stopButton.disabled = false;
    els.partialText.textContent = '正在听写';
    setAppState('recording');
  } catch (err) {
    console.error('获取麦克风权限失败:', err);
    alert('无法访问麦克风，请检查权限设置');
  }
}

function stop() {
  processorNode?.disconnect();
  sourceNode?.disconnect();
  mediaStream?.getTracks().forEach((track) => track.stop());
  audioContext?.close();

  processorNode = null;
  sourceNode = null;
  mediaStream = null;
  audioContext = null;

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send('done');
  }

  els.startButton.disabled = false;
  els.stopButton.disabled = true;
  els.partialText.textContent = '已停止';
  setAppState('ready');
}

els.startButton.addEventListener('click', start);
els.stopButton.addEventListener('click', stop);

connectWebSocket();
