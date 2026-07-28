FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates git jq python3 curl \
    chromium fonts-liberation fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"
ENV CHROME_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
COPY cursor-agent-version/ /root/.local/share/cursor-agent/versions/2026.07.20-8cc9c0b/
RUN mkdir -p /root/.local/bin && ln -s /root/.local/share/cursor-agent/versions/2026.07.20-8cc9c0b/cursor-agent /root/.local/bin/cursor-agent
COPY lamina-release.json /tmp/lamina-release.json
RUN test "$(node -p "require('/tmp/lamina-release.json').sha256")" = "f2791528517f9af80fa5e9a2f44cbe2c599b42c2eea92b482eda35089adc9e0f" \
    && test "$(node -p "require('/tmp/lamina-release.json').version")" = "0.1.11" \
    && curl -fsSL https://github.com/aryaniyaps/lamina/releases/download/cli-v0.1.11/install.sh | sh \
    && lamina --version
WORKDIR /app
RUN mkdir -p /app
RUN git init -b main \
    && git config user.email benchmark@lamina.invalid \
    && git config user.name "Lamina Benchmark" \
    && git commit --allow-empty -m "benchmark fixture" \
    && mkdir -p .lamina/runtime \
    && ln -s ../.lamina/runtime .git/lamina
