# LaminaBench isolated workflow runner — one ephemeral container per job.
FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

# Agent CLI baked into image so jobs never mount host node_modules.
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /runner

COPY benchmarks/scripts/bench-workflow.mjs \
     benchmarks/scripts/bench-clarify.mjs \
     benchmarks/scripts/lamina-run-layout.mjs \
     benchmarks/scripts/phase-gates.mjs \
     benchmarks/scripts/artifact-contract.mjs \
     benchmarks/scripts/run-job-in-container.mjs \
     ./benchmarks/scripts/

COPY evals/scripts/invoke-agent.mjs ./evals/scripts/

ENTRYPOINT ["node", "/runner/benchmarks/scripts/run-job-in-container.mjs"]
