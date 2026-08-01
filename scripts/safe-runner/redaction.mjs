const SENSITIVE_FLAG = /^(?:--?)?(?:api[-_]?key|access[-_]?token|auth(?:orization)?|password|secret|token)$/i;

export function redactText(value) {
  return String(value)
    .replace(/((?:--?)(?:api[-_]?key|access[-_]?token|auth(?:orization)?|password|secret|token)\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/(Authorization\s*:\s*Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .replace(/((?:api[-_]?key|access[-_]?token|password|secret|token)\s*[:=]\s*)[^\s,;"']+/gi, '$1[REDACTED]')
    .replace(/(Authorization\s*:\s*)(?!Bearer\b)[^\s,;"']+/gi, '$1[REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@');
}

export function redactCommand(command = []) {
  let redactNext = false;
  return command.map((item) => {
    const value = String(item);
    if (redactNext) {
      redactNext = false;
      return '[REDACTED]';
    }
    const equal = value.indexOf('=');
    if (equal > 0 && SENSITIVE_FLAG.test(value.slice(0, equal))) {
      return `${value.slice(0, equal + 1)}[REDACTED]`;
    }
    if (SENSITIVE_FLAG.test(value)) {
      redactNext = true;
      return value;
    }
    return redactText(value);
  });
}

export function redactEvidence(value, key = '') {
  if (typeof value === 'string') {
    if (SENSITIVE_FLAG.test(key)) return '[REDACTED]';
    return redactText(value);
  }
  if (Array.isArray(value)) {
    if (key === 'command' || key.endsWith('_command')) return redactCommand(value);
    return value.map((item) => redactEvidence(item, key));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [
      childKey,
      redactEvidence(child, childKey),
    ]));
  }
  return value;
}
