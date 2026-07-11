#!/usr/bin/env node
/**
 * Parse simple YAML used by LaminaBench (scalars, arrays, list-of-maps, one-level maps).
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

    const block = [];
    i++;
    while (i < lines.length && (/^\s/.test(lines[i]) || !lines[i].trim())) {
      if (!lines[i].trim() || lines[i].trim().startsWith('#')) {
        i++;
        continue;
      }
      if (!/^\s/.test(lines[i])) break;
      block.push(lines[i]);
      i++;
    }

    if (block.length === 0) {
      result[key] = null;
      continue;
    }

    if (block[0].match(/^\s+-\s+/)) {
      result[key] = parseListBlock(block);
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

/** Parse indented YAML list — scalars or list-of-maps. */
function parseListBlock(block) {
  const items = [];
  let current = null;
  let nestedKey = null;
  let nestedList = null;

  const flushNested = () => {
    if (current && nestedKey && nestedList) {
      current[nestedKey] = nestedList;
    }
    nestedKey = null;
    nestedList = null;
  };

  for (const raw of block) {
    const listItem = raw.match(/^\s+-\s+(.*)$/);
    if (listItem) {
      const rest = listItem[1].trim();
      const indent = raw.match(/^(\s*)/)[1].length;

      // Nested list under a map key (e.g. patterns: / concepts:)
      if (nestedKey && indent >= 6 && current) {
        nestedList.push(parseScalar(rest));
        continue;
      }

      flushNested();

      // New top-level list item that is a map field: "- id: foo"
      const mapStart = rest.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
      if (mapStart) {
        current = {};
        const v = mapStart[2].trim();
        current[mapStart[1]] = v === '' ? null : parseScalar(v);
        items.push(current);
      } else {
        current = null;
        items.push(parseScalar(rest));
      }
      continue;
    }

    // Continuation field of current map item
    const field = raw.match(/^\s{4,}([a-zA-Z_][\w-]*):\s*(.*)$/);
    if (field && current) {
      flushNested();
      const fk = field[1];
      const fv = field[2].trim();
      if (fv === '') {
        nestedKey = fk;
        nestedList = [];
        current[fk] = nestedList;
      } else {
        current[fk] = parseScalar(fv);
      }
    }
  }
  flushNested();
  return items;
}

function parseScalar(val) {
  if (val === 'null') return null;
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(val)) return Number(val);
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    const q = val[0];
    let inner = val.slice(1, -1);
    if (q === '"') {
      inner = inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else {
      inner = inner.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    }
    return inner;
  }
  return val;
}

export function readYamlSync(filePath) {
  return parseYaml(fs.readFileSync(filePath, 'utf8'));
}
