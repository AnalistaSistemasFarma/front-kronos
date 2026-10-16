'use client';

import styles from './requestProgressBar.module.css';

/**
 * Barra de avance de tareas de una solicitud ("2/3"): se rellena al cargar y un destello
 * la recorre mientras no está completa. Completa queda verde y quieta.
 */
export function RequestProgressBar({
  done,
  total,
  percent,
}: {
  done: number;
  total: number;
  percent: number;
}) {
  const complete = percent === 100;
  return (
    <div className={`${styles.progress} ${complete ? styles.done : ''}`}>
      <span
        className={styles.track}
        role='progressbar'
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label='Avance de tareas'
      >
        <span className={styles.fill} style={{ width: `${percent}%` }} />
      </span>
      {done}/{total}
    </div>
  );
}
