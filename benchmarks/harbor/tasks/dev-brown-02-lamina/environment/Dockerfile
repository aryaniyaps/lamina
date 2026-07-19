FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends bash ca-certificates git jq python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN rm -rf /app && git clone --depth 1 'https://github.com/payloadcms/reusable-content-example.git' /app && cd /app && git fetch --depth 1 origin 2d233564ca98ed48a0a118a3165c242150448436 && git checkout --detach 2d233564ca98ed48a0a118a3165c242150448436 && if [ -f package.json ]; then corepack enable || true; fi
