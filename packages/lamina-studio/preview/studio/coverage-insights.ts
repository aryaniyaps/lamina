import type { CoverageData, CoverageGap } from './types.js';
import {
  formatGapSummary as formatGapSummaryLib,
  flowCoverageInsights as flowCoverageInsightsLib,
  gapCountByScreenForFlow as gapCountByScreenForFlowLib,
} from '../../lib/coverage-insights.mjs';
import { categoryLabel } from './scenario-categories.js';

export interface FlowCoverageInsights {
  flowId: string;
  gaps: CoverageGap[];
  gapCount: number;
  score: number;
}

export function gapsByFlow(coverage: CoverageData | null): Map<string, CoverageGap[]> {
  const map = new Map<string, CoverageGap[]>();
  for (const gap of coverage?.gaps ?? []) {
    const list = map.get(gap.flowId) ?? [];
    list.push(gap);
    map.set(gap.flowId, list);
  }
  return map;
}

export function gapCountByScreenForFlow(
  coverage: CoverageData | null,
  flowId: string,
): Map<string, number> {
  return gapCountByScreenForFlowLib(coverage, flowId);
}

export function flowCoverageInsights(
  coverage: CoverageData | null,
  flowId: string,
): FlowCoverageInsights {
  return flowCoverageInsightsLib(coverage, flowId) as FlowCoverageInsights;
}

export function formatGapSummary(gap: CoverageGap): string {
  return formatGapSummaryLib(gap);
}

export { categoryLabel };
