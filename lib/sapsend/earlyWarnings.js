/**
 * Alertas tempranas y "Lo que va bien" del Monitor SAPSEND, con el mismo formato que el
 * Monitor del sistema (components/system-metrics/EarlyWarnings + StatusHero highlights):
 * cada alerta trae qué está pasando, por qué importa, el riesgo y qué hacer.
 *
 * Las alertas se guardan en memoria (últimas 48 h, por proceso). Una misma condición que
 * sigue activa no crea una alerta nueva cada 5 s: se actualiza la existente y solo se vuelve
 * a levantar si estuvo apagada al menos REARM_MS.
 */

const HISTORY_HOURS = 48;
const REARM_MS = 15 * 60 * 1000;
const MAX_ALERTS = 200;

/** @type {Array<Record<string, any>>} */
const alerts = [];
/** @type {Map<string, { id: number, lastSeen: number }>} */
const active = new Map();
let nextId = 1;

/** Qué vigila el monitor (lista que se abre con «Qué vigila el monitor»). */
export const SAPSEND_WATCH_LIST = [
  'Bloqueos en las bases SAPSEND: una sesión que deja esperando a otras.',
  'Service Layer de cada empresa: si deja de responder o tarda más de 3 s.',
  'Consultas de SAPSEND que llevan más de 10 s ejecutándose.',
  'Concurrencia alta: 20 o más consultas activas a la vez en las bases SAPSEND.',
  'Que el SAPSEND productivo deje de responder (si su dirección está configurada).',
  'Personas conectadas a las bases SAPSEND con su propia cuenta (SSMS, Excel, cuenta de Windows desde su equipo).',
];

function fmtMs(ms) {
  if (ms == null) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

/**
 * Condiciones activas ahora a partir de la foto en vivo.
 * @returns {Array<{ key: string, rule: string, severity: 'warning'|'critical', title: string, happening: string, why: string, risk: string, action: string }>}
 */
function conditionsOf({ companies, blocks, runningNow, hasServerState, health, logins = [] }) {
  const out = [];

  const personal = logins.filter((l) => l.accountType === 'persona');
  if (personal.length > 0) {
    out.push({
      key: 'personal-accounts',
      rule: 'cuentas-personales',
      severity: 'warning',
      title: `${personal.length} ${personal.length === 1 ? 'persona conectada' : 'personas conectadas'} a SAPSEND con su propia cuenta`,
      happening: personal
        .slice(0, 5)
        .map((l) => `${l.person?.name ?? 'Persona sin identificar'} en el equipo ${l.host}: ${l.accountReason}`)
        .join(' · '),
      why: 'A las bases SAPSEND solo deberían entrar los servidores (SERFARMA). Una persona con su cuenta puede correr consultas pesadas o cambiar datos a mano.',
      risk: 'Una consulta manual puede bloquear a los SAPSEND y poner todo lento; un cambio a mano no deja rastro en el proceso.',
      action: 'Revise en la pestaña Usuarios quién es y qué está consultando; si no debe tener acceso, pida quitarle el permiso a esa base.',
    });
  }

  if (blocks.length > 0) {
    const worst = blocks[0];
    out.push({
      key: 'blocks',
      rule: 'bloqueos',
      severity: 'critical',
      title: `${blocks.length} ${blocks.length === 1 ? 'bloqueo' : 'bloqueos'} en las bases SAPSEND`,
      happening: `La sesión ${worst.blockingSessionId} (${worst.blockingProgram || 'programa desconocido'}) tiene esperando a la sesión ${worst.blockedSessionId} hace ${fmtMs(worst.waitMs)} en ${worst.database || 'una base'}.`,
      why: 'Mientras dura el bloqueo, todo lo que necesite esas tablas queda en fila: es la causa más común de "todo está lento".',
      risk: 'Si no se suelta, los envíos de SAPSEND y las pantallas que dependen de él se congelan y empiezan a fallar por tiempo de espera.',
      action: 'Abra la pestaña Base de datos → Bloqueos, mire qué consulta tiene el bloqueador y avise a quien administra ese SAPSEND.',
    });
  }

  for (const c of companies) {
    if (!c.sl) continue;
    if (!c.sl.pulse.ok) {
      out.push({
        key: `sl-down-${c.sl.host}`,
        rule: 'service-layer-caido',
        severity: 'critical',
        title: `El Service Layer de ${c.company} no responde`,
        happening: `${c.sl.host}: ${c.sl.pulse.error || 'sin respuesta'}.`,
        why: 'Sin Service Layer, SynerLink y SAPSEND no pueden leer ni escribir en SAP para esta empresa.',
        risk: 'Compras, pagos, autorizaciones y envíos de esta empresa fallan hasta que vuelva.',
        action: 'Confirme con quien administra SAP que el servicio del Service Layer esté arriba en ese servidor.',
      });
    } else if ((c.sl.pulse.latencyMs ?? 0) >= 3000) {
      out.push({
        key: `sl-slow-${c.sl.host}`,
        rule: 'service-layer-lento',
        severity: 'warning',
        title: `El Service Layer de ${c.company} está lento`,
        happening: `Respondió en ${fmtMs(c.sl.pulse.latencyMs)} (lo normal es menos de 1 s).`,
        why: 'Un Service Layer lento suele estar saturado de sesiones o esperando a la base de SAP.',
        risk: 'Si sigue subiendo, las llamadas empiezan a vencer por tiempo y los usuarios ven errores.',
        action: 'Revise en la pestaña Usuarios qué equipo o usuario SQL consume más y en Base de datos si hay bloqueos.',
      });
    }
  }
  // Varias empresas comparten servidor: una sola alerta por host.
  const seen = new Set();
  const dedup = out.filter((a) => (seen.has(a.key) ? false : (seen.add(a.key), true)));

  const slow = runningNow.filter((r) => r.elapsedMs >= 10_000);
  if (slow.length > 0) {
    const top = slow[0];
    dedup.push({
      key: 'slow-queries',
      rule: 'consultas-lentas',
      severity: slow.some((r) => r.elapsedMs >= 60_000) ? 'critical' : 'warning',
      title: `${slow.length} ${slow.length === 1 ? 'consulta lenta' : 'consultas lentas'} en SAPSEND`,
      happening: `La más larga lleva ${fmtMs(top.elapsedMs)} en ${top.database}${top.waitType ? `, esperando ${top.waitType}` : ''}.`,
      why: 'Una consulta que no termina ocupa la base y puede dejar bloqueadas a otras.',
      risk: 'Si se acumulan, el SAPSEND de esa empresa deja de procesar envíos.',
      action: 'Abra Base de datos → Consultas por SAPSEND → «Ejecutándose en este momento» para ver cuál es.',
    });
  }

  const running = companies.reduce((a, c) => a + (c.sapsend.running ?? 0), 0);
  if (running >= 20) {
    dedup.push({
      key: 'high-concurrency',
      rule: 'concurrencia-alta',
      severity: running >= 40 ? 'critical' : 'warning',
      title: `Concurrencia alta en SAPSEND: ${running} consultas a la vez`,
      happening: `Hay ${running} consultas activas al mismo tiempo en las bases SAPSEND.`,
      why: 'Muchas consultas simultáneas compiten por CPU y disco del SQL Server.',
      risk: 'Todo lo que comparte el SQL Server (Kronos incluido) se pone lento.',
      action: 'Mire en Mapas qué empresa concentra las sesiones y en Base de datos qué consultas pesan más.',
    });
  }

  if (health && !health.ok && !health.skipped) {
    dedup.push({
      key: 'sapsend-down',
      rule: 'sapsend-caido',
      severity: 'critical',
      title: 'El SAPSEND productivo no responde',
      happening: `La prueba de conexión falló: ${health.error || 'sin respuesta'}.`,
      why: 'Si SAPSEND no atiende, no se procesan los envíos hacia SAP.',
      risk: 'Pagos, compras y autorizaciones quedan sin registrarse en SAP.',
      action: 'Confirme con quien administra SAPSEND que el servicio esté arriba.',
    });
  }

  if (!hasServerState) {
    dedup.push({
      key: 'no-server-state',
      rule: 'sin-permiso',
      severity: 'warning',
      title: 'Kronos no puede ver la actividad del SQL Server',
      happening: 'El usuario de Kronos no tiene VIEW SERVER STATE.',
      why: 'Sin ese permiso no se ven sesiones, bloqueos ni consultas de los SAPSEND.',
      risk: 'Una lentitud no se podría explicar desde aquí.',
      action: 'Pida al administrador de SQL Server que otorgue VIEW SERVER STATE al usuario de Kronos.',
    });
  }

  return dedup;
}

/** Registra las condiciones activas y devuelve el historial de alertas (más nuevas primero). */
export function evaluateSapsendAlerts(input, host) {
  const now = Date.now();
  for (const cond of conditionsOf(input)) {
    const prev = active.get(cond.key);
    if (prev && now - prev.lastSeen < REARM_MS) {
      prev.lastSeen = now;
      const row = alerts.find((a) => a.id === prev.id);
      if (row) Object.assign(row, { ...cond, severity: row.severity === 'critical' ? 'critical' : cond.severity, lastSeenAt: new Date(now).toISOString() });
      continue;
    }
    const id = nextId++;
    active.set(cond.key, { id, lastSeen: now });
    alerts.unshift({
      id,
      raisedAt: new Date(now).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
      host,
      notified: 0,
      ...cond,
    });
  }
  const cut = now - HISTORY_HOURS * 3600_000;
  while (alerts.length && (alerts.length > MAX_ALERTS || Date.parse(alerts[alerts.length - 1].raisedAt) < cut)) {
    alerts.pop();
  }
  return { alerts: alerts.slice(), historyHours: HISTORY_HOURS };
}

/** "Lo que va bien": lo sano de la foto, en frases cortas (como buildHighlights). */
export function buildSapsendHighlights({ companies, blocks, runningNow, hasServerState, health, logins = [] }) {
  const out = [];
  if (hasServerState && logins.length && !logins.some((l) => l.accountType === 'persona')) {
    out.push({
      id: 'only-services',
      severity: 'ok',
      area: 'base',
      title: 'Solo servidores conectados a SAPSEND',
      detail: 'Ninguna persona está entrando con su propia cuenta.',
    });
  }
  const withSl = companies.filter((c) => c.sl);
  const okSl = withSl.filter((c) => c.sl.pulse.ok);
  if (withSl.length && okSl.length === withSl.length) {
    const max = Math.max(0, ...okSl.map((c) => c.sl.pulse.latencyMs ?? 0));
    if (max < 3000) {
      out.push({
        id: 'sl-ok',
        severity: 'ok',
        area: 'externos',
        title: 'El Service Layer responde en todas las empresas',
        detail: `El más lento respondió en ${fmtMs(max)}.`,
      });
    }
  }
  if (hasServerState && blocks.length === 0) {
    out.push({
      id: 'no-blocks',
      severity: 'ok',
      area: 'base',
      title: 'Sin bloqueos en las bases SAPSEND',
      detail: 'Ninguna sesión está dejando esperando a otra.',
    });
  }
  if (hasServerState && !runningNow.some((r) => r.elapsedMs >= 10_000)) {
    out.push({
      id: 'no-slow',
      severity: 'ok',
      area: 'base',
      title: 'Sin consultas lentas en SAPSEND',
      detail: 'Ninguna consulta lleva más de 10 s ejecutándose.',
    });
  }
  const running = companies.reduce((a, c) => a + (c.sapsend?.running ?? 0), 0);
  if (hasServerState && companies.length && running < 20) {
    out.push({
      id: 'concurrency-ok',
      severity: 'ok',
      area: 'base',
      title: 'Concurrencia normal en los SAPSEND',
      detail: `${running} consultas activas a la vez en ${companies.length} bases SAPSEND.`,
    });
  }
  if (health.ok && !health.skipped) {
    out.push({
      id: 'sapsend-up',
      severity: 'ok',
      area: 'externos',
      title: 'SAPSEND productivo alcanzable',
      detail: `Respondió en ${fmtMs(health.latencyMs)}.`,
    });
  }
  return out;
}

export function __resetSapsendAlertsForTests() {
  alerts.length = 0;
  active.clear();
  nextId = 1;
}
