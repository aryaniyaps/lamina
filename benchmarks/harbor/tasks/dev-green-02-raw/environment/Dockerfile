FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends bash ca-certificates git jq python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN mkdir -p /app
