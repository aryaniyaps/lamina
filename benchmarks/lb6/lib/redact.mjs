const SECRET_KEY_RE = /(?:^|_)(?:api[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|secret|password|credential)$/i;

const INLINE_SECRET_RES = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bCURSOR_API_KEY\s*=\s*\S+/gi,
  /\bHARBOR_API_KEY\s*=\s*\S+/gi,
  /\bANTHROPIC_API_KEY\s*=\s*\S+/gi,
  /\b--api-key\s+\S+/gi,
];

export function redactString(value) {
  if (typeof value !== 'string') return value;
  let out = value;
  for (const pattern of INLINE_SECRET_RES) {
    out = out.replace(pattern, (match) => {
      const eq = match.indexOf('=');
      if (eq !== -1) return `${match.slice(0, eq + 1)}<redacted>`;
      const parts = match.split(/\s+/);
      return `${parts[0]} <redacted>`;
    });
  }
  return out;
}

export function redactValue(value) {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value && typeof value === 'object') return redactObject(value);
  return value;
}

export function redactObject(input) {
  if (!input || typeof input !== 'object') return input;
  if (Array.isArray(input)) return input.map((item) => redactValue(item));

  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (SECRET_KEY_RE.test(key)) {
      out[key] = value ? '<redacted>' : value;
      continue;
    }
    out[key] = redactValue(value);
  }
  return out;
}

export function credentialPresence(value) {
  return value ? 'present' : 'absent';
}
