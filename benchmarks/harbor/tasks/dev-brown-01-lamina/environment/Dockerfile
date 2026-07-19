FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends bash ca-certificates git jq python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN rm -rf /app && git clone --depth 1 'https://github.com/vercel/commerce.git' /app && cd /app && git fetch --depth 1 origin 3761e52e60df9c6a316e067dbfd7032e494d3634 && git checkout --detach 3761e52e60df9c6a316e067dbfd7032e494d3634 && if [ -f package.json ]; then corepack enable || true; fi
