/**
 * Blueprint components are for preview/planning only.
 * Set SUB_PREVIEW=1 in the wireframe preview server.
 */
export function assertPreviewContext(componentName: string): void {
  const g = globalThis as { process?: { env?: Record<string, string> } };
  const inPreview =
    typeof import.meta !== 'undefined' &&
    (import.meta as { env?: { SUB_PREVIEW?: string } }).env?.SUB_PREVIEW === '1';
  const inNodePreview = g.process?.env?.SUB_PREVIEW === '1';

  if (!inPreview && !inNodePreview) {
    throw new Error(
      `@lamina/blueprint: <${componentName}> is a planning artifact only. ` +
        'Do not import in production code. Read .lamina/blueprints/ as a spec.',
    );
  }
}

export function isPreviewEnv(): boolean {
  const g = globalThis as { process?: { env?: Record<string, string> } };
  return (
    (typeof import.meta !== 'undefined' &&
      (import.meta as { env?: { SUB_PREVIEW?: string } }).env?.SUB_PREVIEW === '1') ||
    g.process?.env?.SUB_PREVIEW === '1'
  );
}
