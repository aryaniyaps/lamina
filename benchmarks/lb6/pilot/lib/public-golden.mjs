import { buildActionSchema } from '../../../lib/action-schema.mjs';

const NEUTRAL_STRING_FIELDS = Object.freeze({
  title: 'Example title',
  text: 'Example note text',
  item: 'Example item',
  document: 'example-document',
  email: 'participant@example.org',
});

const PRESERVED_ACTION_FIELDS = new Set(['type', 'id', 'actor']);

export function collectHiddenTerms(golden) {
  const terms = new Set();
  for (const sequence of golden.sequences ?? []) {
    for (const group of sequence.expect ?? []) {
      for (const term of Array.isArray(group) ? group : [group]) {
        if (term !== undefined && term !== null && String(term).length > 0) {
          terms.add(String(term).toLowerCase());
        }
      }
    }
    for (const term of sequence.must_not_include ?? []) {
      if (term !== undefined && term !== null && String(term).length > 0) {
        terms.add(String(term).toLowerCase());
      }
    }
  }
  return [...terms];
}

const PAYLOAD_TEXT_FIELDS = new Set(['text', 'title', 'item', 'document', 'email']);

export function collectScoringSensitiveStrings(golden) {
  const terms = new Set();
  for (const sequence of golden.sequences ?? []) {
    for (const term of sequence.must_not_include ?? []) {
      if (term) terms.add(String(term));
    }
    for (const action of sequence.actions ?? []) {
      for (const [key, value] of Object.entries(action)) {
        if (!PAYLOAD_TEXT_FIELDS.has(key) || typeof value !== 'string' || value.length === 0) continue;
        terms.add(value);
      }
    }
  }
  return [...terms];
}

function stringFieldContaminated(value, hiddenTerms) {
  const lower = String(value).toLowerCase();
  return hiddenTerms.some(
    (term) => term.length >= 3 && (lower.includes(term) || term.includes(lower)),
  );
}

export function sanitizeAction(action, hiddenTerms) {
  const copy = { ...action };
  delete copy.expect;
  delete copy.expects;
  delete copy.must_not_include;
  for (const [key, value] of Object.entries(copy)) {
    if (PRESERVED_ACTION_FIELDS.has(key) || typeof value !== 'string') continue;
    if (NEUTRAL_STRING_FIELDS[key] || stringFieldContaminated(value, hiddenTerms)) {
      copy[key] = NEUTRAL_STRING_FIELDS[key] ?? `example-${key}`;
    }
  }
  return copy;
}

export function publicGolden(golden) {
  const hiddenTerms = collectHiddenTerms(golden);
  return {
    sequences: (golden.sequences ?? []).map((sequence) => ({
      actor: sequence.actor,
      actions: (sequence.actions ?? []).map((action) => sanitizeAction(action, hiddenTerms)),
    })),
  };
}

export function buildPublicActionSchema(golden) {
  return buildActionSchema(publicGolden(golden));
}

export function writeTextFile(filePath, content) {
  const normalized = `${String(content).replace(/\n+$/u, '')}\n`;
  return normalized;
}
