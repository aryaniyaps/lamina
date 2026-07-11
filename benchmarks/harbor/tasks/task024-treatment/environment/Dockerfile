FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g @anthropic-ai/claude-code

WORKDIR /app

COPY workspace/ /app/

CMD ["bash"]
