FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    libgomp1 \
    libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci --include=optional \
    && npm install --no-save sherpa-onnx-node@1.13.3 sherpa-onnx-linux-x64@1.13.3 \
    && test -f /app/node_modules/sherpa-onnx-linux-x64/sherpa-onnx.node

COPY . .

ENV PORT=6006
ENV LD_LIBRARY_PATH=/app/node_modules/sherpa-onnx-linux-x64:$LD_LIBRARY_PATH

EXPOSE 6006

CMD ["npm", "start"]
