import "server-only";
import { sql, withMssqlPool } from "../mssqlPool";
import { ORDEN_SEVERIDAD_VULN, type EstadoVuln, type PublicacionVulns, type SeveridadVuln } from "./vulns-rules";

/**
 * AUDITORÍA DE AGENTES → VULNERABILIDADES (OSV), 2026-11-19.
 * Tablas: prisma/manual/2026-11-19-vulnerabilidades-*.sql (sin modelo Prisma). Reglas puras: ./vulns-rules.ts.
 * Solo para la administración (alcance total): el mapa de vulnerabilidades es información sensible.
 */

export class VulnsNoDisponible extends Error {
  constructor() {
    super("El escaneo de vulnerabilidades aún no está habilitado en este ambiente.");
  }
}

type Fila = Record<string, unknown>;
async function conTablas<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if ((e as { number?: number } | null)?.number === 208) throw new VulnsNoDisponible();
    throw e;
  }
}
const fechaHora = (v: unknown) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString() : null);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown) => (v === null || v === undefined ? null : String(v));

export interface EscaneoDto {
  id: number;
  origen: string;
  status: "pendiente" | "en_curso" | "terminado" | "fallido";
  solicitadoPor: string | null;
  solicitadoEn: string | null;
  iniciadoEn: string | null;
  terminadoEn: string | null;
  progreso: string | null;
  repos: number | null;
  paquetes: number | null;
  hallazgos: number | null;
  criticas: number | null;
  altas: number | null;
  nuevas: number | null;
  resumen: string | null;
  error: string | null;
}

function aEscaneo(f: Fila | undefined): EscaneoDto | null {
  if (!f) return null;
  return {
    id: Number(f.id_run),
    origen: String(f.origen),
    status: String(f.status) as EscaneoDto["status"],
    solicitadoPor: txt(f.requested_by),
    solicitadoEn: fechaHora(f.requested_at),
    iniciadoEn: fechaHora(f.started_at),
    terminadoEn: fechaHora(f.finished_at),
    progreso: txt(f.progreso),
    repos: num(f.repos),
    paquetes: num(f.paquetes),
    hallazgos: num(f.hallazgos),
    criticas: num(f.criticas),
    altas: num(f.altas),
    nuevas: num(f.nuevas),
    resumen: txt(f.resumen),
    error: txt(f.error_summary),
  };
}

export interface HallazgoVulnDto {
  id: number;
  repo: string;
  rama: string;
  archivo: string;
  ecosistema: string;
  paquete: string;
  version: string;
  directa: boolean;
  vulnId: string;
  alias: string | null;
  resumen: string | null;
  severidad: SeveridadVuln;
  publicada: string | null;
  modificada: string | null;
  versionCorregida: string | null;
  referencia: string | null;
  primeraVez: string | null;
  estado: EstadoVuln;
  revisadoPor: string | null;
  revisadoEn: string | null;
  nota: string | null;
}

export interface VulnsDto {
  activa: EscaneoDto | null;
  ultimo: EscaneoDto | null;
  hallazgos: HallazgoVulnDto[];
  historial: EscaneoDto[];
}

export async function leerVulns(): Promise<VulnsDto> {
  return conTablas(async () => {
    const r = await withMssqlPool((pool) =>
      pool.request().query(`
        SELECT TOP 1 * FROM dbo.agent_vuln_run WHERE status IN (N'pendiente', N'en_curso') ORDER BY requested_at DESC;
        DECLARE @ultimo INT = (SELECT TOP 1 id_run FROM dbo.agent_vuln_run WHERE status = N'terminado' ORDER BY finished_at DESC);
        SELECT TOP 1 * FROM dbo.agent_vuln_run WHERE status IN (N'terminado', N'fallido') ORDER BY ISNULL(finished_at, requested_at) DESC;
        SELECT * FROM dbo.agent_vuln_finding WHERE id_run = @ultimo;
        SELECT TOP 12 * FROM dbo.agent_vuln_run ORDER BY requested_at DESC;
      `),
    );
    const sets = r.recordsets as unknown as Fila[][];
    const hallazgos: HallazgoVulnDto[] = (sets[2] ?? []).map((f) => ({
      id: Number(f.id_finding),
      repo: String(f.repo),
      rama: String(f.rama),
      archivo: String(f.archivo),
      ecosistema: String(f.ecosistema),
      paquete: String(f.paquete),
      version: String(f.version),
      directa: Boolean(f.directa),
      vulnId: String(f.vuln_id),
      alias: txt(f.alias),
      resumen: txt(f.resumen),
      severidad: String(f.severidad) as SeveridadVuln,
      publicada: fechaHora(f.publicada),
      modificada: fechaHora(f.modificada),
      versionCorregida: txt(f.version_corregida),
      referencia: txt(f.referencia),
      primeraVez: fechaHora(f.primera_vez),
      estado: String(f.estado) as EstadoVuln,
      revisadoPor: txt(f.revisado_por),
      revisadoEn: fechaHora(f.revisado_at),
      nota: txt(f.nota),
    }));
    hallazgos.sort(
      (a, b) =>
        ORDEN_SEVERIDAD_VULN.indexOf(a.severidad) - ORDEN_SEVERIDAD_VULN.indexOf(b.severidad) ||
        String(b.publicada ?? "").localeCompare(String(a.publicada ?? "")),
    );
    return {
      activa: aEscaneo(sets[0]?.[0]),
      ultimo: aEscaneo(sets[1]?.[0]),
      hallazgos,
      historial: (sets[3] ?? []).map((f) => aEscaneo(f)!).filter(Boolean),
    };
  });
}

/** «Escanear ahora» (o el programado): deja un escaneo pendiente; uno solo a la vez. */
export async function pedirEscaneo(origen: "manual" | "programado", email: string | null): Promise<EscaneoDto> {
  return conTablas(async () => {
    const r = await withMssqlPool((pool) =>
      pool
        .request()
        .input("origen", sql.NVarChar(20), origen)
        .input("email", sql.NVarChar(200), email).query(`
        SET XACT_ABORT ON; BEGIN TRAN;
        DECLARE @id INT = (SELECT TOP 1 id_run FROM dbo.agent_vuln_run WITH (UPDLOCK, HOLDLOCK)
                           WHERE status IN (N'pendiente', N'en_curso') ORDER BY requested_at DESC);
        IF @id IS NULL
        BEGIN
          INSERT INTO dbo.agent_vuln_run (origen, status, requested_by, requested_at) VALUES (@origen, N'pendiente', @email, SYSUTCDATETIME());
          SET @id = SCOPE_IDENTITY();
        END
        COMMIT TRAN;
        SELECT * FROM dbo.agent_vuln_run WHERE id_run = @id;
      `),
    );
    return aEscaneo((r.recordset as Fila[])[0])!;
  });
}

/** Escáner: toma el escaneo pendiente más antiguo (o null). Uno tomado hace 2 h se da por perdido. */
export async function tomarEscaneo(): Promise<EscaneoDto | null> {
  return conTablas(async () => {
    const r = await withMssqlPool((pool) =>
      pool.request().query(`
        SET XACT_ABORT ON; BEGIN TRAN;
        UPDATE dbo.agent_vuln_run SET status = N'fallido', finished_at = SYSUTCDATETIME(),
               error_summary = N'El escáner tomó el escaneo y no terminó a tiempo (2 horas).'
        WHERE status = N'en_curso' AND started_at < DATEADD(HOUR, -2, SYSUTCDATETIME());
        DECLARE @id INT = (SELECT TOP 1 id_run FROM dbo.agent_vuln_run WITH (UPDLOCK, READPAST) WHERE status = N'pendiente' ORDER BY requested_at);
        IF @id IS NOT NULL
          UPDATE dbo.agent_vuln_run SET status = N'en_curso', started_at = SYSUTCDATETIME(), progreso = N'Leyendo las dependencias de los repositorios…' WHERE id_run = @id;
        COMMIT TRAN;
        SELECT * FROM dbo.agent_vuln_run WHERE id_run = @id;
      `),
    );
    return aEscaneo((r.recordset as Fila[])[0]);
  });
}

export async function progresoEscaneo(idRun: number, texto: string): Promise<void> {
  await conTablas(() =>
    withMssqlPool((pool) =>
      pool
        .request()
        .input("id", sql.Int, idRun)
        .input("p", sql.NVarChar(200), texto.slice(0, 200))
        .query(`UPDATE dbo.agent_vuln_run SET progreso = @p WHERE id_run = @id AND status = N'en_curso';`),
    ),
  );
}

export async function fallarEscaneo(idRun: number, error: string): Promise<void> {
  await conTablas(() =>
    withMssqlPool((pool) =>
      pool
        .request()
        .input("id", sql.Int, idRun)
        .input("e", sql.NVarChar(1000), (error || "Error sin detalle").slice(0, 1000))
        .query(`UPDATE dbo.agent_vuln_run SET status = N'fallido', finished_at = SYSUTCDATETIME(), error_summary = @e
                WHERE id_run = @id AND status IN (N'pendiente', N'en_curso');`),
    ),
  );
}

/**
 * Publica un escaneo. «primera_vez» y la revisión (estado, nota, quién) se heredan del escaneo anterior
 * para el mismo repositorio + rama + paquete + versión + vulnerabilidad: así «nuevas» son las que
 * aparecieron en ESTE escaneo y lo revisado no se pierde.
 */
export async function publicarEscaneo(p: PublicacionVulns): Promise<{ hallazgos: number; nuevas: number }> {
  return conTablas(async () => {
    const r = await withMssqlPool((pool) =>
      pool
        .request()
        .input("id", sql.Int, p.idRun)
        .input("repos", sql.Int, p.repos)
        .input("paquetes", sql.Int, p.paquetes)
        .input("resumen", sql.NVarChar(2000), p.resumen)
        .input("h", sql.NVarChar(sql.MAX), JSON.stringify(p.hallazgos)).query(`
          SET XACT_ABORT ON; BEGIN TRAN;
          IF NOT EXISTS (SELECT 1 FROM dbo.agent_vuln_run WHERE id_run = @id AND status = N'en_curso')
            THROW 51630, N'El escaneo no está en curso.', 1;
          DECLARE @ahora DATETIME2 = SYSUTCDATETIME();
          DELETE FROM dbo.agent_vuln_finding WHERE id_run = @id;
          INSERT INTO dbo.agent_vuln_finding (id_run, repo, rama, archivo, ecosistema, paquete, version, directa, vuln_id, alias,
                 resumen, severidad, publicada, modificada, version_corregida, referencia, primera_vez, estado, revisado_por, revisado_at, nota)
          SELECT @id, j.repo, j.rama, j.archivo, j.ecosistema, j.paquete, j.version, ISNULL(j.directa, 0), j.vulnId, j.alias,
                 j.resumen, j.severidad, j.publicada, j.modificada, j.versionCorregida, j.referencia,
                 ISNULL(prev.primera_vez, @ahora), ISNULL(prev.estado, N'nuevo'), prev.revisado_por, prev.revisado_at, prev.nota
          FROM OPENJSON(@h) WITH (
                 repo NVARCHAR(150) '$.repo', rama NVARCHAR(100) '$.rama', archivo NVARCHAR(300) '$.archivo',
                 ecosistema NVARCHAR(30) '$.ecosistema', paquete NVARCHAR(250) '$.paquete', version NVARCHAR(80) '$.version',
                 directa BIT '$.directa', vulnId NVARCHAR(80) '$.vulnId', alias NVARCHAR(400) '$.alias', resumen NVARCHAR(600) '$.resumen',
                 severidad NVARCHAR(12) '$.severidad', publicada DATETIME2 '$.publicada', modificada DATETIME2 '$.modificada',
                 versionCorregida NVARCHAR(200) '$.versionCorregida', referencia NVARCHAR(500) '$.referencia') j
          OUTER APPLY (SELECT TOP 1 pf.primera_vez, pf.estado, pf.revisado_por, pf.revisado_at, pf.nota
                       FROM dbo.agent_vuln_finding pf
                       WHERE pf.id_run <> @id AND pf.repo = j.repo AND pf.rama = j.rama AND pf.paquete = j.paquete
                         AND pf.version = j.version AND pf.vuln_id = j.vulnId
                       ORDER BY pf.id_run DESC) prev;
          DECLARE @n INT = @@ROWCOUNT;
          DECLARE @nuevas INT = (SELECT COUNT(*) FROM dbo.agent_vuln_finding WHERE id_run = @id AND primera_vez = @ahora);
          UPDATE dbo.agent_vuln_run SET status = N'terminado', finished_at = @ahora, progreso = NULL, repos = @repos, paquetes = @paquetes,
                 hallazgos = @n, nuevas = @nuevas, resumen = @resumen, error_summary = NULL,
                 criticas = (SELECT COUNT(*) FROM dbo.agent_vuln_finding WHERE id_run = @id AND severidad = N'critica'),
                 altas = (SELECT COUNT(*) FROM dbo.agent_vuln_finding WHERE id_run = @id AND severidad = N'alta')
          WHERE id_run = @id;
          COMMIT TRAN;
          SELECT @n AS hallazgos, @nuevas AS nuevas;
        `),
    );
    const f = (r.recordset as Fila[])[0] ?? {};
    return { hallazgos: Number(f.hallazgos ?? 0), nuevas: Number(f.nuevas ?? 0) };
  });
}

/** Revisión de un hallazgo; se aplica a todas sus apariciones del último escaneo (mismo repo + rama + paquete + vuln). */
export async function revisarVuln(id: number, estado: EstadoVuln, nota: string | null, email: string): Promise<boolean> {
  return conTablas(async () => {
    const r = await withMssqlPool((pool) =>
      pool
        .request()
        .input("id", sql.Int, id)
        .input("estado", sql.NVarChar(20), estado)
        .input("nota", sql.NVarChar(1000), nota)
        .input("email", sql.NVarChar(200), email).query(`
          UPDATE dbo.agent_vuln_finding SET estado = @estado, nota = @nota, revisado_por = @email, revisado_at = SYSUTCDATETIME()
          WHERE id_finding = @id;
          SELECT @@ROWCOUNT AS n;
        `),
    );
    return Number((r.recordset as Fila[])[0]?.n ?? 0) > 0;
  });
}
