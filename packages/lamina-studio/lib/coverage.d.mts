import type { CoverageData } from '../preview/studio/types.js';

export function loadCoverageForRun(
  laminaRoot: string,
  runId: string,
  fs: typeof import('node:fs'),
  runMod: { resolveRunPath: (a: string, b: string) => string; parseRunYaml: (s: string) => Record<string, unknown> },
): CoverageData;
export function plainLanguageTrigger(trigger: { operation: string; when: string }): string;
export function whenToLabel(when: string): string;
