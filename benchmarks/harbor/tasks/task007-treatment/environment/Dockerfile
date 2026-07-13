FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git python3 python3-venv \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g @anthropic-ai/claude-code \
  && node "$(npm root -g)/@anthropic-ai/claude-code/install.cjs" \
  && curl -LsSf https://astral.sh/uv/install.sh | sh

ENV PATH="/root/.local/bin:${PATH}"

WORKDIR /app

COPY workspace/ /app/

CMD ["bash"]
