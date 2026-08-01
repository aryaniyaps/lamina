import crypto from 'node:crypto';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function benchmarkIdentity(source, fixture, configuration) {
  const inputDigest = crypto.createHash('sha256')
    .update(JSON.stringify(canonical({ source, fixture, configuration }))).digest('hex');
  return {
    input_digest: inputDigest,
    result_id: `runtime-v1-${inputDigest.slice(0, 24)}`,
  };
}
