import { useEffect, useState } from 'react';
import type { ScenarioEntry } from '../scenarios.js';
import { whenLabel } from '../studio/when-label.js';

interface AnnotationOverlayProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  scenarios: ScenarioEntry[];
  highlightScenarioId?: string | null;
}

function findAnchorElement(container: HTMLElement, subject: string): HTMLElement | null {
  const selectors = [
    `[data-sub-source="${subject}"]`,
    `[data-source="${subject}"]`,
    `[data-sub-name="${subject}"]`,
    `[data-name="${subject}"]`,
    `[data-sub-trigger="${subject}"]`,
    `[data-trigger="${subject}"]`,
  ];
  for (const sel of selectors) {
    const el = container.querySelector(sel);
    if (el instanceof HTMLElement) return el;
  }
  return null;
}

export function AnnotationOverlay({
  containerRef,
  scenarios,
  highlightScenarioId,
}: AnnotationOverlayProps) {
  const [pins, setPins] = useState<
    {
      id: string;
      title: string;
      top: number;
      left: number;
      width: number;
      height: number;
      active: boolean;
      index: number;
    }[]
  >([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !scenarios.length) {
      setPins([]);
      return;
    }

    const stage = container.querySelector('.sub-preview-stage');
    if (!stage) return;

    const stageRect = stage.getBoundingClientRect();
    const next = scenarios.map((s, index) => {
      const anchor = findAnchorElement(container, s.trigger.subject);
      const rect = anchor?.getBoundingClientRect();
      if (rect) {
        return {
          id: s.id,
          title: s.title,
          top: rect.top - stageRect.top,
          left: rect.left - stageRect.left,
          width: rect.width,
          height: rect.height,
          active: highlightScenarioId === s.id,
          index: index + 1,
        };
      }
      return {
        id: s.id,
        title: s.title,
        top: 8,
        left: 8,
        width: stageRect.width - 16,
        height: 40,
        active: highlightScenarioId === s.id,
        index: index + 1,
      };
    });
    setPins(next);
  }, [containerRef, scenarios, highlightScenarioId, containerRef.current]);

  if (!pins.length) return null;

  return (
    <div className="sub-annotation-layer" aria-hidden>
      {pins.map((pin) => (
        <div
          key={pin.id}
          className={`sub-annotation-pin-wrap${pin.active ? ' active' : ''}`}
          style={{
            top: pin.top,
            left: pin.left,
            width: pin.width,
            height: pin.height,
          }}
        >
          <div className="sub-annotation-outline" />
          <span className="sub-annotation-pin">{pin.index}</span>
          {pin.active ? (
            <div className="sub-annotation-callout">
              <strong>{pin.title}</strong>
              <span>
                {scenarios.find((s) => s.id === pin.id)?.category} ·{' '}
                {whenLabel(scenarios.find((s) => s.id === pin.id)!.trigger.when)}
              </span>
              <span className="sub-studio-muted">
                Pattern: {scenarios.find((s) => s.id === pin.id)?.ux}
              </span>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
