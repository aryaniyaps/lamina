const BANNED_PATTERNS = [
  /\b(color|colour|blue|red|green|purple|gradient)\b/i,
  /\btypography|font|typeface\b/i,
  /\bpx\b|pixel-level|rounded corners/i,
  /\bReact component\b|implementation code|copy this code/i,
];

export function assertUxOnly(text) {
  const hit = BANNED_PATTERNS.find((pattern) => pattern.test(text));
  if (hit) throw new Error(`UX-only guardrail failed: visual design leakage matched ${hit}`);
}
