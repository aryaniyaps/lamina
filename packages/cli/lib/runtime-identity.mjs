import fs from 'node:fs';

const packageMetadata = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

export const CLI_VERSION = packageMetadata.version;
export const CLI_NODE_REQUIREMENT = packageMetadata.engines.node;
