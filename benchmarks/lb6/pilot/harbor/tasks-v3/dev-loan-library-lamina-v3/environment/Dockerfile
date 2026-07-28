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
RUN test "$(node -p "require('/tmp/lamina-release.json').sha256")" = "0589356a9478093753510c8850a14501ad9f790dd6e80e824924adf926010a70" \
    && test "$(node -p "require('/tmp/lamina-release.json').version")" = "0.1.10" \
    && curl -fsSL https://github.com/aryaniyaps/lamina/releases/download/cli-v0.1.10/install.sh | sh \
    && lamina --version
WORKDIR /app
RUN mkdir -p /app
RUN git init -b main \
    && git config user.email benchmark@lamina.invalid \
    && git config user.name "Lamina Benchmark" \
    && git commit --allow-empty -m "benchmark fixture" \
    && mkdir -p .lamina/runtime \
    && ln -s ../.lamina/runtime .git/lamina
