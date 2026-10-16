'use client';

import { useMemo, useState } from 'react';
import { useTheme } from '../providers';
import { avatarColor, moduleColor, moduleSlot } from './colors';
import { FlowLayer, flowWeights, type FlowEdge } from './FlowLayer';
import { formatInt, formatMs, formatValue, initialsOf } from './format';
import type { UserRow } from './types';
import styles from './monitor.module.css';

// Se muestran TODAS las personas y TODOS los módulos (antes: 6 y 7, y el resto agrupado en
// "Otras N personas" / "Otros módulos"). Las constantes de "otros" quedan por si una fila vieja
// llega sin módulo.
const OTHER_USERS = 'otros-usuarios';
const OTHER_MODULES_KEY = 'Otros módulos';

/** Los módulos sin color fijo toman uno estable por nombre (si no, todos saldrían grises). */
function moduleFlowColor(label: string, isDark: boolean): string {
  if (label === OTHER_MODULES_KEY) return 'var(--sm-idle)';
  return moduleSlot(label) != null ? moduleColor(label, isDark) : avatarColor(label, isDark);
}

/**
 * Comportamiento de las personas: a qué módulos de Kronos va el tiempo de servidor de cada una.
 * Diagrama de flujo personas → módulos con los mismos datos del ranking (no consulta nada más).
 * Al pasar el mouse por una persona o un módulo se resaltan solo sus conexiones.
 */
export function UserBehavior({ users, rangeMinutes }: { users: UserRow[]; rangeMinutes: number }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  const colorOf = (label: string) => moduleFlowColor(label, isDark);

  const model = useMemo(() => {
    const top = users;
    const rest: UserRow[] = [];

    const moduleOf = (label: string) => label || OTHER_MODULES_KEY;

    type Source = { id: string; name: string; email: string | null; totalMs: number; requests: number; modules: Map<string, number> };
    const sources: Source[] = top.map((u) => {
      const modules = new Map<string, number>();
      for (const m of u.modules) modules.set(moduleOf(m.label), (modules.get(moduleOf(m.label)) ?? 0) + m.totalMs);
      return { id: u.email, name: u.name ?? u.email, email: u.email, totalMs: u.totalMs, requests: u.requests, modules };
    });
    if (rest.length) {
      const modules = new Map<string, number>();
      let totalMs = 0;
      let requests = 0;
      for (const u of rest) {
        totalMs += u.totalMs;
        requests += u.requests;
        for (const m of u.modules) modules.set(moduleOf(m.label), (modules.get(moduleOf(m.label)) ?? 0) + m.totalMs);
      }
      sources.push({
        id: OTHER_USERS,
        name: `Otras ${formatInt(rest.length)} ${rest.length === 1 ? 'persona' : 'personas'}`,
        email: null,
        totalMs,
        requests,
        modules,
      });
    }

    const targets = new Map<string, { label: string; totalMs: number; people: number }>();
    for (const s of sources) {
      for (const [label, ms] of s.modules) {
        const t = targets.get(label) ?? { label, totalMs: 0, people: 0 };
        t.totalMs += ms;
        targets.set(label, t);
      }
    }
    for (const u of users) {
      for (const label of new Set(u.modules.map((m) => moduleOf(m.label)))) {
        const t = targets.get(label);
        if (t) t.people += 1;
      }
    }
    const targetList = Array.from(targets.values()).sort((a, b) =>
      a.label === OTHER_MODULES_KEY ? 1 : b.label === OTHER_MODULES_KEY ? -1 : b.totalMs - a.totalMs
    );

    const raw: Array<{ source: Source; label: string; ms: number }> = [];
    for (const s of sources) for (const [label, ms] of s.modules) raw.push({ source: s, label, ms });
    const weights = flowWeights(raw.map((r) => r.ms));
    const edges: FlowEdge[] = raw.map((r, i) => {
      const share = r.source.totalMs ? r.ms / r.source.totalMs : 0;
      return {
        id: `${r.source.id}->${r.label}`,
        from: `p:${r.source.id}`,
        to: `m:${r.label}`,
        weight: weights[i],
        rate: (r.source.requests * share) / Math.max(1, rangeMinutes),
        color: moduleFlowColor(r.label, isDark),
        title: `${r.source.name} → ${r.label}: ${formatMs(r.ms)} de servidor (${formatValue(share * 100, 0)} % de su consumo)`,
      };
    });
    return { sources, targets: targetList, edges };
  }, [users, rangeMinutes, isDark]);

  if (users.length === 0 || model.targets.length === 0) {
    return <div className={styles.empty}>Todavía no hay actividad de usuarios para dibujar su comportamiento.</div>;
  }

  return (
    <div ref={setStage} className={styles.flowStage}>
      <FlowLayer container={stage} edges={model.edges} highlight={focus} />
      <div className={`${styles.flowGrid} ${styles.flowGrid2}`}>
        <div className={styles.flowColumn}>
          <div className={styles.flowColumnTitle}>Personas</div>
          {model.sources.map((s) => {
            const [mainLabel, mainMs] = Array.from(s.modules.entries()).sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
            const color = s.email ? avatarColor(s.email, isDark) : 'var(--sm-idle)';
            return (
              <button
                key={s.id}
                type="button"
                data-flow-node={`p:${s.id}`}
                className={styles.userNode}
                onMouseEnter={() => setFocus(`p:${s.id}`)}
                onMouseLeave={() => setFocus(null)}
                onFocus={() => setFocus(`p:${s.id}`)}
                onBlur={() => setFocus(null)}
                aria-label={`${s.name}: ${formatMs(s.totalMs)} de servidor; sobre todo ${mainLabel}`}
              >
                <span className={styles.userAvatar} style={{ background: `color-mix(in srgb, ${color} 26%, transparent)` }} aria-hidden>
                  {s.email ? initialsOf(s.name === s.email ? null : s.name, s.email) : '+'}
                </span>
                <span style={{ minWidth: 0 }}>
                  <div className={styles.rowTitle}>{s.name}</div>
                  <div className={styles.rowSub} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {mainLabel ? `${formatValue(s.totalMs ? (mainMs / s.totalMs) * 100 : 0, 0)} % en ${mainLabel}` : 'sin detalle'}
                  </div>
                </span>
                <span className={styles.rowMetric}>{formatMs(s.totalMs)}</span>
              </button>
            );
          })}
        </div>

        <div className={styles.flowColumn}>
          <div className={styles.flowColumnTitle}>Módulos</div>
          {model.targets.map((t) => (
            <button
              key={t.label}
              type="button"
              data-flow-node={`m:${t.label}`}
              className={styles.userNode}
              style={{ gridTemplateColumns: '12px minmax(0, 1fr) auto' }}
              onMouseEnter={() => setFocus(`m:${t.label}`)}
              onMouseLeave={() => setFocus(null)}
              onFocus={() => setFocus(`m:${t.label}`)}
              onBlur={() => setFocus(null)}
              aria-label={`${t.label}: ${formatMs(t.totalMs)} de servidor de ${formatInt(t.people)} personas`}
            >
              <span className={styles.swatch} style={{ background: colorOf(t.label) }} aria-hidden />
              <span style={{ minWidth: 0 }}>
                <div className={styles.rowTitle}>{t.label}</div>
                <div className={styles.rowSub}>
                  {formatInt(t.people)} {t.people === 1 ? 'persona' : 'personas'}
                </div>
              </span>
              <span className={styles.rowMetric}>{formatMs(t.totalMs)}</span>
            </button>
          ))}
        </div>
      </div>
      <p className={styles.cardHint} style={{ marginTop: 12, marginBottom: 0 }}>
        Pase el mouse por una persona o un módulo para ver solo sus conexiones. El reparto por módulo es aproximado: cada
        bloque de 5 minutos se asigna al módulo donde la persona gastó más tiempo.
      </p>
    </div>
  );
}
