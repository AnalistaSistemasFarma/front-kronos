import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Errores de IA (Auditoría de agentes) contra un SQL Server real: el job de CI
 * aplica prisma/manual/2026-11-03-errores-ia-PRUEBAS.sql sobre kronos_ci.
 * Prueba la agrupación por huella, que releer el mismo log no cuente dos veces,
 * la reapertura de lo resuelto, el alcance por agente y las guardas de
 * «Reintentar mensaje».
 */
const url = process.env.SGC_IT_DATABASE_URL;

// errors-db usa audit-access, que importa lib/prisma (y este, dbconfig): se apunta a la base efímera.
vi.mock('../../../lib/prisma', async () => {
  const { PrismaClient } = await import('../../../app/generated/prisma');
  return { prisma: new PrismaClient({ datasources: { db: { url: process.env.SGC_IT_DATABASE_URL ?? 'sqlserver://localhost:1;database=x;user=x;password=x' } } }) };
});
vi.mock('../../../lib/access-control', () => ({ checkAdminPrivileges: async () => false }));

vi.mock('../../../lib/mssqlPool', async () => {
  const sql = (await import('mssql')).default;
  const crudo = (process.env.SGC_IT_DATABASE_URL ?? '').replace(/^sqlserver:\/\//, '');
  const [hostport, ...kv] = crudo.split(';');
  const p = Object.fromEntries(
    kv.filter(Boolean).map((s) => {
      const i = s.indexOf('=');
      return [s.slice(0, i).trim().toLowerCase(), s.slice(i + 1).trim()];
    }),
  );
  const [server, port] = (hostport ?? '').split(':');
  let pool: InstanceType<typeof sql.ConnectionPool> | null = null;
  return {
    sql,
    withMssqlPool: async <T,>(fn: (pool: InstanceType<typeof sql.ConnectionPool>) => Promise<T>) => {
      if (!pool) {
        pool = await new sql.ConnectionPool({
          server: server || 'localhost',
          port: Number(port || 1433),
          database: p.database,
          user: p.user,
          password: p.password,
          options: { encrypt: true, trustServerCertificate: true },
        }).connect();
      }
      return fn(pool);
    },
  };
});

describe.skipIf(!url)('Errores de IA · integración con SQL Server', () => {
  let prisma: import('../../../app/generated/prisma').PrismaClient;
  let db: typeof import('../../../lib/agent-audit/errors-db');
  let parse: typeof import('../../../lib/agent-audit/errors').parsePublicacion;
  const s = Date.now().toString(36);
  const code = `errit${s}`;
  let idAgent = 0;
  let idOtroAgente = 0;
  let idConv = 0;
  let idMsg = 0;
  let idMsgRespondido = 0;

  const ev = (extra: Record<string, unknown> = {}) => ({
    agente: code,
    tipo: 'turno_fallido',
    severidad: 'alta',
    ambiente: 'pruebas',
    titulo: 'falló el turno del mensaje 100: el turno excedió 900s y se canceló',
    clave: `k-${s}-1`,
    ocurrioEn: new Date(Date.now() - 60_000).toISOString(),
    ...extra,
  });

  beforeAll(async () => {
    const { PrismaClient } = await import('../../../app/generated/prisma');
    prisma = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
    db = await import('../../../lib/agent-audit/errors-db');
    parse = (await import('../../../lib/agent-audit/errors')).parsePublicacion;
    const a = await prisma.agent.create({ data: { code, display_name: `Agente IT ${s}` } });
    const b = await prisma.agent.create({ data: { code: `${code}b`, display_name: `Otro IT ${s}` } });
    idAgent = a.id_agent;
    idOtroAgente = b.id_agent;
    const u = await prisma.user.create({ data: { email: `errores.${s}@gsslatam.com`, name: 'Errores IT', isActive: true } });
    const c = await prisma.chatConversation.create({ data: { id_user: u.id, id_agent: idAgent } });
    idConv = c.id;
    const m = await prisma.chatMessage.create({
      data: { id_conversation: idConv, role: 'user', body: 'hola', delivered_at: new Date() },
    });
    idMsg = m.id;
    const c2 = await prisma.chatConversation.create({ data: { id_user: u.id, id_agent: idAgent, dm_key: `x-${s}` } });
    const m2 = await prisma.chatMessage.create({
      data: { id_conversation: c2.id, role: 'user', body: 'otra', delivered_at: new Date(Date.now() - 5000) },
    });
    await prisma.chatMessage.create({ data: { id_conversation: c2.id, role: 'agent', body: 'respuesta', id_agent_author: idAgent } });
    idMsgRespondido = m2.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('agrupa por huella, no cuenta dos veces la misma clave y avisa solo lo nuevo', async () => {
    const r1 = await db.publicarErrores(
      parse({ eventos: [ev(), ev({ clave: `k-${s}-2`, titulo: 'falló el turno del mensaje 101: el turno excedió 900s y se canceló' })] }),
      { notificar: true, horas: 6 },
    );
    expect(r1.erroresNuevos).toBe(1);
    expect(r1.eventosNuevos).toBe(2);
    expect(r1.notificar).toHaveLength(1);
    expect(r1.notificar[0].ocurrencias).toBe(2);

    const r2 = await db.publicarErrores(parse({ eventos: [ev()] }), { notificar: true, horas: 6 });
    expect(r2.eventosNuevos).toBe(0);
    expect(r2.notificar).toHaveLength(0);

    // Severidad alta que sigue pasando: se repite solo pasado el plazo desde el acuse.
    await db.acusarNotificados([r1.notificar[0].huella]);
    const r3 = await db.publicarErrores(parse({ eventos: [ev({ clave: `k-${s}-3` })] }), { notificar: true, horas: 6 });
    expect(r3.eventosNuevos).toBe(1);
    expect(r3.notificar).toHaveLength(0);

    const lista = await db.leerErrores('admin@gsslatam.com', { all: true });
    const mio = lista.errores.filter((e) => e.agente === code);
    expect(mio).toHaveLength(1);
    expect(mio[0].ocurrencias).toBe(3);
    expect(mio[0].idAgent).toBe(idAgent);
    expect(lista.ambienteServidor).toBe('pruebas');
  });

  it('lo resuelto se reabre si vuelve a pasar; lo silenciado nunca avisa', async () => {
    const lista = await db.leerErrores('admin@gsslatam.com', { all: true });
    const e = lista.errores.find((x) => x.agente === code)!;
    await db.cambiarEstado(e.id, 'resuelto', 'nicolas@gsslatam.com', { all: true });
    const r = await db.publicarErrores(parse({ eventos: [ev({ clave: `k-${s}-4` })] }), { notificar: true, horas: 6 });
    expect(r.notificar).toHaveLength(1);
    const otra = await db.leerErrores('admin@gsslatam.com', { all: true });
    expect(otra.errores.find((x) => x.id === e.id)?.estado).toBe('abierto');

    await db.cambiarEstado(e.id, 'silenciado', 'nicolas@gsslatam.com', { all: true });
    const r2 = await db.publicarErrores(parse({ eventos: [ev({ clave: `k-${s}-5` })] }), { notificar: true, horas: 0 });
    expect(r2.notificar).toHaveLength(0);
    const eventos = await db.leerEventos(e.id, 'admin@gsslatam.com', { all: true });
    expect(eventos?.length).toBe(5);
  });

  it('alcance: fuera de sus agentes no ve ni cambia nada', async () => {
    const lista = await db.leerErrores('x@gsslatam.com', { all: false, companyIds: [], agentIds: [idOtroAgente] });
    expect(lista.errores.find((x) => x.agente === code)).toBeUndefined();
    const todos = await db.leerErrores('admin@gsslatam.com', { all: true });
    const e = todos.errores.find((x) => x.agente === code)!;
    expect(await db.cambiarEstado(e.id, 'abierto', 'x@gsslatam.com', { all: false, companyIds: [], agentIds: [idOtroAgente] })).toBeNull();
    expect(await db.leerEventos(e.id, 'x@gsslatam.com', { all: false, companyIds: [], agentIds: [idOtroAgente] })).toBeNull();
  });

  it('reintentar: guardas de ambiente, respuesta posterior y entrega pendiente', async () => {
    const pub = await db.publicarErrores(
      parse({
        eventos: [
          ev({ titulo: 'turno de prueba A', clave: `r-${s}-1`, idMensaje: idMsg, idConversacion: idConv }),
          ev({ titulo: 'turno de prueba B', clave: `r-${s}-2`, idMensaje: idMsgRespondido }),
          ev({ titulo: 'turno de prueba C', clave: `r-${s}-3`, idMensaje: idMsg, ambiente: 'prod' }),
        ],
      }),
      { notificar: false, horas: 6 },
    );
    expect(pub.erroresNuevos).toBe(3);
    const todos = (await db.leerErrores('admin@gsslatam.com', { all: true })).errores;
    const a = todos.find((x) => x.titulo === 'turno de prueba A')!;
    const b = todos.find((x) => x.titulo === 'turno de prueba B')!;
    const c = todos.find((x) => x.titulo === 'turno de prueba C')!;

    const rc = await db.reintentarMensaje(c.id, 'nicolas@gsslatam.com');
    expect(rc.ok).toBe(false);
    const rb = await db.reintentarMensaje(b.id, 'nicolas@gsslatam.com');
    expect(rb).toMatchObject({ ok: false, status: 409 });

    const ra = await db.reintentarMensaje(a.id, 'nicolas@gsslatam.com');
    expect(ra).toEqual({ ok: true, idMensaje: idMsg, idConversacion: idConv });
    const m = await prisma.chatMessage.findUnique({ where: { id: idMsg } });
    expect(m?.delivered_at).toBeNull();
    const otraVez = await db.reintentarMensaje(a.id, 'nicolas@gsslatam.com');
    expect(otraVez.ok).toBe(false);
  });
});
