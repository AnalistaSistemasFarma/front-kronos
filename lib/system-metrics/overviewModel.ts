/**
 * Vista general del Monitor del sistema: todo lo que vive en el SQL Server compartido.
 *
 * Personas → Aplicaciones → Máquinas → SQL Server. Cada Kronos (Producción, Pruebas, otros) y
 * cada Orion es su propio nodo; las demás aplicaciones (SAPSEND, SAP Business One…) se agrupan
 * con todas sus bases. Las personas solo se pueden contar donde la aplicación las registra
 * (Kronos con su colector, Orion con su bitácora): SQL Server solo ve conexiones, y cada
 * aplicación entra con un único usuario técnico.
 *
 * Este archivo es PURO (tipos + armado del grafo) para probarlo sin base; las consultas están
 * en overview.ts.
 */

import type { LogContext, LogVerdict } from './logHealth';

export type AppKind = 'kronos' | 'orion' | 'sapsend' | 'sap' | 'reportes' | 'sistema' | 'otra';

export type OverviewEnvironment = {
  database: string;
  label: string;
  /** La base a la que está conectado el Kronos que responde. */
  isCurrent: boolean;
  /** `sin-metricas`: es un Kronos pero su colector nunca ha guardado (no está desplegado ahí). */
  state: 'activo' | 'sin-datos' | 'sin-metricas';
  lastSampleAt: string | null;
  processes: Array<{
    host: string;
    instance: string;
    pid: number;
    cpuPct: number | null;
    rssMb: number | null;
    eventLoopP99Ms: number | null;
  }>;
  host: { name: string; cpuPct: number | null; memPct: number | null; memTotalMb: number | null } | null;
  reqPerMin: number | null;
  errorPct: number | null;
  p95Ms: number | null;
  /** null = la base no tiene la tabla de personas; `hasData` false = existe pero sin registros recientes. */
  people: { activeNow: number; hasData: boolean; top: Array<{ email: string; name: string | null }> } | null;
  alerts: { last24h: number; critical: number } | null;
  /** Log de transacciones de la base, juzgado con la misma regla del resto del monitor (logHealth.ts). */
  log: { usedPct: number | null; context: LogContext | null; verdict: LogVerdict | null } | null;
};

export type OrionPeople = {
  database: string;
  activeLastHour: number;
  loginsToday: number;
  recent: Array<{ email: string; name: string | null }>;
};

/** Sesiones abiertas en SQL Server agrupadas por base, máquina, programa y usuario técnico. */
export type SessionGroup = {
  database: string;
  hostName: string | null;
  ip: string | null;
  programName: string | null;
  loginName: string | null;
  sessions: number;
  running: number;
  cpuMs: number;
  lastActivity: string | null;
};

export type DatabaseInfo = { name: string; accessible: boolean; kronosLike: boolean };

export type SqlServerInfo = {
  machine: string;
  version: string | null;
  cpus: number | null;
  startedAt: string | null;
  sqlCpuPct: number | null;
  otherCpuPct: number | null;
  memTotalMb: number | null;
  memAvailableMb: number | null;
  sqlMemoryMb: number | null;
  hasServerState: boolean;
  /** Discos donde están los archivos de las bases. */
  disks: Array<{ mount: string; totalMb: number; freeMb: number }>;
};

export type PeopleGroup = {
  key: string;
  appKey: string;
  label: string;
  /** null = todavía no hay de dónde contarlas. */
  count: number | null;
  caption: string;
  note: string | null;
  top: Array<{ email: string; name: string | null }>;
};

export type OverviewApp = {
  key: string;
  label: string;
  kind: AppKind;
  databases: Array<{ name: string; sessions: number; running: number }>;
  programs: string[];
  sessions: number;
  running: number;
  cpuMs: number;
  lastActivity: string | null;
  active: boolean;
  /** Por máquina desde donde se conecta (para las curvas). */
  machines: Array<{ name: string; sessions: number; running: number }>;
  environment: OverviewEnvironment | null;
};

export type OverviewMachine = {
  name: string;
  role: 'aplicaciones' | 'equipo';
  sessions: number;
  running: number;
  programs: string[];
  appKeys: string[];
  cpuPct: number | null;
  memPct: number | null;
  memTotalMb: number | null;
};

export type SystemOverview = {
  generatedAt: string;
  sqlServer: SqlServerInfo;
  environments: OverviewEnvironment[];
  people: PeopleGroup[];
  apps: OverviewApp[];
  machines: OverviewMachine[];
  /** Bases que existen pero a las que el usuario de Kronos no tiene acceso. */
  inaccessible: string[];
};

const SYSTEM_DBS = new Set(['master', 'msdb', 'model', 'tempdb']);
const SERVER_PROGRAMS = /node-mssql|tiberius|tedious|jdbc|sqlclient|odbc|sap business one|report server|sqlagent/i;
const ACTIVE_WINDOW_MS = 2 * 60_000;
const PER_DATABASE_KINDS = new Set<AppKind>(['kronos', 'orion']);

/**
 * Los nombres de base no se pueden pasar como parámetro: solo se usan nombres leídos de
 * sys.databases y siempre escapados con esto.
 */
export function quoteIdent(name: string): string {
  return `[${name.replace(/]/g, ']]')}]`;
}

export function sqlLiteral(value: string): string {
  return `N'${value.replace(/'/g, "''")}'`;
}

export function classifyDatabase(name: string, kronosLike = false): { kind: AppKind; app: string } {
  if (kronosLike || /kronos/i.test(name)) return { kind: 'kronos', app: 'Kronos' };
  if (/^oriondb/i.test(name)) return { kind: 'orion', app: 'Orion (GSS Firma)' };
  if (/^sapsend/i.test(name)) return { kind: 'sapsend', app: 'SAPSEND' };
  if (/^(sbo[-_]|sldmodel)/i.test(name)) return { kind: 'sap', app: 'SAP Business One' };
  if (/^reportserver/i.test(name)) return { kind: 'reportes', app: 'Reporting Services' };
  if (SYSTEM_DBS.has(name.toLowerCase())) return { kind: 'sistema', app: 'SQL Server (sistema)' };
  return { kind: 'otra', app: name };
}

/** "Producción" / "Pruebas" para las bases de Kronos y Orion; el nombre tal cual para las demás. */
export function environmentLabel(database: string): string {
  if (/^(kronosdb|oriondb)$/i.test(database)) return 'Producción';
  if (/^(kronosdb|oriondb)_pruebas$/i.test(database)) return 'Pruebas';
  return database;
}

export function appKeyOf(database: string, kronosLike = false): string {
  const { kind, app } = classifyDatabase(database, kronosLike);
  return PER_DATABASE_KINDS.has(kind) ? `db:${database}` : `app:${app}`;
}

function appLabelOf(database: string, kronosLike: boolean): string {
  const { kind, app } = classifyDatabase(database, kronosLike);
  if (kind === 'kronos') return `Kronos · ${environmentLabel(database)}`;
  if (kind === 'orion') return `Orion · ${environmentLabel(database)}`;
  return app;
}

/** Inicio del día de hoy en Bogotá (UTC−5, sin horario de verano), en UTC. */
export function startOfLocalDayUtc(now: Date, offsetMinutes = -300): Date {
  const local = now.getTime() + offsetMinutes * 60_000;
  const day = Math.floor(local / 86_400_000) * 86_400_000;
  return new Date(day - offsetMinutes * 60_000);
}

const fmt = (n: number) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);

function latest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

export function buildOverviewGraph(input: {
  sessions: SessionGroup[];
  databases: DatabaseInfo[];
  environments: OverviewEnvironment[];
  orion: OrionPeople[];
  sqlMachine: string;
  now: Date;
}): { people: PeopleGroup[]; apps: OverviewApp[]; machines: OverviewMachine[] } {
  const sqlKey = input.sqlMachine.toUpperCase();
  const kronosLike = new Map(input.databases.map((d) => [d.name.toLowerCase(), d.kronosLike]));
  const envByDb = new Map(input.environments.map((e) => [e.database.toLowerCase(), e]));

  // Prisma (tiberius) no informa el nombre de la máquina: se deduce por la IP de otras
  // conexiones que sí lo traen.
  const ipHost = new Map<string, string>();
  for (const s of input.sessions) {
    const host = s.hostName?.trim();
    if (host && s.ip && s.ip !== '<local machine>' && !ipHost.has(s.ip)) ipHost.set(s.ip, host);
  }
  const machineOf = (s: SessionGroup): string => {
    const host = s.hostName?.trim();
    if (host) return host.toUpperCase();
    if (s.ip === '<local machine>') return sqlKey;
    if (s.ip && ipHost.has(s.ip)) return ipHost.get(s.ip)!.toUpperCase();
    return s.ip || 'SIN IDENTIFICAR';
  };

  type AppAcc = OverviewApp & { dbMap: Map<string, { sessions: number; running: number }>; machineMap: Map<string, { sessions: number; running: number }>; programSet: Set<string> };
  const apps = new Map<string, AppAcc>();
  const ensureApp = (database: string): AppAcc => {
    const kl = kronosLike.get(database.toLowerCase()) ?? false;
    const key = appKeyOf(database, kl);
    let app = apps.get(key);
    if (!app) {
      app = {
        key,
        label: appLabelOf(database, kl),
        kind: classifyDatabase(database, kl).kind,
        databases: [],
        programs: [],
        sessions: 0,
        running: 0,
        cpuMs: 0,
        lastActivity: null,
        active: false,
        machines: [],
        environment: envByDb.get(database.toLowerCase()) ?? null,
        dbMap: new Map(),
        machineMap: new Map(),
        programSet: new Set(),
      };
      apps.set(key, app);
    }
    return app;
  };

  type MachineAcc = OverviewMachine & { programSet: Set<string>; appSet: Set<string> };
  const machines = new Map<string, MachineAcc>();

  for (const s of input.sessions) {
    if (!s.database) continue;
    const app = ensureApp(s.database);
    const machine = machineOf(s);
    app.sessions += s.sessions;
    app.running += s.running;
    app.cpuMs += s.cpuMs;
    app.lastActivity = latest(app.lastActivity, s.lastActivity);
    const db = app.dbMap.get(s.database) ?? { sessions: 0, running: 0 };
    db.sessions += s.sessions;
    db.running += s.running;
    app.dbMap.set(s.database, db);
    const m = app.machineMap.get(machine) ?? { sessions: 0, running: 0 };
    m.sessions += s.sessions;
    m.running += s.running;
    app.machineMap.set(machine, m);
    if (s.programName) app.programSet.add(s.programName);

    if (machine === sqlKey) continue;
    const acc: MachineAcc = machines.get(machine) ?? {
      name: machine,
      role: 'equipo',
      sessions: 0,
      running: 0,
      programs: [],
      appKeys: [],
      cpuPct: null,
      memPct: null,
      memTotalMb: null,
      programSet: new Set(),
      appSet: new Set(),
    };
    acc.sessions += s.sessions;
    acc.running += s.running;
    if (s.programName) acc.programSet.add(s.programName);
    acc.appSet.add(app.key);
    machines.set(machine, acc);
  }

  // Un Kronos con métricas siempre aparece (aunque en este instante no tenga sesiones abiertas),
  // y su máquina sale de sus propias muestras.
  for (const env of input.environments) {
    const app = ensureApp(env.database);
    app.environment = env;
    if (env.host) {
      const name = env.host.name.toUpperCase();
      if (!app.machineMap.has(name)) app.machineMap.set(name, { sessions: 0, running: 0 });
      if (name !== sqlKey) {
        const acc: MachineAcc = machines.get(name) ?? {
          name,
          role: 'aplicaciones',
          sessions: 0,
          running: 0,
          programs: [],
          appKeys: [],
          cpuPct: null,
          memPct: null,
          memTotalMb: null,
          programSet: new Set(),
          appSet: new Set(),
        };
        acc.appSet.add(app.key);
        acc.cpuPct = env.host.cpuPct;
        acc.memPct = env.host.memPct;
        acc.memTotalMb = env.host.memTotalMb;
        acc.role = 'aplicaciones';
        machines.set(name, acc);
      }
    }
  }

  const nowMs = input.now.getTime();
  const appList: OverviewApp[] = Array.from(apps.values())
    .map(({ dbMap, machineMap, programSet, ...a }) => ({
      ...a,
      databases: Array.from(dbMap, ([name, v]) => ({ name, ...v })).sort((x, y) => y.sessions - x.sessions),
      machines: Array.from(machineMap, ([name, v]) => ({ name, ...v })).sort((x, y) => y.sessions - x.sessions),
      programs: Array.from(programSet).sort(),
      active:
        a.running > 0 ||
        a.environment?.state === 'activo' ||
        (a.lastActivity != null && nowMs - Date.parse(a.lastActivity) < ACTIVE_WINDOW_MS),
    }))
    // Una copia de Kronos sin métricas ni conexiones no aporta nada al mapa.
    .filter((a) => a.sessions > 0 || (a.environment != null && a.environment.state !== 'sin-metricas'))
    .sort((x, y) => kindRank(x.kind) - kindRank(y.kind) || Number(y.active) - Number(x.active) || y.sessions - x.sessions);

  const machineList: OverviewMachine[] = Array.from(machines.values())
    .map(({ programSet, appSet, ...m }) => {
      const programs = Array.from(programSet).sort();
      return {
        ...m,
        programs,
        appKeys: Array.from(appSet),
        role: m.role === 'aplicaciones' || programs.some((p) => SERVER_PROGRAMS.test(p)) ? ('aplicaciones' as const) : ('equipo' as const),
      };
    })
    .sort((x, y) => Number(y.role === 'aplicaciones') - Number(x.role === 'aplicaciones') || y.sessions - x.sessions);

  const people: PeopleGroup[] = [];
  for (const env of input.environments) {
    const label = `Kronos · ${env.label}`;
    const appKey = appKeyOf(env.database, true);
    if (env.state === 'sin-metricas') continue;
    if (!env.people) {
      people.push({ key: `p-${appKey}`, appKey, label, count: null, caption: 'Sin conteo de personas', note: 'Falta la tabla de consumo por usuario en esta base.', top: [] });
    } else if (!env.people.hasData) {
      people.push({ key: `p-${appKey}`, appKey, label, count: null, caption: 'Sin datos todavía', note: 'La tabla existe; empieza a llenarse cuando se despliegue el colector de usuarios.', top: [] });
    } else {
      people.push({
        key: `p-${appKey}`,
        appKey,
        label,
        count: env.people.activeNow,
        caption: env.people.activeNow === 1 ? 'persona activa ahora' : 'personas activas ahora',
        note: 'Últimos 15 minutos',
        top: env.people.top,
      });
    }
  }
  for (const o of input.orion) {
    const appKey = appKeyOf(o.database);
    people.push({
      key: `p-${appKey}`,
      appKey,
      label: `Orion · ${environmentLabel(o.database)}`,
      count: o.activeLastHour,
      caption: o.activeLastHour === 1 ? 'persona con actividad en la última hora' : 'personas con actividad en la última hora',
      note: `${fmt(o.loginsToday)} ${o.loginsToday === 1 ? 'ingresó' : 'ingresaron'} hoy`,
      top: o.recent,
    });
  }

  return { people, apps: appList, machines: machineList };
}

const KIND_ORDER: AppKind[] = ['kronos', 'orion', 'sapsend', 'sap', 'otra', 'reportes', 'sistema'];
function kindRank(kind: AppKind): number {
  return KIND_ORDER.indexOf(kind);
}
