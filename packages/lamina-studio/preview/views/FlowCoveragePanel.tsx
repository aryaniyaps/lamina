import { useMemo, useState } from 'react';
import { formatGapSummary, flowCoverageInsights } from '../studio/coverage-insights.js';
import { CATEGORY_LABELS, SCENARIO_CATEGORIES } from '../studio/scenario-categories.js';
import { useStudio } from '../studio/StudioContext.js';
import type { CoverageGap } from '../studio/types.js';

function GapListItem({ gap }: { gap: CoverageGap }) {
  return (
    <div className="sub-studio-insight-gap-item">
      <span className="sub-studio-insight-gap-title">
        {gap.operation} — {CATEGORY_LABELS[gap.category] ?? gap.category}
      </span>
      <span className="sub-studio-muted">{formatGapSummary(gap)}</span>
      <span className="sub-studio-muted">Screen: {gap.screenId}</span>
    </div>
  );
}

export function FlowCoveragePanel({ activeFlowId }: { activeFlowId: string }) {
  const { coverage, navigate } = useStudio();
  const [showAllGaps, setShowAllGaps] = useState(false);

  const insights = useMemo(
    () => flowCoverageInsights(coverage, activeFlowId),
    [coverage, activeFlowId],
  );

  const allGaps = coverage?.gaps ?? [];
  const operations = (coverage?.operations ?? []).filter((op) => op.flowId === activeFlowId);
  const cells = (coverage?.cells ?? []).filter((cell) => cell.flowId === activeFlowId);

  if (!activeFlowId) return null;

  return (
    <aside className="sub-studio-insights-panel" aria-label="Edge case coverage">
      <header className="sub-studio-insights-header">
        <h3>Edge cases</h3>
        <span className="sub-studio-insights-score">
          {insights.score}% covered · {insights.gapCount} gap{insights.gapCount === 1 ? '' : 's'}
        </span>
      </header>

      <section className="sub-studio-insights-section">
        <h4>This flow</h4>
        {insights.gapCount ? (
          <ul className="sub-studio-insight-gap-list">
            {insights.gaps.map((gap) => (
              <li key={`${gap.operationId}-${gap.category}`}>
                <GapListItem gap={gap} />
                <button
                  type="button"
                  className="sub-studio-link-action"
                  onClick={() => navigate({ screenId: gap.screenId, flowId: gap.flowId })}
                >
                  Go to screen
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="sub-studio-muted">All required edge cases are covered for this flow.</p>
        )}
      </section>

      {allGaps.length ? (
        <section className="sub-studio-insights-section">
          <button
            type="button"
            className="sub-studio-advanced-toggle"
            aria-expanded={showAllGaps}
            onClick={() => setShowAllGaps((v) => !v)}
          >
            {showAllGaps ? 'Hide' : 'Show'} all gaps ({allGaps.length})
          </button>
          {showAllGaps ? (
            <div className="sub-studio-insights-all-gaps">
              <ul className="sub-studio-insight-gap-list">
                {allGaps.map((gap) => (
                  <li
                    key={`${gap.flowId}-${gap.operationId}-${gap.category}-${gap.screenId}`}
                    className="sub-studio-insight-gap-row"
                  >
                    <GapListItem gap={gap} />
                    <button
                      type="button"
                      className="sub-studio-link-action"
                      onClick={() => navigate({ screenId: gap.screenId, flowId: gap.flowId })}
                    >
                      Go to screen
                    </button>
                  </li>
                ))}
              </ul>
              {operations.length ? (
                <details className="sub-studio-insights-matrix-details">
                  <summary>Edge case matrix</summary>
                  <div className="sub-studio-matrix-wrap">
                    <p className="sub-studio-matrix-legend sub-studio-muted">
                      ● Covered · ○ Missing · — Not required
                    </p>
                    <table className="sub-studio-matrix">
                      <thead>
                        <tr>
                          <th>Operation</th>
                          {SCENARIO_CATEGORIES.map((c) => (
                            <th key={c} title={CATEGORY_LABELS[c]}>
                              {CATEGORY_LABELS[c]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {operations.map((op) => (
                          <tr key={op.id}>
                            <td>{op.operation}</td>
                            {SCENARIO_CATEGORIES.map((cat) => {
                              const cell = cells.find(
                                (c) => c.operationId === op.id && c.category === cat,
                              );
                              if (!cell?.required) {
                                return (
                                  <td key={cat} className="sub-studio-matrix-na">
                                    —
                                  </td>
                                );
                              }
                              return (
                                <td key={cat}>
                                  <span
                                    className={
                                      cell.covered
                                        ? 'sub-studio-matrix-covered'
                                        : 'sub-studio-matrix-gap'
                                    }
                                    title={cell.covered ? 'Covered' : 'Missing'}
                                  >
                                    {cell.covered ? '●' : '○'}
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </aside>
  );
}
