'use client';

import { useState } from 'react';
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCloud,
  IconDatabase,
  IconInfoCircle,
  IconServer2,
  IconActivity,
  IconHourglassHigh,
} from '@tabler/icons-react';
import type { Insight, InsightArea, Severity, Verdict } from '../../lib/system-metrics/insights';
import { STATUS_LABEL, type StatusTone } from './colors';
import styles from './monitor.module.css';

const AREA_ICON: Record<InsightArea, typeof IconServer2> = {
  servidor: IconServer2,
  trafico: IconActivity,
  base: IconDatabase,
  externos: IconCloud,
};

const AREA_LABEL: Record<InsightArea, string> = {
  servidor: 'Servidor',
  trafico: 'Tráfico',
  base: 'Base de datos',
  externos: 'Servicios externos',
};

export function toneOf(severity: Severity | 'idle'): StatusTone {
  return severity === 'idle' ? 'idle' : severity;
}

export function ToneIcon({ tone, size = 16 }: { tone: StatusTone; size?: number }) {
  if (tone === 'ok') return <IconCircleCheck size={size} stroke={2} />;
  if (tone === 'info') return <IconInfoCircle size={size} stroke={2} />;
  if (tone === 'idle') return <IconHourglassHigh size={size} stroke={2} />;
  return <IconAlertTriangle size={size} stroke={2} />;
}

export function ToneChip({ tone, label }: { tone: StatusTone; label?: string }) {
  return (
    <span className={`${styles.toneChip} ${styles[`tone-${tone}`]}`}>
      <ToneIcon tone={tone} size={12} />
      {label ?? STATUS_LABEL[tone]}
    </span>
  );
}

const COLLAPSED = 4;

export function StatusHero({
  verdict,
  insights,
  highlights = [],
  hasData,
}: {
  verdict: Verdict;
  insights: Insight[];
  /** Lo que va bien (buildHighlights): se muestra antes de los hallazgos. */
  highlights?: Insight[];
  hasData: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const tone = hasData ? toneOf(verdict.severity) : 'idle';
  const visible = expanded ? insights : insights.slice(0, COLLAPSED);

  return (
    <section className={`${styles.hero} ${styles[`tone-${tone}`]}`} aria-live="polite">
      <div className={styles.heroTop}>
        <div className={styles.orb} aria-hidden>
          <ToneIcon tone={tone} size={30} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className={styles.heroKicker}>
            <ToneIcon tone={tone} size={14} />
            {tone === 'ok' ? 'Estado del sistema: normal' : `Estado del sistema: ${STATUS_LABEL[tone].toLowerCase()}`}
          </div>
          <h2 className={styles.heroHeadline}>{verdict.headline}</h2>
          <p className={styles.heroSub}>{verdict.sub}</p>
        </div>
      </div>

      {hasData && highlights.length > 0 && (
        <div className={`${styles.highlights} ${styles['tone-ok']}`} role="list" aria-label="Lo que va bien">
          <div className={styles.highlightsTitle}>Lo que va bien</div>
          {highlights.map((h) => {
            const AreaIcon = AREA_ICON[h.area];
            return (
              <div key={h.id} role="listitem" className={styles.highlight} title={h.detail}>
                <span className={styles.highlightIcon} aria-hidden>
                  <AreaIcon size={15} stroke={2} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className={styles.highlightTitle}>{h.title}</span>
                  <span className={styles.highlightDetail}>{h.detail}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {insights.length > 0 && (
        <div className={styles.insightList} role="list" aria-label="Hallazgos">
          {visible.map((insight) => {
            const AreaIcon = AREA_ICON[insight.area];
            const t = toneOf(insight.severity);
            return (
              <div key={insight.id} role="listitem" className={`${styles.insightRow} ${styles[`tone-${t}`]}`}>
                <div className={styles.insightIcon} aria-hidden>
                  <AreaIcon size={17} stroke={2} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className={styles.insightTitle}>{insight.title}</div>
                  <div className={styles.insightDetail}>
                    {AREA_LABEL[insight.area]} · {insight.detail}
                  </div>
                </div>
                <ToneChip tone={t} />
              </div>
            );
          })}
          {insights.length > COLLAPSED && (
            <button type="button" className={styles.linkButton} onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Ver menos' : `Ver los ${insights.length} hallazgos`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
