#!/usr/bin/env node
/**
 * Parse simple YAML files (scalars, arrays, one-level nested objects).
 */
import fs from 'node:fs';

export function parseYaml(text) {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  const result = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) {
      i++;
      continue;
    }

    const kv = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
    if (!kv) {
      i++;
      continue;
    }

    const key = kv[1];
    const val = kv[2].trim();

    if (val !== '') {
      result[key] = parseScalar(val);
      i++;
      continue;
    }

    // Block value: array or nested object
    const block = [];
    i++;
    while (i < lines.length && /^\s/.test(lines[i]) && lines[i].trim()) {
      block.push(lines[i]);
      i++;
    }

    if (block.length === 0) {
      result[key] = null;
      continue;
    }

    if (block[0].match(/^\s+-\s+/)) {
      result[key] = block.map((l) => {
        let v = l.replace(/^\s+-\s+/, '').trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        return v;
      });
    } else {
      const obj = {};
      for (const bl of block) {
        const m = bl.match(/^\s+([a-zA-Z_][\w-]*):\s*(.+)$/);
        if (m) obj[m[1]] = parseScalar(m[2].trim());
      }
      result[key] = obj;
    }
  }

  return result;
}

function parseScalar(val) {
  if (val === 'null') return null;
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (/^\d+$/.test(val)) return Number(val);
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  return val;
}

export function readYamlSync(filePath) {
  return parseYaml(fs.readFileSync(filePath, 'utf8'));
}
