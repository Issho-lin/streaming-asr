const SAMPLE_RATE = 16000;
const RECONNECT_DELAY_MS = 2000;

const els = {
  startButton: document.querySelector('#startButton'),
  stopButton: document.querySelector('#stopButton'),
  uploadButton: document.querySelector('#uploadButton'),
  audioFileInput: document.querySelector('#audioFileInput'),
  selectedFileName: document.querySelector('#selectedFileName'),
  uploadHint: document.querySelector('#uploadHint'),
  uploadError: document.querySelector('#uploadError'),
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
let isUploading = false;
let reconnectTimer = null;

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

function resetFinalResult() {
  els.finalText.classList.add('empty');
  els.finalText.textContent = '暂无内容';
}

function setUploadHint(text, type = '') {
  els.uploadHint.textContent = text;
  els.uploadHint.className = `upload-hint ${type}`.trim();
}

function showUploadError(message) {
  els.uploadError.hidden = false;
  els.uploadError.textContent = message;
}

function clearUploadError() {
  els.uploadError.hidden = true;
  els.uploadError.textContent = '';
}

function setUploadBusyState(busy) {
  isUploading = busy;
  els.uploadButton.disabled = busy;
  els.audioFileInput.disabled = busy;
}

function isRecording() {
  return Boolean(processorNode);
}

function clearReconnectTimer() {
  if (!reconnectTimer) return;

  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function scheduleReconnect(message = `连接断开，${RECONNECT_DELAY_MS / 1000} 秒后重连`) {
  if (reconnectTimer) return;

  setStatus(message, 'error');
  els.startButton.disabled = true;
  els.stopButton.disabled = !isRecording();

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, RECONNECT_DELAY_MS);
}

function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  clearReconnectTimer();

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
        if (isRecording()) {
          setAppState('recording');
          els.startButton.disabled = true;
          els.stopButton.disabled = false;
        } else {
          setAppState('ready');
          els.startButton.disabled = false;
          els.stopButton.disabled = true;
        }
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
    scheduleReconnect('连接失败，正在自动重连...');
  };

  ws.onclose = () => {
    console.log('WebSocket 连接关闭');
    ws = null;
    scheduleReconnect();
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

async function uploadAudioFile() {
  const file = els.audioFileInput.files && els.audioFileInput.files[0];
  if (!file) {
    showUploadError('请先选择一个 wav、mp3 或 m4a 文件');
    return;
  }

  clearUploadError();
  setUploadBusyState(true);
  setUploadHint('正在上传并识别，请稍候...', 'loading');
  resetFinalResult();
  els.partialText.textContent = '文件转写中';

  try {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/transcribe', {
      method: 'POST',
      body: formData,
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || '上传转写失败');
    }

    appendFinal(result.text || '');
    els.partialText.textContent = '文件转写完成';
    setUploadHint(`已完成: ${file.name}`, 'success');
  } catch (err) {
    console.error('文件上传转写失败:', err);
    showUploadError(err.message || '文件上传转写失败');
    setUploadHint('上传失败，请检查音频格式或稍后重试');
    els.partialText.textContent = '等待开始';
  } finally {
    setUploadBusyState(false);
  }
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
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

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

els.audioFileInput.addEventListener('change', () => {
  const file = els.audioFileInput.files && els.audioFileInput.files[0];
  clearUploadError();

  if (!file) {
    els.selectedFileName.textContent = '选择音频文件';
    setUploadHint('未选择文件');
    return;
  }

  els.selectedFileName.textContent = file.name;
  setUploadHint(`已选择: ${file.name}`);
});

els.startButton.addEventListener('click', start);
els.stopButton.addEventListener('click', stop);
els.uploadButton.addEventListener('click', () => {
  if (!isUploading) {
    uploadAudioFile();
  }
});

connectWebSocket();
