'use client';

import { Tooltip } from '@mantine/core';
import {
  IconAlarm,
  IconAlertTriangle,
  IconCircleCheck,
  IconHourglassEmpty,
  IconInfoCircle,
  IconPlayerPause,
} from '@tabler/icons-react';
import { useEffect, type ReactNode } from 'react';
import type { StatusTone } from '../../ui/panel/Panel';
import { StatFilterTile } from '../list/RequestListUi';
import styles from '../list/requestList.module.css';
import { IndicatorSettings } from './IndicatorSettings';
import { useIndicatorPrefs } from './useIndicatorPrefs';
import type { InboxSlaBreakdown, InboxSlaCounts, InboxSlaState } from '../../../lib/requests-general/slaInbox';

const TILES: { state: InboxSlaState; label: string; tone: StatusTone | 'violet'; icon: ReactNode }[] = [
  { state: 'overdue', label: 'Vencidos', tone: 'critical', icon: <IconAlarm size={20} /> },
  { state: 'near_due', label: 'Próximos a vencer', tone: 'warning', icon: <IconAlertTriangle size={20} /> },
  { state: 'on_time', label: 'Dentro del tiempo', tone: 'ok', icon: <IconCircleCheck size={20} /> },
  { state: 'no_sla', label: 'Sin ANS', tone: 'idle', icon: <IconHourglassEmpty size={20} /> },
  { state: 'paused', label: 'En pausa', tone: 'violet', icon: <IconPlayerPause size={20} /> },
];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const HELP =
  'ANS de los trámites pendientes (las mismas solicitudes y tareas de «Pendientes»). Tiempo hábil: lunes a viernes, 8:00 a 17:00, sin festivos. ' +
  'Próximos a vencer: les queda el 20 % o menos del ANS. Sin ANS: el subproceso no tiene ANS configurado. ' +
  'En pausa: la solicitud está devuelta o cerrada y su reloj está detenido. Toque una tarjeta para filtrar la lista.';

/**
 * «ANS» row of the inbox: same tiles as the status cards (Total, Pendientes…). The numbers
 * come from `countInboxSla`, the same function the list filter uses, so a tile always shows
 * exactly the rows it filters. «En pausa» only appears when there is something paused.
 */
export function SlaSummaryCards({
  available,
  counts,
  breakdown,
  selected,
  onSelect,
  showStatusOptions = false,
}: {
  available: boolean;
  counts: InboxSlaCounts;
  breakdown?: InboxSlaBreakdown;
  selected: InboxSlaState | null;
  onSelect: (state: InboxSlaState | null) => void;
  /** Also offer the status cards (Total, Pendientes…) in the settings (inbox only). */
  showStatusOptions?: boolean;
}) {
  const { prefs, isVisible, setSlaHidden } = useIndicatorPrefs();
  const selectedHidden = selected != null && (prefs.slaHidden || !isVisible(`sla.${selected}`));
  // A hidden card cannot keep filtering the list.
  useEffect(() => {
    if (selectedHidden) onSelect(null);
  }, [selectedHidden, onSelect]);
  if (!available) return null;
  if (prefs.slaHidden) {
    return (
      <div className={styles.slaHead} data-testid='sla-summary-hidden' style={{ marginBottom: 12 }}>
        <button type='button' className={styles.slaShowLink} onClick={() => setSlaHidden(false)}>
          Mostrar indicadores de ANS
        </button>
        <IndicatorSettings showStatusOptions={showStatusOptions} />
      </div>
    );
  }
  const tiles = TILES.filter((t) => (t.state !== 'paused' || counts.paused > 0) && isVisible(`sla.${t.state}`));
  return (
    <section data-testid='sla-summary' style={{ marginBottom: 12 }}>
      <div className={styles.slaHead}>
        <span>ANS de pendientes</span>
        <IndicatorSettings showStatusOptions={showStatusOptions} />
        <Tooltip label={HELP} multiline w={320} withArrow events={{ hover: true, focus: true, touch: true }}>
          <button type='button' className={styles.slaInfo} aria-label='Cómo se calcula el ANS'>
            <IconInfoCircle size={15} />
          </button>
        </Tooltip>
      </div>
      {tiles.length > 0 ? (
        <div className={`${styles.statGrid} ${styles.slaGrid}`}>
        {tiles.map((t) => {
          const b = breakdown?.[t.state];
          return (
            <span key={t.state} data-testid={`sla-card-${t.state}`} style={{ display: 'contents' }}>
              <StatFilterTile
                icon={t.icon}
                label={t.label}
                value={counts[t.state]}
                tone={t.tone}
                active={selected === t.state}
                onClick={() => onSelect(selected === t.state ? null : t.state)}
                ariaLabel={`Mostrar trámites: ${t.label.toLowerCase()}`}
                hint={b ? `${plural(b.requests, 'solicitud', 'solicitudes')} · ${plural(b.tasks, 'tarea', 'tareas')}` : undefined}
              />
            </span>
          );
        })}
        </div>
      ) : null}
    </section>
  );
}
