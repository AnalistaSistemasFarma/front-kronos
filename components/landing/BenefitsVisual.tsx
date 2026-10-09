import {
  IconChartLine,
  IconCertificate,
  IconTarget,
  IconTrendingDown,
  IconStack2,
  IconUserStar,
} from '@tabler/icons-react';
import styles from './landing.module.css';

/** Barras de costos operativos (alto en %), bajando mes a mes. */
const COST_BARS = [92, 84, 77, 68, 60, 53, 46];

const BADGES = [
  { icon: IconCertificate, label: 'Cumplimiento normativo' },
  { icon: IconStack2, label: 'Escalable' },
  { icon: IconUserStar, label: 'Expertise especializado' },
];

/**
 * Ilustración de la sección Beneficios: un panel tipo macOS con lo que dice la lista (ahorro de
 * costos, eficiencia, satisfacción, cumplimiento, escalabilidad, enfoque). Sin datos inventados:
 * usa las mismas cifras de la página (35% de ahorro, 98% de satisfacción). GSAP lo arma al
 * llegar (data-bv*), y sin JS se ve completo.
 */
export default function BenefitsVisual() {
  return (
    <div className={styles.bvWrap} data-bv>
      <span className={styles.bvGlow} aria-hidden />

      <div className={styles.bvCard} role='img' aria-label='Panel con ahorro de costos del 35%, eficiencia en aumento, 98% de satisfacción del cliente y cumplimiento normativo'>
        <div className={styles.bvBar} aria-hidden>
          <span className={`${styles.light} ${styles.lightRed}`} />
          <span className={`${styles.light} ${styles.lightYellow}`} />
          <span className={`${styles.light} ${styles.lightGreen}`} />
          <span className={styles.bvBarTitle}>Panel de operaciones</span>
        </div>

        <div className={styles.bvGrid} aria-hidden>
          {/* Costos operativos */}
          <div className={`${styles.bvPanel} ${styles.bvCost}`} data-bv-panel>
            <div className={styles.bvPanelHead}>
              <span className={styles.bvIcon}>
                <IconTrendingDown size={15} />
              </span>
              Costos operativos
            </div>
            <div className={styles.bvBig}>
              −35<small>%</small>
            </div>
            <div className={styles.bvBars}>
              {COST_BARS.map((h, i) => (
                <span
                  key={i}
                  data-bv-bar
                  className={`${styles.bvBarItem} ${i === COST_BARS.length - 1 ? styles.bvBarActive : ''}`}
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>

          {/* Satisfacción */}
          <div className={`${styles.bvPanel} ${styles.bvRingPanel}`} data-bv-panel>
            <div className={styles.bvPanelHead}>Satisfacción</div>
            <div className={styles.bvRing}>
              <svg viewBox='0 0 100 100'>
                <defs>
                  <linearGradient id='bv-ring' x1='0' y1='0' x2='1' y2='1'>
                    <stop offset='0%' stopColor='#3db6e0' />
                    <stop offset='100%' stopColor='#113562' />
                  </linearGradient>
                </defs>
                <circle className={styles.bvRingTrack} cx='50' cy='50' r='40' />
                <circle
                  className={styles.bvRingValue}
                  data-bv-ring
                  cx='50'
                  cy='50'
                  r='40'
                  pathLength={100}
                />
              </svg>
              <span className={styles.bvRingText}>98%</span>
            </div>
          </div>

          {/* Calidad y eficiencia */}
          <div className={`${styles.bvPanel} ${styles.bvLinePanel}`} data-bv-panel>
            <div className={styles.bvPanelHead}>
              <span className={styles.bvIcon}>
                <IconChartLine size={15} />
              </span>
              Calidad y eficiencia de procesos
            </div>
            <svg className={styles.bvLine} viewBox='0 0 300 80' preserveAspectRatio='none'>
              <defs>
                <linearGradient id='bv-area' x1='0' y1='0' x2='0' y2='1'>
                  <stop offset='0%' stopColor='#3db6e0' stopOpacity='0.35' />
                  <stop offset='100%' stopColor='#3db6e0' stopOpacity='0' />
                </linearGradient>
                <linearGradient id='bv-stroke' x1='0' y1='0' x2='1' y2='0'>
                  <stop offset='0%' stopColor='#113562' />
                  <stop offset='100%' stopColor='#3db6e0' />
                </linearGradient>
              </defs>
              <path
                data-bv-area
                d='M0 66 C 40 64, 55 50, 90 50 S 140 40, 170 34 S 230 22, 260 14 S 290 8, 300 6 L 300 80 L 0 80 Z'
                fill='url(#bv-area)'
              />
              <path
                data-bv-line
                d='M0 66 C 40 64, 55 50, 90 50 S 140 40, 170 34 S 230 22, 260 14 S 290 8, 300 6'
                fill='none'
                stroke='url(#bv-stroke)'
                strokeWidth='3'
                strokeLinecap='round'
                vectorEffect='non-scaling-stroke'
              />
            </svg>
          </div>

          {/* Cumplimiento, escalabilidad, expertise */}
          <div className={styles.bvBadges}>
            {BADGES.map((b) => {
              const Icon = b.icon;
              return (
                <span key={b.label} className={styles.bvBadge} data-bv-badge>
                  <Icon size={15} />
                  {b.label}
                  <span className={styles.bvTick}>✓</span>
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* Enfoque en el core business */}
      <div className={styles.bvFloat} data-bv-float aria-hidden>
        <span className={styles.bvFloatIcon}>
          <IconTarget size={18} />
        </span>
        <b>Enfoque en tu core business</b>
      </div>
    </div>
  );
}
