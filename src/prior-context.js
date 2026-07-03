function cleanBullet(line) {
  return line.replace(/^\s*-\s*/, '').trim();
}

export function parseMarkdownSections(markdown) {
  const out = {};
  const lines = (markdown ?? '').split('\n');
  let current = null;

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      current = heading[1].trim();
      if (!out[current]) out[current] = '';
      continue;
    }
    if (current) out[current] += `${line}\n`;
  }

  return out;
}

export function extractBulletLines(text) {
  return (text ?? '')
    .split('\n')
    .filter((line) => /^\s*-\s+/.test(line))
    .map(cleanBullet)
    .filter((line) => line && line.toLowerCase() !== 'none recorded yet.');
}

export function buildPriorContext(artifacts) {
  const insightsSections = parseMarkdownSections(artifacts.insights);
  const decisionsSections = parseMarkdownSections(artifacts.decisions);
  const requirementsSections = parseMarkdownSections(artifacts.requirements);

  return {
    activeDecisions: extractBulletLines(decisionsSections['Active Decisions'] ?? ''),
    priorInsights: extractBulletLines(insightsSections['Key Insights'] ?? ''),
    priorRequirements: extractBulletLines(requirementsSections['User Requirements'] ?? ''),
  };
}
