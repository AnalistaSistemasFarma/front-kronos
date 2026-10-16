import { describe, expect, it } from 'vitest';
import {
  appKeyOf,
  buildOverviewGraph,
  classifyDatabase,
  environmentLabel,
  quoteIdent,
  sqlLiteral,
  startOfLocalDayUtc,
  type DatabaseInfo,
  type OverviewEnvironment,
  type SessionGroup,
} from '../overviewModel';

const NOW = new Date('2026-10-07T15:30:00Z');

function session(p: Partial<SessionGroup> & { database: string }): SessionGroup {
  return {
    hostName: null,
    ip: null,
    programName: null,
    loginName: 'app',
    sessions: 1,
    running: 0,
    cpuMs: 0,
    lastActivity: '2026-10-07T15:29:30Z',
    ...p,
  };
}

function env(p: Partial<OverviewEnvironment> & { database: string }): OverviewEnvironment {
  return {
    label: environmentLabel(p.database),
    isCurrent: false,
    state: 'activo',
    lastSampleAt: '2026-10-07T15:30:00Z',
    processes: [],
    host: null,
    reqPerMin: 100,
    errorPct: 0,
    p95Ms: 200,
    people: null,
    alerts: null,
    log: null,
    ...p,
  };
}

const DBS: DatabaseInfo[] = [
  { name: 'KRONOSDB', accessible: true, kronosLike: true },
  { name: 'KRONOSDB_PRUEBAS', accessible: true, kronosLike: true },
  { name: 'PISA_FARMACEUTICA', accessible: true, kronosLike: true },
  { name: 'z_PRUEBAS_KRONOSDB', accessible: true, kronosLike: true },
  { name: 'ORIONDB', accessible: true, kronosLike: false },
  { name: 'SAPSEND', accessible: true, kronosLike: false },
  { name: 'SAPSEND_GSS', accessible: true, kronosLike: false },
];

describe('escape de nombres de base', () => {
  it('duplica corchetes y comillas', () => {
    expect(quoteIdent('a]b')).toBe('[a]]b]');
    expect(sqlLiteral("o'brien")).toBe("N'o''brien'");
    expect(quoteIdent('SLDModel.SLDData')).toBe('[SLDModel.SLDData]');
  });
});

describe('clasificación', () => {
  it('reconoce cada aplicación', () => {
    expect(classifyDatabase('KRONOSDB').kind).toBe('kronos');
    expect(classifyDatabase('PISA_FARMACEUTICA', true).kind).toBe('kronos');
    expect(classifyDatabase('ORIONDB_PRUEBAS').kind).toBe('orion');
    expect(classifyDatabase('SAPSEND_RYAN_TEST').kind).toBe('sapsend');
    expect(classifyDatabase('SBO-COMMON').kind).toBe('sap');
    expect(classifyDatabase('SLDModel.SLDData').kind).toBe('sap');
    expect(classifyDatabase('ReportServerTempDB').kind).toBe('reportes');
    expect(classifyDatabase('master').kind).toBe('sistema');
    expect(classifyDatabase('UNIS')).toEqual({ kind: 'otra', app: 'UNIS' });
  });

  it('nombra los entornos sin confundir copias', () => {
    expect(environmentLabel('KRONOSDB')).toBe('Producción');
    expect(environmentLabel('KRONOSDB_PRUEBAS')).toBe('Pruebas');
    expect(environmentLabel('ORIONDB_PRUEBAS')).toBe('Pruebas');
    expect(environmentLabel('z_PRUEBAS_KRONOSDB')).toBe('z_PRUEBAS_KRONOSDB');
  });

  it('Kronos y Orion van por base; las demás se agrupan', () => {
    expect(appKeyOf('KRONOSDB')).toBe('db:KRONOSDB');
    expect(appKeyOf('SAPSEND_GSS')).toBe(appKeyOf('SAPSEND'));
  });
});

describe('startOfLocalDayUtc', () => {
  it('medianoche de Bogotá es 05:00 UTC', () => {
    expect(startOfLocalDayUtc(new Date('2026-10-07T15:30:00Z')).toISOString()).toBe('2026-10-07T05:00:00.000Z');
    // 02:00 UTC del 8 sigue siendo el 7 en Bogotá.
    expect(startOfLocalDayUtc(new Date('2026-10-08T02:00:00Z')).toISOString()).toBe('2026-10-07T05:00:00.000Z');
  });
});

describe('buildOverviewGraph', () => {
  const base = {
    databases: DBS,
    orion: [],
    sqlMachine: 'SERFARMA03',
    now: NOW,
  };

  it('deduce la máquina de Prisma por la IP y deja fuera la del SQL', () => {
    const g = buildOverviewGraph({
      ...base,
      environments: [],
      sessions: [
        session({ database: 'KRONOSDB', hostName: 'SERFARMA05', ip: '10.0.0.5', programName: 'node-mssql', sessions: 10 }),
        session({ database: 'KRONOSDB', hostName: null, ip: '10.0.0.5', programName: 'tiberius', sessions: 4 }),
        session({ database: 'master', hostName: null, ip: '<local machine>', programName: 'jdbc', sessions: 100 }),
      ],
    });
    const kronos = g.apps.find((a) => a.key === 'db:KRONOSDB')!;
    expect(kronos.sessions).toBe(14);
    expect(kronos.machines).toEqual([{ name: 'SERFARMA05', sessions: 14, running: 0 }]);
    expect(g.machines.map((m) => m.name)).toEqual(['SERFARMA05']);
    expect(g.apps.find((a) => a.kind === 'sistema')!.machines[0].name).toBe('SERFARMA03');
  });

  it('agrupa SAPSEND y marca equipos personales', () => {
    const g = buildOverviewGraph({
      ...base,
      environments: [],
      sessions: [
        session({ database: 'SAPSEND', hostName: 'SERFARMA05', programName: 'node-mssql', sessions: 3 }),
        session({ database: 'SAPSEND_GSS', hostName: 'SERFARMA05', programName: 'node-mssql', sessions: 2 }),
        session({ database: 'KRONOSDB', hostName: 'POR005', programName: 'Microsoft SQL Server Management Studio', sessions: 2 }),
      ],
    });
    const sapsend = g.apps.find((a) => a.kind === 'sapsend')!;
    expect(sapsend.sessions).toBe(5);
    expect(sapsend.databases.map((d) => d.name).sort()).toEqual(['SAPSEND', 'SAPSEND_GSS']);
    expect(g.machines.find((m) => m.name === 'POR005')!.role).toBe('equipo');
    expect(g.machines.find((m) => m.name === 'SERFARMA05')!.role).toBe('aplicaciones');
  });

  it('un Kronos con métricas aparece aunque no tenga sesiones; una copia vacía no', () => {
    const g = buildOverviewGraph({
      ...base,
      sessions: [],
      environments: [
        env({ database: 'KRONOSDB', host: { name: 'serfarma05', cpuPct: 10, memPct: 50, memTotalMb: 20000 } }),
        env({ database: 'z_PRUEBAS_KRONOSDB', state: 'sin-metricas', reqPerMin: null }),
      ],
    });
    expect(g.apps.map((a) => a.key)).toEqual(['db:KRONOSDB']);
    expect(g.apps[0].active).toBe(true);
    expect(g.machines[0]).toMatchObject({ name: 'SERFARMA05', role: 'aplicaciones', cpuPct: 10, memPct: 50 });
  });

  it('activa solo con actividad en los últimos 2 minutos', () => {
    const g = buildOverviewGraph({
      ...base,
      environments: [],
      sessions: [
        session({ database: 'ORIONDB', hostName: 'PC1', lastActivity: '2026-10-06T18:00:00Z' }),
        session({ database: 'SAPSEND', hostName: 'PC1', lastActivity: '2026-10-07T15:29:00Z' }),
      ],
    });
    expect(g.apps.find((a) => a.kind === 'orion')!.active).toBe(false);
    expect(g.apps.find((a) => a.kind === 'sapsend')!.active).toBe(true);
  });

  it('arma los grupos de personas de Kronos y Orion', () => {
    const g = buildOverviewGraph({
      ...base,
      sessions: [],
      environments: [
        env({ database: 'KRONOSDB', people: { activeNow: 0, hasData: false, top: [] } }),
        env({ database: 'KRONOSDB_PRUEBAS', people: { activeNow: 3, hasData: true, top: [{ email: 'a@x.co', name: 'Ana' }] } }),
        env({ database: 'PISA_FARMACEUTICA', state: 'sin-metricas' }),
      ],
      orion: [{ database: 'ORIONDB', activeLastHour: 1, loginsToday: 4, recent: [] }],
    });
    expect(g.people.map((p) => [p.label, p.count])).toEqual([
      ['Kronos · Producción', null],
      ['Kronos · Pruebas', 3],
      ['Orion · Producción', 1],
    ]);
    expect(g.people[0].caption).toBe('Sin datos todavía');
    expect(g.people[2].note).toBe('4 ingresaron hoy');
    expect(g.people[1].appKey).toBe('db:KRONOSDB_PRUEBAS');
  });

  it('ordena Kronos primero, luego Orion, y deja el sistema al final', () => {
    const g = buildOverviewGraph({
      ...base,
      environments: [],
      sessions: [
        session({ database: 'master', hostName: 'X', sessions: 100 }),
        session({ database: 'ORIONDB', hostName: 'X' }),
        session({ database: 'KRONOSDB', hostName: 'X' }),
      ],
    });
    expect(g.apps.map((a) => a.kind)).toEqual(['kronos', 'orion', 'sistema']);
  });
});
