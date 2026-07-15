FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git jq python3 \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g @openai/codex

WORKDIR /app

COPY workspace/ /app/

CMD ["bash"]
