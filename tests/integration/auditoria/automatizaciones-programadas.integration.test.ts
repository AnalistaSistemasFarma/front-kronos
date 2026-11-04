import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Automatizaciones programadas (Indicador de automatizaciones) contra un SQL
 * Server real: el job de CI aplica
 * prisma/manual/2026-11-04-automatizaciones-programadas-PRUEBAS.sql sobre kronos_ci.
 * Prueba la publicación por clave (insertar y actualizar), el borrado solo de
 * los equipos leídos, que un código sin agente no entre y el alcance.
 */
const url = process.env.SGC_IT_DATABASE_URL;

// errors-db usa audit-access, que importa lib/prisma (y este, dbconfig): se apunta a la base efímera.
vi.mock("../../../lib/prisma", async () => {
  const { PrismaClient } = await import("../../../app/generated/prisma");
  return {
    prisma: new PrismaClient({
      datasources: {
        db: {
          url:
            process.env.SGC_IT_DATABASE_URL ??
            "sqlserver://localhost:1;database=x;user=x;password=x",
        },
      },
    }),
  };
});
vi.mock("../../../lib/access-control", () => ({
  checkAdminPrivileges: async () => false,
}));

vi.mock("../../../lib/mssqlPool", async () => {
  const sql = (await import("mssql")).default;
  const crudo = (process.env.SGC_IT_DATABASE_URL ?? "").replace(
    /^sqlserver:\/\//,
    "",
  );
  const [hostport, ...kv] = crudo.split(";");
  const p = Object.fromEntries(
    kv.filter(Boolean).map((s) => {
      const i = s.indexOf("=");
      return [s.slice(0, i).trim().toLowerCase(), s.slice(i + 1).trim()];
    }),
  );
  const [server, port] = (hostport ?? "").split(":");
  let pool: InstanceType<typeof sql.ConnectionPool> | null = null;
  return {
    sql,
    withMssqlPool: async <T>(
      fn: (pool: InstanceType<typeof sql.ConnectionPool>) => Promise<T>,
    ) => {
      if (!pool) {
        pool = await new sql.ConnectionPool({
          server: server || "localhost",
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

describe.skipIf(!url)(
  "Automatizaciones programadas · integración con SQL Server",
  () => {
    let prisma: import("../../../app/generated/prisma").PrismaClient;
    let db: typeof import("../../../lib/agent-audit/scheduled-db");
    let parse: typeof import("../../../lib/agent-audit/scheduled").parseProgramadas;
    const s = Date.now().toString(36);
    const code = `progit${s}`;
    const hostA = `ha${s}`;
    const hostB = `hb${s}`;
    let idAgent = 0;

    const job = (
      nombre: string,
      host: string,
      extra: Record<string, unknown> = {},
    ) => ({
      clave: `${host}:launchd:${nombre}`,
      code,
      host,
      tipo: "launchd",
      nombre,
      descripcion: "Emite las certificaciones laborales pendientes.",
      programacion: "Todos los días 16:00",
      cargada: true,
      habilitada: true,
      estado: "activa",
      ultimaCorrida: "2026-11-03T21:00:00Z",
      ultimaOk: true,
      corridas30: 30,
      ok30: 29,
      corridas90: 88,
      ok90: 85,
      produccionEtiqueta: "certificaciones emitidas",
      produccion30: 41,
      produccion90: 120,
      semanas: [
        { inicio: "2026-10-27", corridas: 7, ok: 7, produccion: 10 },
        { inicio: "2026-09-22", corridas: 7, ok: 5, produccion: 8 },
      ],
      ...extra,
    });

    beforeAll(async () => {
      const { PrismaClient } = await import("../../../app/generated/prisma");
      prisma = new PrismaClient({ datasources: { db: { url: url ?? "" } } });
      db = await import("../../../lib/agent-audit/scheduled-db");
      parse = (await import("../../../lib/agent-audit/scheduled"))
        .parseProgramadas;
      const a = await prisma.agent.create({
        data: { code, display_name: `Agente IT ${s}` },
      });
      idAgent = a.id_agent;
    });

    afterAll(async () => {
      await prisma?.$disconnect();
    });

    it("inserta, actualiza por clave e ignora códigos sin agente", async () => {
      const r1 = await db.publicarProgramadas(
        parse({
          corte: "2026-11-04",
          hostsLeidos: [hostA, hostB],
          automatizaciones: [
            job("cert", hostA),
            job("laft", hostB),
            { ...job("x", hostA), code: `nadie${s}` },
          ],
        }),
      );
      expect(r1.automatizaciones).toBe(2);
      expect(r1.sinAgente).toBe(1);

      await db.publicarProgramadas(
        parse({
          corte: "2026-11-05",
          hostsLeidos: [hostA, hostB],
          automatizaciones: [
            job("cert", hostA, { estado: "fallando", ok30: 10 }),
            job("laft", hostB),
          ],
        }),
      );
      const lista = (await db.leerProgramadas(
        "admin@gsslatam.com",
        { all: true },
        code,
      ))!;
      expect(lista).toHaveLength(2);
      const cert = lista.find((x) => x.nombre === "cert")!;
      expect(cert.idAgent).toBe(idAgent);
      expect(cert.estado).toBe("fallando");
      expect(cert.pctOk30).toBeCloseTo(33.3, 1);
      expect(cert.corte).toBe("2026-11-05");
      expect(cert.ultimaCorrida).toBe("2026-11-03T21:00:00.000Z");
      expect(cert.semanas).toHaveLength(2);
    });

    it("borra solo lo que desapareció de un equipo leído; lo de un equipo sin respuesta se conserva", async () => {
      // hostB no respondió: no viene en hostsLeidos, su automatización se conserva.
      const r = await db.publicarProgramadas(
        parse({
          corte: "2026-11-06",
          hostsLeidos: [hostA],
          automatizaciones: [],
        }),
      );
      expect(r.borradas).toBe(1);
      const lista = (await db.leerProgramadas(
        "admin@gsslatam.com",
        { all: true },
        code,
      ))!;
      expect(lista.map((x) => x.nombre)).toEqual(["laft"]);
      expect(lista[0].corte).toBe("2026-11-05");
    });

    it("respeta el alcance", async () => {
      const nada = await db.leerProgramadas(
        "x@gsslatam.com",
        { all: false, companyIds: [], agentIds: [] },
        code,
      );
      expect(nada).toEqual([]);
      const si = await db.leerProgramadas(
        "x@gsslatam.com",
        { all: false, companyIds: [], agentIds: [idAgent] },
        code,
      );
      expect(si).toHaveLength(1);
    });
  },
);
