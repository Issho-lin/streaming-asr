const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const MODEL_NAME = 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20';
const MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL_NAME}.tar.bz2`;
const MODELS_DIR = path.join(__dirname, '..', 'models');

if (fs.existsSync(path.join(MODELS_DIR, MODEL_NAME, 'tokens.txt'))) {
  console.log('模型已存在，跳过下载');
  process.exit(0);
}

fs.mkdirSync(MODELS_DIR, { recursive: true });

console.log(`正在下载模型: ${MODEL_NAME}`);
console.log(`URL: ${MODEL_URL}`);
console.log('文件较大（约 70MB），请耐心等待...\n');

try {
  execSync(`curl -SL "${MODEL_URL}" | tar xjf - -C "${MODELS_DIR}"`, {
    stdio: 'inherit',
  });
  console.log(`\n模型下载完成，保存在: ${path.join(MODELS_DIR, MODEL_NAME)}`);
} catch (err) {
  console.error('下载失败:', err.message);
  console.error('\n请手动下载并解压到 models/ 目录:');
  console.error(`  curl -SL "${MODEL_URL}" | tar xjf - -C "${MODELS_DIR}"`);
  process.exit(1);
}
