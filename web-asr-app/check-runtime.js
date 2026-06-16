import { existsSync } from 'node:fs';
import { join } from 'node:path';

const requiredFiles = [
  'public/index.html',
  'public/src/main.js',
  'public/src/styles.css',
  'public/sherpa-onnx/sherpa-onnx-asr.js',
  'public/sherpa-onnx/sherpa-onnx-wasm-main-asr.js',
  'public/sherpa-onnx/sherpa-onnx-wasm-main-asr.wasm',
  'public/sherpa-onnx/sherpa-onnx-wasm-main-asr.data',
];

const missing = requiredFiles.filter((file) => !existsSync(join(process.cwd(), file)));

if (missing.length > 0) {
  console.log('缺少以下文件：');
  for (const file of missing) {
    console.log(`- ${file}`);
  }
  process.exitCode = 1;
} else {
  console.log('文件检查通过。');
}
