import fs from 'node:fs';
import path from 'node:path';

/**
 * @typedef {{ component: string; text?: string; label?: string; name?: string; trigger?: string; columns?: string[] }} ManifestElement
 * @typedef {{ id: string; source?: string; regions?: string[]; elements: ManifestElement[] }} ManifestScreen
 * @typedef {{ screens: ManifestScreen[] }} StructureManifest
 */

/**
 * @param {string} raw
 */
function stripYamlScalar(raw) {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'null') return undefined;
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * @param {string} raw
 * @returns {string[]}
 */
function parseInlineArray(raw) {
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (!inner.trim()) return [];
  return inner.split(',').map((s) => stripYamlScalar(s.trim())).filter(Boolean);
}

/**
 * @param {string} pairText
 * @param {ManifestElement} element
 */
function applyInlinePair(pairText, element) {
  const m = pairText.match(/^\s*(\w+):\s*(.+?)\s*$/);
  if (!m) return;
  const key = m[1];
  const val = m[2].trim();
  if (key === 'columns' && val.startsWith('[')) {
    element.columns = parseInlineArray(val);
  } else {
    element[key] = stripYamlScalar(val);
  }
}

/**
 * @param {string} inner
 * @returns {ManifestElement}
 */
function parseInlineElement(inner) {
  const element = { component: '' };
  const componentMatch = inner.match(/component:\s*(\w+)/);
  if (!componentMatch) return element;
  element.component = componentMatch[1];

  const rest = inner.replace(/component:\s*\w+,?\s*/, '');
  for (const part of rest.split(',')) {
    if (!part.trim()) continue;
    applyInlinePair(part, element);
  }
  return element;
}

/**
 * Minimal parser for structure-manifest.yaml.
 * @param {string} source
 * @returns {StructureManifest}
 */
export function parseStructureManifestYaml(source) {
  /** @type {ManifestScreen[]} */
  const screens = [];
  /** @type {ManifestScreen | null} */
  let currentScreen = null;
  /** @type {ManifestElement | null} */
  let currentElement = null;
  let inRegionsList = false;

  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const screenItem = line.match(/^\s*-\s+id:\s*(.+)$/);
    if (screenItem) {
      if (currentScreen) screens.push(currentScreen);
      currentScreen = { id: stripYamlScalar(screenItem[1]), elements: [], regions: [] };
      currentElement = null;
      inRegionsList = false;
      continue;
    }

    if (!currentScreen) continue;

    const elemInline = line.match(/^\s+-\s+\{(.+)\}\s*$/);
    if (elemInline) {
      currentScreen.elements.push(parseInlineElement(elemInline[1]));
      currentElement = null;
      inRegionsList = false;
      continue;
    }

    const elemStart = line.match(/^\s+-\s+component:\s*(\w+)\s*$/);
    if (elemStart) {
      if (currentElement) currentScreen.elements.push(currentElement);
      currentElement = { component: elemStart[1] };
      inRegionsList = false;
      continue;
    }

    const elemProp = line.match(/^\s{6,}(\w+):\s*(.+)$/);
    if (elemProp && currentElement) {
      const key = elemProp[1];
      const val = elemProp[2].trim();
      if (key === 'columns' && val.startsWith('[')) {
        currentElement.columns = parseInlineArray(val);
      } else {
        currentElement[key] = stripYamlScalar(val);
      }
      continue;
    }

    const screenProp = line.match(/^\s{4}(\w+):\s*(.*)$/);
    if (screenProp) {
      const key = screenProp[1];
      const val = screenProp[2].trim();
      if (key === 'elements') {
        inRegionsList = false;
        continue;
      }
      if (key === 'regions') {
        if (val.startsWith('[')) {
          currentScreen.regions = parseInlineArray(val);
          inRegionsList = false;
        } else {
          inRegionsList = true;
          currentScreen.regions = [];
        }
        continue;
      }
      currentScreen[key] = stripYamlScalar(val);
      inRegionsList = false;
      continue;
    }

    const regionItem = line.match(/^\s{6}-\s+(\w+)\s*$/);
    if (regionItem && inRegionsList) {
      currentScreen.regions.push(regionItem[1]);
    }
  }

  if (currentElement && currentScreen) currentScreen.elements.push(currentElement);
  if (currentScreen) screens.push(currentScreen);

  return { screens };
}

/**
 * @param {string} blueprintDir
 * @returns {StructureManifest | null}
 */
export function loadStructureManifest(blueprintDir) {
  const file = path.join(path.resolve(blueprintDir), 'structure-manifest.yaml');
  if (!fs.existsSync(file)) return null;
  return parseStructureManifestYaml(fs.readFileSync(file, 'utf8'));
}

/**
 * Walk up from startDir to find git repo root.
 * @param {string} startDir
 */
export function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;
  while (dir !== root) {
    if (fs.existsSync(path.join(dir, '.git'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return path.resolve(startDir);
}

/**
 * @param {string} attrs
 * @param {string} prop
 * @param {string} value
 */
function attrMatches(attrs, prop, value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    new RegExp(`\\b${prop}=["']${escaped}["']`).test(attrs) ||
    new RegExp(`\\b${prop}=\\{["']${escaped}["']\\}`).test(attrs)
  );
}

/**
 * @param {string} source
 * @param {number} tagIndex
 * @param {string} component
 * @param {string} text
 */
function childTextMatches(source, tagIndex, component, text) {
  const slice = source.slice(tagIndex);
  const closePattern = new RegExp(`<${component}\\b[^>]*>([\\s\\S]*?)</${component}>`);
  const m = slice.match(closePattern);
  if (!m) return false;
  return m[1].trim() === text;
}

/**
 * @param {string} attrs
 * @param {string[]} columns
 */
function columnsMatch(attrs, columns) {
  const m = attrs.match(/\bcolumns=\{(\[[^\]]*\])\}/);
  if (!m) return false;
  const found = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
  return columns.every((col) => found.includes(col));
}

/**
 * @param {ManifestElement} element
 * @param {string} source
 */
export function elementMatchesSource(element, source) {
  const { component } = element;
  if (!component) return false;

  const tagRe = new RegExp(`<${component}\\b([^>/]*)(?:/>|>)`, 'g');
  let m;
  while ((m = tagRe.exec(source)) !== null) {
    const attrs = m[1];
    let ok = true;

    if (element.text !== undefined) {
      const textOk =
        attrMatches(attrs, 'text', element.text) ||
        attrMatches(attrs, 'label', element.text) ||
        childTextMatches(source, m.index, component, element.text);
      if (!textOk) ok = false;
    }
    if (element.label !== undefined && !attrMatches(attrs, 'label', element.label)) ok = false;
    if (element.name !== undefined && !attrMatches(attrs, 'name', element.name)) ok = false;
    if (element.trigger !== undefined && !attrMatches(attrs, 'trigger', element.trigger)) ok = false;
    if (element.columns !== undefined && !columnsMatch(attrs, element.columns)) ok = false;

    if (ok) return true;
  }
  return false;
}

/**
 * @param {string} component
 * @param {string} source
 */
export function regionPresent(component, source) {
  return new RegExp(`<${component}\\b`).test(source);
}

/**
 * @param {string} blueprintDir
 * @param {string} repoRoot
 * @param {string[]} errors
 */
export function validateStructureManifest(blueprintDir, repoRoot, errors) {
  const manifest = loadStructureManifest(blueprintDir);
  if (!manifest?.screens?.length) return;

  for (const screen of manifest.screens) {
    const relManifest = `structure-manifest.yaml (screen "${screen.id}")`;

    if (!screen.id) {
      errors.push(`${relManifest}: missing id`);
      continue;
    }

    const screenPath = path.join(blueprintDir, 'screens', `${screen.id}.tsx`);
    const screenRel = path.relative(blueprintDir, screenPath);
    if (!fs.existsSync(screenPath)) {
      errors.push(`${screenRel}: manifest lists screen but file not found`);
      continue;
    }

    if (screen.source) {
      const sourcePath = path.join(repoRoot, screen.source);
      if (!fs.existsSync(sourcePath)) {
        errors.push(`${relManifest}: source not found: ${screen.source}`);
      }
    }

    const source = fs.readFileSync(screenPath, 'utf8');

    for (const region of screen.regions ?? []) {
      if (!regionPresent(region, source)) {
        errors.push(`${screenRel}: missing region component <${region}>`);
      }
    }

    for (const element of screen.elements ?? []) {
      if (!element.component) {
        errors.push(`${relManifest}: element missing component`);
        continue;
      }
      if (!elementMatchesSource(element, source)) {
        const desc = Object.entries(element)
          .map(([k, v]) => (k === 'columns' ? `${k}=[${v.join(', ')}]` : `${k}=${v}`))
          .join(', ');
        errors.push(`${screenRel}: manifest element not found in blueprint (${desc})`);
      }
    }
  }
}
