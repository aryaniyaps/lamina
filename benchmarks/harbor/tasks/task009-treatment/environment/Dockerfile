FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git jq python3 \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g @openai/codex@0.144.5

WORKDIR /app

CMD ["bash"]
