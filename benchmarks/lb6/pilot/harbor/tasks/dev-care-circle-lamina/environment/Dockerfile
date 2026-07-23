FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates git jq python3 curl \
    chromium fonts-liberation fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*
ENV CHROME_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
COPY cursor-agent-version/ /root/.local/share/cursor-agent/versions/2026.07.20-8cc9c0b/
RUN mkdir -p /root/.local/bin && ln -s /root/.local/share/cursor-agent/versions/2026.07.20-8cc9c0b/cursor-agent /root/.local/bin/cursor-agent
WORKDIR /app
RUN mkdir -p /app
