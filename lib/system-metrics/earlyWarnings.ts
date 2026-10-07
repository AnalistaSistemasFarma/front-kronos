/**
 * Alertas tempranas del Monitor del sistema.
 *
 * A diferencia de insights.ts (que describe un rango para la pantalla), aquí se mira solo la
 * última hora, minuto a minuto, buscando las señales que anteceden a una caída del servidor:
 * memoria que se va a llenar, CPU pegada arriba, la máquina entera congelándose (disco de la
 * VM), Kronos duplicado o reiniciándose en bucle, minutos sin datos, SQL atascado.
 *
 * Cada alerta trae el texto completo que recibe la persona: qué está pasando, por qué suele
 * pasar, qué puede pasar si sigue y qué hacer. Es una función PURA (sin SQL ni fetch) para
 * probar cada regla; lib/system-metrics/alertJob.ts la corre cada minuto y notifica.
 */

import { judgeLog, type LogContext } from './logHealth';

export type WarningSeverity = 'warning' | 'critical';

export type WarningRule =
  | 'duplicados'
  | 'congelamiento'
  | 'memoria'
  | 'cpu'
  | 'reinicios'
  | 'reinicio-total'
  | 'sin-datos'
  | 'proceso-bloqueado'
  | 'memoria-kronos'
  | 'conexiones-sql'
  | 'bloqueos-sql'
  | 'log-sql'
  | 'errores';

/** Una fila de system_metric_sample (un proceso de Kronos, un minuto). */
export type WatchSample = {
  sampledAt: string;
  host: string;
  instance: string;
  pid: number;
  hostCpuPct: number | null;
  hostMemUsedPct: number | null;
  hostMemTotalMb: number | null;
  rssMb: number | null;
  eventLoopP99Ms: number | null;
  eventLoopMaxMs: number | null;
  httpRequests: number;
  httpErrors: number;
  poolPending: number | null;
};

export type WatchDbSample = {
  sampledAt: string;
  blockedRequests: number | null;
  longestWaitMs: number | null;
  logUsedPct: number | null;
};

export type WatchInput = {
  now: Date;
  samples: WatchSample[];
  db: WatchDbSample[];
  /** Procesos de Kronos que deberían correr por servidor (instancias de pm2). */
  expectedProcesses: number;
  /** Estado del log de la base (si puede crecer, disco libre…); sin él se usan umbrales fijos. */
  logContext?: LogContext | null;
  timeZone?: string;
};

export type EarlyWarning = {
  key: string;
  rule: WarningRule;
  severity: WarningSeverity;
  title: string;
  happening: string;
  why: string;
  risk: string;
  action: string;
};

export const WARNING_THRESHOLDS = {
  /** Event loop quieto este tiempo en VARIOS procesos a la vez = la máquina se congeló. */
  freezeMs: 2000,
  freezeCriticalMs: 10_000,
  freezeLookbackMin: 15,
  hostMem: { warning: 85, critical: 92 },
  /** Proyección: si la memoria sube a este ritmo, ¿en cuántos minutos llega a `fullPct`? */
  memProjection: { lookbackMin: 20, minPoints: 10, minRise: 3, minPct: 70, fullPct: 95, horizonMin: 45 },
  /** CPU del servidor por encima del umbral en CADA uno de los últimos `minutes` minutos. */
  hostCpu: { warning: 75, critical: 90, minutes: 5 },
  restartsLookbackMin: 60,
  /** Reinicio programado de pm2 (cron_restart 00:02): los procesos nuevos en esta franja no cuentan. */
  cronWindow: { fromMin: 0, toMin: 15 },
  gapMin: 3,
  gapCriticalMin: 10,
  stalledLoopMs: 500,
  stalledMinutes: 3,
  stalledLookbackMin: 5,
  kronosRssMb: { warning: 1500, critical: 2500 },
  poolPending: { warning: 5, critical: 20, minutes: 3, lookbackMin: 5 },
  sqlBlocked: { warning: 5, critical: 15 },
  sqlWaitMs: { warning: 30_000, critical: 120_000 },
  dbMaxAgeMin: 15,
  errors: { minRequests: 100, warningPct: 5, criticalPct: 20, lookbackMin: 5 },
  /** Tiempo antes de repetir la misma alerta (si no empeora). */
  cooldownMin: { warning: 120, critical: 30 },
} as const;

/** Qué vigila el notificador (texto para la pantalla). */
export const WATCH_LIST: Array<{ rule: WarningRule; label: string }> = [
  { rule: 'congelamiento', label: 'Todos los procesos se congelan a la vez (disco de la máquina virtual, snapshot o respaldo)' },
  { rule: 'memoria', label: 'Memoria del servidor alta o subiendo a un ritmo que la llenaría pronto' },
  { rule: 'cpu', label: 'CPU del servidor pegada arriba varios minutos seguidos (apps en bucle, respaldos)' },
  { rule: 'duplicados', label: 'Kronos corriendo con más copias de las que debería' },
  { rule: 'reinicios', label: 'Kronos reiniciándose varias veces, o completo fuera del reinicio de medianoche' },
  { rule: 'sin-datos', label: 'Minutos en que ningún proceso dio señales (máquina congelada, reiniciada o pm2 caído)' },
  { rule: 'proceso-bloqueado', label: 'Un proceso de Kronos ocupado sin poder atender a nadie' },
  { rule: 'memoria-kronos', label: 'Un proceso de Kronos usando demasiada memoria' },
  { rule: 'conexiones-sql', label: 'Peticiones haciendo fila para conseguir conexión a SQL' },
  { rule: 'bloqueos-sql', label: 'Consultas de SQL bloqueadas esperando a otras' },
  { rule: 'log-sql', label: 'Log de transacciones de la base que no se libera o se puede llenar' },
  { rule: 'errores', label: 'Muchas peticiones terminando en error del servidor' },
];

const MINUTE = 60_000;

const fmt = (n: number, digits = 0) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: digits }).format(n);

const minutesText = (n: number) => (n === 1 ? '1 minuto' : `${fmt(n)} minutos`);

function instanceName(instance: string): string {
  return instance === 'unica' ? 'Kronos' : `Kronos #${instance}`;
}

function floorMinute(date: Date): number {
  return Math.floor(date.getTime() / MINUTE) * MINUTE;
}

function localParts(iso: string, timeZone: string): { hhmm: string; minuteOfDay: number } {
  const parts = new Intl.DateTimeFormat('es-CO', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(
    new Date(iso)
  );
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return { hhmm: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, minuteOfDay: hour * 60 + minute };
}

type Minute = { at: number; iso: string; rows: WatchSample[] };

function groupByMinute(samples: WatchSample[]): Minute[] {
  const map = new Map<number, Minute>();
  for (const s of samples) {
    const at = Date.parse(s.sampledAt);
    if (!Number.isFinite(at)) continue;
    const m = map.get(at) ?? { at, iso: new Date(at).toISOString(), rows: [] };
    m.rows.push(s);
    map.set(at, m);
  }
  return Array.from(map.values()).sort((a, b) => a.at - b.at);
}

const distinctPids = (rows: WatchSample[]) => new Set(rows.map((r) => r.pid)).size;

function avg(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

/** Pendiente por mínimos cuadrados (unidades por minuto). */
function slopePerMinute(points: Array<{ at: number; value: number }>): number {
  const n = points.length;
  if (n < 2) return 0;
  const xs = points.map((p) => (p.at - points[0].at) / MINUTE);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = points.reduce((a, p) => a + p.value, 0) / n;
  let num = 0;
  let den = 0;
  points.forEach((p, i) => {
    num += (xs[i] - meanX) * (p.value - meanY);
    den += (xs[i] - meanX) ** 2;
  });
  return den === 0 ? 0 : num / den;
}

function levelOf(value: number, t: { warning: number; critical: number }): WarningSeverity | null {
  if (value >= t.critical) return 'critical';
  if (value >= t.warning) return 'warning';
  return null;
}

export function evaluateEarlyWarnings(input: WatchInput): EarlyWarning[] {
  const T = WARNING_THRESHOLDS;
  const tz = input.timeZone ?? 'America/Bogota';
  const nowMs = input.now.getTime();
  const nowMinute = floorMinute(input.now);
  const at = (iso: string) => localParts(iso, tz).hhmm;
  const out: EarlyWarning[] = [];

  const byHost = new Map<string, WatchSample[]>();
  for (const s of input.samples) {
    const list = byHost.get(s.host) ?? [];
    list.push(s);
    byHost.set(s.host, list);
  }
  const multiHost = byHost.size > 1;

  for (const [host, hostSamples] of byHost) {
    const suffix = multiHost ? `-${host}` : '';
    const where = multiHost ? ` (${host})` : '';
    const minutes = groupByMinute(hostSamples);
    if (!minutes.length) continue;
    // El minuto en curso puede estar incompleto (cada proceso guarda en su propio segundo).
    const settled = minutes.filter((m) => m.at < nowMinute);
    const recent = (lookbackMin: number) => minutes.filter((m) => m.at >= nowMs - lookbackMin * MINUTE);

    // --- Kronos duplicado -------------------------------------------------------------------
    const lastSettled = settled.slice(-3);
    const duplicated = lastSettled.filter((m) => {
      const pids = distinctPids(m.rows);
      const perInstance = new Map<string, Set<number>>();
      for (const r of m.rows) perInstance.set(r.instance, (perInstance.get(r.instance) ?? new Set()).add(r.pid));
      return pids > input.expectedProcesses || Array.from(perInstance.values()).some((set) => set.size > 1);
    });
    const newest = lastSettled[lastSettled.length - 1];
    if (duplicated.length >= 2 && newest && duplicated.includes(newest)) {
      const copies = distinctPids(newest.rows);
      const pids = Array.from(new Set(newest.rows.map((r) => r.pid))).join(', ');
      out.push({
        key: `duplicados${suffix}`,
        rule: 'duplicados',
        severity: 'critical',
        title: `Kronos está corriendo duplicado: ${copies} copias en vez de ${input.expectedProcesses}${where}`,
        happening: `En los últimos minutos reportaron ${copies} procesos de Kronos al mismo tiempo (pid ${pids}).`,
        why: 'Pasa cuando alguien arranca las aplicaciones a mano mientras el servicio de pm2 también las levanta, o cuando la lista guardada de pm2 (dump) quedó con la aplicación repetida.',
        risk: 'Las copias pelean por el mismo puerto: la que pierde se reinicia sin parar y se come la CPU y la memoria de toda la máquina, arrastrando a las demás aplicaciones del servidor.',
        action: 'En el servidor, con el usuario del servicio de pm2: pm2 list, dejar solo las copias de GSS-Front que corresponden y luego pm2 save para que no vuelvan después de un reinicio.',
      });
    }

    // --- La máquina entera se congela ---------------------------------------------------------
    const freezes = recent(T.freezeLookbackMin)
      .map((m) => {
        const frozen = m.rows.filter((r) => (r.eventLoopMaxMs ?? 0) >= T.freezeMs);
        return {
          m,
          frozen: new Set(frozen.map((r) => r.pid)).size,
          total: distinctPids(m.rows),
          maxMs: frozen.reduce((acc, r) => Math.max(acc, r.eventLoopMaxMs ?? 0), 0),
        };
      })
      .filter((f) => f.frozen >= 2);
    const machineFrozen = freezes.length > 0;
    if (machineFrozen) {
      const last = freezes[freezes.length - 1];
      const worstMs = freezes.reduce((acc, f) => Math.max(acc, f.maxMs), 0);
      const repeated = freezes.length >= 2;
      out.push({
        key: `congelamiento${suffix}`,
        rule: 'congelamiento',
        severity: repeated || worstMs >= T.freezeCriticalMs ? 'critical' : 'warning',
        title: repeated
          ? `El servidor se congeló ${freezes.length} veces en los últimos ${T.freezeLookbackMin} minutos${where}`
          : `El servidor se congeló ${fmt(last.maxMs / 1000, 1)} s a las ${at(last.m.iso)}${where}`,
        happening: `${last.frozen === last.total ? 'Todos los procesos' : `${last.frozen} procesos`} de Kronos se quedaron quietos al mismo tiempo (el peor, ${fmt(worstMs / 1000, 1)} s): mientras tanto nadie pudo ser atendido.`,
        why: 'Cuando varios procesos se congelan a la vez el problema no es Kronos sino la máquina: el disco de la máquina virtual dejó de responder un momento, el servidor físico la pausó (snapshot o respaldo) o la memoria se agotó y Windows está usando el disco.',
        risk: 'Es la señal previa a un congelamiento total de la máquina, el que obliga a reiniciarla a la fuerza y tumba todos los servicios. Si se repite seguido, el riesgo es alto.',
        action: 'Revisar en el servidor el Visor de eventos → Sistema (evento 153 = disco que no responde) y si a esa hora corría un respaldo de Acronis. Avisar a infraestructura con la hora exacta.',
      });
    }

    // --- Memoria del servidor -----------------------------------------------------------------
    const memPoints = minutes
      .map((m) => ({ at: m.at, value: avg(m.rows.map((r) => r.hostMemUsedPct)) }))
      .filter((p): p is { at: number; value: number } => p.value != null);
    const memNow = memPoints[memPoints.length - 1];
    if (memNow && memNow.at >= nowMs - 5 * MINUTE) {
      const totalMb = minutes[minutes.length - 1].rows.find((r) => r.hostMemTotalMb)?.hostMemTotalMb ?? null;
      const totalText = totalMb ? ` de ${fmt(totalMb / 1024, 1)} GB` : '';
      const why =
        'La memoria la comparten todas las aplicaciones de pm2, Acronis, Windows y las sesiones de escritorio remoto. Suele subir por una aplicación duplicada o reiniciándose en bucle, un respaldo, o una sesión con muchos programas abiertos.';
      const risk =
        'Cuando se llena, Windows empieza a usar el disco como memoria: todo se vuelve muy lento y los procesos empiezan a caerse. Con el disco delicado, puede terminar en un congelamiento total de la máquina.';
      const action =
        'En el servidor: Administrador de tareas → Detalles, ordenar por memoria y ver qué proceso creció. No cerrar la sesión de otros usuarios (eso apaga lo que ellos arrancaron).';
      const memLevel = levelOf(memNow.value, T.hostMem);
      if (memLevel) {
        out.push({
          key: `memoria${suffix}`,
          rule: 'memoria',
          severity: memLevel,
          title: `La memoria del servidor está al ${fmt(memNow.value)} %${where}`,
          happening: `El servidor está usando el ${fmt(memNow.value)} %${totalText} de memoria.`,
          why,
          risk,
          action,
        });
      } else {
        const P = T.memProjection;
        const window = memPoints.filter((p) => p.at >= nowMs - P.lookbackMin * MINUTE);
        const slope = slopePerMinute(window);
        const rise = window.length ? memNow.value - window[0].value : 0;
        if (window.length >= P.minPoints && slope > 0 && rise >= P.minRise && memNow.value >= P.minPct) {
          const eta = (P.fullPct - memNow.value) / slope;
          if (eta <= P.horizonMin) {
            const span = Math.round((memNow.at - window[0].at) / MINUTE);
            out.push({
              key: `memoria${suffix}`,
              rule: 'memoria',
              severity: 'warning',
              title: `La memoria del servidor sube y se llenaría en unos ${fmt(Math.max(1, eta))} minutos${where}`,
              happening: `Pasó del ${fmt(window[0].value)} % al ${fmt(memNow.value)} %${totalText} en ${minutesText(span)}, sin bajar.`,
              why,
              risk,
              action,
            });
          }
        }
      }
    }

    // --- CPU del servidor sostenida -------------------------------------------------------------
    const cpuMinutes = minutes
      .filter((m) => m.at >= nowMs - (T.hostCpu.minutes + 2) * MINUTE)
      .map((m) => avg(m.rows.map((r) => r.hostCpuPct)))
      .filter((v): v is number => v != null)
      .slice(-T.hostCpu.minutes);
    if (cpuMinutes.length >= T.hostCpu.minutes) {
      const lowest = Math.min(...cpuMinutes);
      const cpuLevel = levelOf(lowest, T.hostCpu);
      if (cpuLevel) {
        out.push({
          key: `cpu${suffix}`,
          rule: 'cpu',
          severity: cpuLevel,
          title: `La CPU del servidor lleva ${T.hostCpu.minutes} minutos por encima del ${fmt(lowest)} %${where}`,
          happening: `Último minuto: ${fmt(cpuMinutes[cpuMinutes.length - 1])} %. No ha bajado en ${minutesText(T.hostCpu.minutes)}.`,
          why: 'Una CPU alta y sostenida casi siempre es una aplicación de pm2 reiniciándose en bucle (cada arranque de Node consume mucha CPU), aplicaciones duplicadas, un respaldo o un proceso pesado.',
          risk: 'Todo responde lento, las peticiones empiezan a vencerse y pm2 puede dejar de responder, lo que tumba todas las aplicaciones del servidor a la vez.',
          action: 'En el servidor, con el usuario del servicio de pm2: pm2 list y mirar la columna de reinicios (↺); la aplicación cuyo número no para de crecer es la culpable. Detenerla con pm2 stop <nombre> mientras se corrige.',
        });
      }
    }

    // --- Reinicios de Kronos --------------------------------------------------------------------
    const firstSeen = new Map<number, { at: number; iso: string; instance: string }>();
    const lastSeen = new Map<number, number>();
    for (const m of minutes) {
      for (const r of m.rows) {
        if (!firstSeen.has(r.pid)) firstSeen.set(r.pid, { at: m.at, iso: m.iso, instance: r.instance });
        lastSeen.set(r.pid, m.at);
      }
    }
    const windowStart = minutes[0].at;
    const inCron = (iso: string) => {
      const { minuteOfDay } = localParts(iso, tz);
      return minuteOfDay >= T.cronWindow.fromMin && minuteOfDay < T.cronWindow.toMin;
    };
    const started = Array.from(firstSeen.entries())
      .filter(([, f]) => f.at > windowStart + 2 * MINUTE && f.at >= nowMs - T.restartsLookbackMin * MINUTE && !inCron(f.iso))
      .sort((a, b) => a[1].at - b[1].at);
    let restartsFired = false;
    if (started.length >= input.expectedProcesses + 1) {
      restartsFired = true;
      out.push({
        key: `reinicios${suffix}`,
        rule: 'reinicios',
        severity: started.length >= 2 * input.expectedProcesses + 2 ? 'critical' : 'warning',
        title: `Kronos arrancó ${started.length} veces en la última hora${where}`,
        happening: `Procesos nuevos a las ${started.map(([, f]) => at(f.iso)).join(', ')}, fuera del reinicio programado de medianoche.`,
        why: 'pm2 reinicia Kronos cuando se cae (falta de memoria, error no controlado) o cuando pm2 mismo se reinicia: se cerró la sesión de Windows donde estaba corriendo o se cayó su servicio.',
        risk: 'Cada reinicio corta lo que la gente estaba haciendo. Si sigue, pm2 entra en bucle y consume la máquina, y puede terminar cayéndose con todas las aplicaciones.',
        action: 'Revisar el log de pm2 (pm2 logs GSS-Front --lines 200) a esas horas. Si coincide con un cierre de sesión, asegurar que pm2 corra solo como servicio de Windows.',
      });
    }

    const latestPids = newest ? Array.from(new Set(newest.rows.map((r) => r.pid))) : [];
    if (!restartsFired && latestPids.length > 0) {
      const latestStarts = latestPids.map((pid) => firstSeen.get(pid)!);
      const allNew = latestStarts.every((f) => f.at > windowStart + 2 * MINUTE && f.at >= nowMs - T.freezeLookbackMin * MINUTE);
      const earliestNew = Math.min(...latestStarts.map((f) => f.at));
      const hadOlder = Array.from(lastSeen.entries()).some(([pid, last]) => !latestPids.includes(pid) && last <= earliestNew);
      const startIso = new Date(earliestNew).toISOString();
      if (allNew && hadOlder && !inCron(startIso)) {
        out.push({
          key: `reinicio-total${suffix}-${startIso.slice(0, 16)}`,
          rule: 'reinicio-total',
          severity: 'warning',
          title: `Kronos se reinició completo a las ${at(startIso)}${where}`,
          happening: 'Todos los procesos de Kronos son nuevos: los anteriores dejaron de reportar al mismo tiempo.',
          why: 'O alguien hizo un despliegue, o pm2 se reinició entero: se cerró la sesión de Windows donde estaba corriendo, se cayó el servicio de pm2 o se reinició la máquina.',
          risk: 'Si fue pm2, se reiniciaron también todas las demás aplicaciones del servidor. Si se repite sin despliegues, pm2 está inestable y la próxima vez puede no volver solo.',
          action: 'Confirmar si hubo despliegue. Si no, revisar quién cerró sesión a esa hora (Visor de eventos → TerminalServices-LocalSessionManager) y que pm2 corra solo como servicio.',
        });
      }
    }

    // --- Minutos sin datos ----------------------------------------------------------------------
    for (let i = 1; i < minutes.length; i += 1) {
      const missing = Math.round((minutes[i].at - minutes[i - 1].at) / MINUTE) - 1;
      if (missing < T.gapMin) continue;
      const fromIso = new Date(minutes[i - 1].at + MINUTE).toISOString();
      out.push({
        key: `sin-datos${suffix}-${fromIso.slice(0, 16)}`,
        rule: 'sin-datos',
        severity: missing >= T.gapCriticalMin ? 'critical' : 'warning',
        title: `El servidor estuvo ${minutesText(missing)} sin dar señales (de ${at(fromIso)} a ${at(minutes[i].iso)})${where}`,
        happening: 'Ningún proceso de Kronos guardó métricas en ese lapso.',
        why: 'O la máquina estaba congelada o reiniciándose, o pm2 estaba caído, o Kronos no podía escribir en la base de datos.',
        risk: 'Durante ese tiempo nadie pudo usar Kronos (y probablemente tampoco las demás aplicaciones del servidor). Si la máquina se reinició sola, puede volver a pasar.',
        action: 'En el servidor: Visor de eventos → Sistema, buscar a esa hora los eventos 41 y 6008 (reinicio sin apagar bien) y 153 (disco que no responde).',
      });
    }

    // --- Por proceso: bloqueado o con demasiada memoria ----------------------------------------
    const byPid = new Map<number, WatchSample[]>();
    for (const r of hostSamples) byPid.set(r.pid, [...(byPid.get(r.pid) ?? []), r]);
    for (const [, rows] of byPid) {
      rows.sort((a, b) => Date.parse(a.sampledAt) - Date.parse(b.sampledAt));
      const last = rows[rows.length - 1];
      if (Date.parse(last.sampledAt) < nowMs - 5 * MINUTE) continue;
      const name = instanceName(last.instance);

      const recentRows = rows.filter((r) => Date.parse(r.sampledAt) >= nowMs - T.stalledLookbackMin * MINUTE);
      const stalled = recentRows.filter((r) => (r.eventLoopP99Ms ?? 0) >= T.stalledLoopMs);
      if (!machineFrozen && stalled.length >= T.stalledMinutes) {
        const worst = stalled.reduce((acc, r) => Math.max(acc, r.eventLoopP99Ms ?? 0), 0);
        out.push({
          key: `proceso-bloqueado${suffix}-${last.instance}`,
          rule: 'proceso-bloqueado',
          severity: worst >= T.freezeMs ? 'critical' : 'warning',
          title: `${name} lleva ${minutesText(stalled.length)} demasiado ocupado para atender${where}`,
          happening: `Tarda hasta ${fmt(worst)} ms en atender trabajo nuevo (lo normal es menos de 50 ms). Los demás procesos están bien.`,
          why: 'Algo pesado está ocupando ese proceso: generar un PDF o un Excel grande, leer un archivo enorme o un cálculo en bucle.',
          risk: 'Las personas atendidas por ese proceso ven pantallas que no cargan. Si dura, pm2 lo reinicia y se corta lo que estaban haciendo.',
          action: 'En el monitor, revisar "Rutas más pesadas" en la última hora para ver qué estaba corriendo.',
        });
      }

      const rssLevel = last.rssMb != null ? levelOf(last.rssMb, T.kronosRssMb) : null;
      if (rssLevel && last.rssMb != null) {
        out.push({
          key: `memoria-kronos${suffix}-${last.instance}`,
          rule: 'memoria-kronos',
          severity: rssLevel,
          title: `${name} está usando ${fmt(last.rssMb / 1024, 1)} GB de memoria${where}`,
          happening: `Un proceso de Kronos normalmente usa entre 300 y 800 MB; este va en ${fmt(last.rssMb)} MB.`,
          why: 'Puede ser una carga muy grande (un reporte o archivo enorme) o una fuga de memoria que crece hasta el reinicio de medianoche.',
          risk: 'Si sigue creciendo, Node se queda sin memoria y el proceso se cae, o le quita memoria a las demás aplicaciones del servidor.',
          action: 'Ver en el monitor la gráfica de memoria por proceso. Si solo crece, reiniciar esa instancia en un momento tranquilo (pm2 reload GSS-Front) y reportarlo.',
        });
      }
    }

    // --- Fila para conexiones SQL ---------------------------------------------------------------
    const pendingPerMinute = recent(T.poolPending.lookbackMin).map((m) =>
      m.rows.reduce((acc, r) => acc + (r.poolPending ?? 0), 0)
    );
    const congested = pendingPerMinute.filter((v) => v >= T.poolPending.warning);
    if (congested.length >= T.poolPending.minutes) {
      const worst = Math.max(...congested);
      out.push({
        key: `conexiones-sql${suffix}`,
        rule: 'conexiones-sql',
        severity: worst >= T.poolPending.critical ? 'critical' : 'warning',
        title: `Hasta ${fmt(worst)} peticiones esperan conexión a SQL${where}`,
        happening: `En ${minutesText(congested.length)} de los últimos ${T.poolPending.lookbackMin} hubo fila para conseguir una conexión a la base de datos.`,
        why: 'Las conexiones están ocupadas por consultas lentas o bloqueadas, o por llamadas externas lentas dentro de una transacción.',
        risk: 'Las pantallas se quedan cargando y terminan en error; si la fila crece, Kronos deja de responder aunque el servidor esté bien.',
        action: 'En el monitor, revisar "Consultas bloqueadas" y "Consultas que más CPU consumen" de SQL Server.',
      });
    }

    // --- Errores del servidor -------------------------------------------------------------------
    const errWindow = recent(T.errors.lookbackMin);
    const requests = errWindow.reduce((acc, m) => acc + m.rows.reduce((a, r) => a + r.httpRequests, 0), 0);
    const errors = errWindow.reduce((acc, m) => acc + m.rows.reduce((a, r) => a + r.httpErrors, 0), 0);
    if (requests >= T.errors.minRequests) {
      const pct = (errors / requests) * 100;
      const errLevel = levelOf(pct, { warning: T.errors.warningPct, critical: T.errors.criticalPct });
      if (errLevel) {
        out.push({
          key: `errores${suffix}`,
          rule: 'errores',
          severity: errLevel,
          title: `${fmt(pct)} % de las peticiones están fallando${where}`,
          happening: `${fmt(errors)} de ${fmt(requests)} peticiones de los últimos ${T.errors.lookbackMin} minutos terminaron en error del servidor (5xx).`,
          why: 'Suele ser la base de datos o un servicio externo (SAP, Graph, Orion) que no responde, o un error en una pantalla muy usada.',
          risk: 'La gente ve errores al guardar o consultar; si es la base de datos, pronto falla todo.',
          action: 'En el monitor, la tabla "Rutas más pesadas" muestra qué rutas fallan; revisar también los servicios externos.',
        });
      }
    }
  }

  // --- SQL Server (foto cada 5 minutos) -----------------------------------------------------------
  const lastDb = [...input.db].sort((a, b) => Date.parse(a.sampledAt) - Date.parse(b.sampledAt)).pop();
  if (lastDb && Date.parse(lastDb.sampledAt) >= nowMs - T.dbMaxAgeMin * MINUTE) {
    const blocked = lastDb.blockedRequests ?? 0;
    const waitMs = lastDb.longestWaitMs ?? 0;
    const blockedLevel = levelOf(blocked, T.sqlBlocked);
    const waitLevel = blocked > 0 ? levelOf(waitMs, T.sqlWaitMs) : null;
    const sqlLevel: WarningSeverity | null =
      blockedLevel === 'critical' || waitLevel === 'critical' ? 'critical' : blockedLevel ?? waitLevel;
    if (sqlLevel) {
      out.push({
        key: 'bloqueos-sql',
        rule: 'bloqueos-sql',
        severity: sqlLevel,
        title:
          blocked === 1
            ? `Una consulta de SQL lleva ${fmt(waitMs / 1000)} s bloqueada`
            : `${fmt(blocked)} consultas de SQL están bloqueadas`,
        happening: `A las ${at(lastDb.sampledAt)} había ${fmt(blocked)} consulta(s) esperando a que otra suelte las tablas; la espera más larga, ${fmt(waitMs / 1000)} s.`,
        why: 'Una consulta o transacción larga tiene tomadas unas tablas y las demás hacen fila detrás de ella.',
        risk: 'Todos los que usen esas tablas se quedan congelados; las conexiones se agotan y Kronos deja de responder.',
        action: 'En el monitor, "Consultas bloqueadas" muestra quién bloquea a quién. Si no se suelta, el DBA puede terminar la sesión que bloquea.',
      });
    }

    const log = judgeLog(lastDb.logUsedPct, input.logContext ?? null);
    if (log && log.severity !== 'info') {
      out.push({
        key: 'log-sql',
        rule: 'log-sql',
        severity: log.severity,
        title: log.title,
        happening: log.happening,
        why: log.why,
        risk: log.risk,
        action: log.action,
      });
    }
  }

  return out;
}

export type LastAlert = { severity: WarningSeverity; raisedAt: string };

/**
 * De las alertas activas, las que hay que notificar: nuevas, que empeoraron (advertencia →
 * crítica) o cuyo tiempo de espera ya pasó.
 */
export function alertsToNotify(warnings: EarlyWarning[], last: Map<string, LastAlert>, now: Date): EarlyWarning[] {
  return warnings.filter((w) => {
    const prev = last.get(w.key);
    if (!prev) return true;
    if (w.severity === 'critical' && prev.severity === 'warning') return true;
    const cooldown = WARNING_THRESHOLDS.cooldownMin[w.severity] * MINUTE;
    return now.getTime() - Date.parse(prev.raisedAt) >= cooldown;
  });
}

/** Texto de la campana y del push (la pantalla muestra el detalle completo). */
export function notificationPayload(w: EarlyWarning): { title: string; body: string } {
  const prefix = w.severity === 'critical' ? 'Alerta crítica' : 'Alerta temprana';
  return {
    title: `${prefix}: ${w.title} · SynerLink`.slice(0, 255),
    body: `${w.happening} Qué puede pasar: ${w.risk}`,
  };
}
