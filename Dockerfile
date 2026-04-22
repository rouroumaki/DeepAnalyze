FROM oven/bun:1

WORKDIR /app

# Install Python3 and system libraries
RUN apt-get update -qq && \
    apt-get install -y -qq --no-install-recommends \
      python3 python3-pip curl && \
    rm -rf /var/lib/apt/lists/*

# Install Python packages for document processing (docling, OCR, etc.)
# Step 1: Install torch CPU-only first (avoids pulling 2GB+ CUDA libs)
RUN pip3 install --break-system-packages --no-cache-dir \
      torch torchvision \
      --index-url https://download.pytorch.org/whl/cpu && \
    # Step 2: Install remaining packages from Chinese mirror
    pip3 install --break-system-packages --no-cache-dir \
      -i https://mirrors.aliyun.com/pypi/simple/ \
      --trusted-host mirrors.aliyun.com \
      opencv-python-headless \
      docling>=2.89.0 \
      rapidocr-onnxruntime \
      onnxruntime && \
    # Step 3: Clean up pip cache
    rm -rf /root/.cache/pip

COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile --production

COPY . .

RUN mkdir -p /app/data

# Set HF_ENDPOINT for model downloads (docling needs layout models)
ENV HF_ENDPOINT=https://hf-mirror.com
ENV NODE_ENV=production
ENV PORT=21000
ENV DATA_DIR=/app/data

EXPOSE 21000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:21000/api/health || exit 1

CMD ["bun", "run", "src/main.ts"]
