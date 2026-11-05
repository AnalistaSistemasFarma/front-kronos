import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * ADMINISTRAR automatizaciones programadas y detectar las MUERTAS contra un SQL
 * Server real: el job de CI aplica 2026-11-04-automatizaciones-programadas-PRUEBAS.sql,
 * 2026-11-04-automatizaciones-admin-PRUEBAS.sql y 2026-11-03-errores-ia-PRUEBAS.sql
 * sobre kronos_ci. Prueba ref/horario/últimas, la salud «muerta», el ciclo de una
 * orden (una activa por automatización, equipo de la llave, transiciones, estado
 * nuevo al terminar, hoja de vida) y el aviso en Errores de IA.
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
  "Automatizaciones programadas · administrar · integración con SQL Server",
  () => {
    let prisma: import("../../../app/generated/prisma").PrismaClient;
    let db: typeof import("../../../lib/agent-audit/scheduled-db");
    let adm: typeof import("../../../lib/agent-audit/scheduled-admin-db");
    let avisos: typeof import("../../../lib/agent-audit/scheduled-avisos-db");
    let parse: typeof import("../../../lib/agent-audit/scheduled").parseProgramadas;
    const s = Date.now().toString(36);
    const code = `admit${s}`;
    const host = "jorge"; // el catálogo dice que com.jorge.carter.certificaciones es de jorge
    const clave = `${host}:launchd:com.jorge.carter.certificaciones-${s}`;
    let idAgent = 0;
    const hace = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

    const pub = (extra: Record<string, unknown> = {}) =>
      parse({
        corte: "2026-11-04",
        hostsLeidos: [],
        automatizaciones: [
          {
            clave,
            code,
            host,
            tipo: "launchd",
            nombre: "Certificaciones IT",
            ref: "com.jorge.carter.certificaciones",
            horario: { cada: 60 },
            cargada: true,
            habilitada: true,
            estado: "activa",
            ultimaCorrida: hace(5),
            ultimaOk: true,
            corridas30: 3,
            ok30: 3,
            ultimas: [{ ts: hace(5), ok: true }],
            ...extra,
          },
        ],
      });

    beforeAll(async () => {
      const { PrismaClient } = await import("../../../app/generated/prisma");
      prisma = new PrismaClient({ datasources: { db: { url: url ?? "" } } });
      db = await import("../../../lib/agent-audit/scheduled-db");
      adm = await import("../../../lib/agent-audit/scheduled-admin-db");
      avisos = await import("../../../lib/agent-audit/scheduled-avisos-db");
      parse = (await import("../../../lib/agent-audit/scheduled")).parseProgramadas;
      const a = await prisma.agent.create({ data: { code, display_name: `Agente admin IT ${s}` } });
      idAgent = a.id_agent;
    });

    afterAll(async () => {
      await prisma?.$disconnect();
    });

    it("guarda ref, horario y últimas; cada hora sin correr en 5 h = muerta", async () => {
      await db.publicarProgramadas(pub());
      const [p] = (await db.leerProgramadas("admin@gsslatam.com", { all: true }, code))!;
      expect(p.ref).toBe("com.jorge.carter.certificaciones");
      expect(p.horario).toEqual({ cada: 60 });
      expect(p.ultimas).toHaveLength(1);
      expect(p.salud).toBe("muerta");
      expect(p.administrable).toBe(true);
    });

    it("la registra en Errores de IA (tipo automatizacion) y la resuelve cuando vuelve a correr", async () => {
      const r1 = await avisos.avisarSalud([host]);
      expect(r1.disponible).toBe(true);
      expect(r1.muertas).toBeGreaterThanOrEqual(1);
      expect(r1.notificar).toEqual([]); // AGENT_ERRORS_NOTIFY apagado en CI
      const abiertos = await prisma.$queryRawUnsafe<{ estado: string }[]>(
        `SELECT estado FROM dbo.agent_error_issue WHERE agent_code = '${code}' AND tipo = 'automatizacion'`,
      );
      expect(abiertos.map((x) => x.estado)).toEqual(["abierto"]);
      // Una segunda pasada con la misma hora perdida no cuenta otra ocurrencia.
      await avisos.avisarSalud([host]);
      const oc = await prisma.$queryRawUnsafe<{ ocurrencias: number }[]>(
        `SELECT ocurrencias FROM dbo.agent_error_issue WHERE agent_code = '${code}' AND tipo = 'automatizacion'`,
      );
      expect(oc[0].ocurrencias).toBe(1);

      await db.publicarProgramadas(pub({ ultimaCorrida: hace(0.2), ultimas: [{ ts: hace(0.2), ok: true }] }));
      const r2 = await avisos.avisarSalud([host]);
      expect(r2.resueltos).toBeGreaterThanOrEqual(1);
      const despues = await prisma.$queryRawUnsafe<{ estado: string }[]>(
        `SELECT estado FROM dbo.agent_error_issue WHERE agent_code = '${code}' AND tipo = 'automatizacion'`,
      );
      expect(despues.map((x) => x.estado)).toEqual(["resuelto"]);
    });

    it("una sola orden activa; solo el ejecutor de su equipo la ve y la cierra; al terminar queda pausada", async () => {
      const [p] = (await db.leerProgramadas("admin@gsslatam.com", { all: true }, code))!;
      const o = await adm.crearOrdenProgramada({
        job: p,
        accion: "pausar",
        requestedBy: "Admin@GssLatam.com",
        ip: "10.0.0.8",
        userAgent: "Prueba/1.0",
      });
      expect(o.status).toBe("pendiente");
      expect(o.requestedBy).toBe("admin@gsslatam.com");
      await expect(
        adm.crearOrdenProgramada({ job: p, accion: "ejecutar", requestedBy: "otro@x", ip: null, userAgent: null }),
      ).rejects.toBeInstanceOf(adm.OrdenProgramadaActiva);

      expect((await adm.ordenesPendientesHost("local")).some((x) => x.id === o.id)).toBe(false);
      expect((await adm.ordenesPendientesHost(host)).some((x) => x.id === o.id)).toBe(true);
      expect(await adm.reportarOrdenProgramada("local", o.id, "en_curso", null, "local")).toBeNull();

      expect((await adm.reportarOrdenProgramada(host, o.id, "en_curso", null, "jorge"))?.status).toBe("en_curso");
      const fin = await adm.reportarOrdenProgramada(host, o.id, "ok", "bootout + disable + plist renombrado", "jorge");
      expect(fin?.status).toBe("ok");
      await expect(adm.reportarOrdenProgramada(host, o.id, "error", null, "jorge")).rejects.toBeInstanceOf(
        adm.TransicionProgramadaInvalida,
      );

      const [q] = (await db.leerProgramadas("admin@gsslatam.com", { all: true }, code))!;
      expect(q.cargada).toBe(false);
      expect(q.salud).toBe("pausada");
      expect(q.estadoDetalle).toContain("admin@gsslatam.com");

      const historial = await adm.ordenesDeProgramada(clave);
      expect(historial[0]).toMatchObject({ id: o.id, status: "ok", executor: "jorge" });
      const cv = await prisma.agentCvEntry.findMany({ where: { id_agent: idAgent, kind: "automatizacion" } });
      expect(cv).toHaveLength(2);
      expect(cv.map((c) => c.detail).join(" ")).toContain("10.0.0.8");
    });
  },
);
