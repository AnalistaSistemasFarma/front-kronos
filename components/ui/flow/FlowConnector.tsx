import type { CSSProperties } from 'react';
import styles from './flowConnector.module.css';

export type FlowConnectorTone = 'ok' | 'editing';

/**
 * Conector animado entre pasos de un flujo (barritas que "transmiten" hacia el siguiente
 * paso). `tone`: verde = estado final / estable; ámbar = en edición. `active=false` lo
 * deja punteado y quieto.
 */
export function FlowConnector({
  active = true,
  tone = 'ok',
  height = 48,
}: {
  active?: boolean;
  tone?: FlowConnectorTone;
  /** Alto del riel en px. */
  height?: number;
}) {
  const toneClass = tone === 'editing' ? styles.toneEditing : styles.toneOk;
  return (
    <div
      className={`${styles.connector} ${toneClass} ${active ? '' : styles.idle}`}
      style={{ '--flow-h': `${height}px` } as CSSProperties}
      aria-hidden
    >
      <div className={styles.rail}>
        <span className={styles.packet} />
        <span className={styles.packet} />
        <span className={styles.packet} />
      </div>
      <span className={styles.node} />
    </div>
  );
}
