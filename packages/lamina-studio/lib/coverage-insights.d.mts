import type { CoverageData, CoverageGap } from '../preview/studio/types.js';

export const CATEGORY_LABELS: Record<string, string>;

export function categoryLabel(category: string): string;

export function gapCountByScreenForFlow(
  coverage: CoverageData | null,
  flowId: string,
): Map<string, number>;

export function flowCoverageInsights(
  coverage: CoverageData | null,
  flowId: string,
): { flowId: string; gaps: CoverageGap[]; gapCount: number; score: number };

export function formatGapSummary(gap: CoverageGap): string;
