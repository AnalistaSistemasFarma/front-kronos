import "server-only";
import { sql, withMssqlPool } from "../mssqlPool";
import type { CpeMatch, InventoryInput, InventoryItem, Severity, ThreatCve } from "./threats-rules";

/**
 * AGENT AUDIT → VULNERABILITIES → «Lo más reciente y crítico» (2026-11-20).
 * Tables: prisma/manual/2026-11-20-vulnerabilidades-criticas-*.sql (no Prisma model). Pure rules: ./threats-rules.ts.
 * Administration only (full audit scope): the map of what affects us is sensitive.
 */

export class ThreatsUnavailable extends Error {
  constructor() {
    super("La pestaña «Lo más reciente y crítico» aún no está habilitada en este ambiente.");
  }
}

type Row = Record<string, unknown>;
async function withTables<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if ((e as { number?: number } | null)?.number === 208) throw new ThreatsUnavailable();
    throw e;
  }
}
const iso = (v: unknown) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString() : null);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

export interface SyncDto {
  id: number;
  origin: string;
  status: "pendiente" | "en_curso" | "terminado" | "fallido";
  requestedBy: string | null;
  requestedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  progress: string | null;
  kev: number | null;
  nvd: number | null;
  cves: number | null;
  summary: string | null;
  error: string | null;
}

function toSync(r: Row | undefined): SyncDto | null {
  if (!r) return null;
  return {
    id: Number(r.id_sync),
    origin: String(r.origen),
    status: String(r.status) as SyncDto["status"],
    requestedBy: str(r.requested_by),
    requestedAt: iso(r.requested_at),
    startedAt: iso(r.started_at),
    finishedAt: iso(r.finished_at),
    progress: str(r.progreso),
    kev: num(r.kev),
    nvd: num(r.nvd),
    cves: num(r.cves),
    summary: str(r.resumen),
    error: str(r.error_summary),
  };
}

function toCve(r: Row): ThreatCve & { nvdAt: string | null } {
  let cpes: CpeMatch[] = [];
  try {
    cpes = r.cpes ? (JSON.parse(String(r.cpes)) as CpeMatch[]) : [];
  } catch {
    cpes = [];
  }
  return {
    cveId: String(r.cve_id),
    titleEn: str(r.titulo_en),
    description: str(r.descripcion),
    cwes: String(r.cwes ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    cvss: num(r.cvss),
    severity: String(r.severidad) as Severity,
    published: iso(r.publicada),
    modified: iso(r.modificada),
    kev: Boolean(r.kev),
    kevAdded: iso(r.kev_agregada),
    kevDue: iso(r.kev_vence),
    kevRansomware: Boolean(r.kev_ransomware),
    kevVendor: str(r.kev_fabricante),
    kevProduct: str(r.kev_producto),
    epss: num(r.epss),
    cpes,
    nvdAt: iso(r.nvd_at),
  };
}

function toItem(r: Row): InventoryItem & { updatedBy: string | null; updatedAt: string | null } {
  return {
    id: Number(r.id_item),
    product: String(r.producto),
    vendor: String(r.fabricante),
    version: str(r.version),
    role: String(r.rol),
    cpe: String(r.cpe),
    keywords: str(r.palabras),
    notes: str(r.notas),
    active: Boolean(r.activo),
    updatedBy: str(r.updated_by),
    updatedAt: iso(r.updated_at),
  };
}

export type StoredCve = ReturnType<typeof toCve>;
export type StoredItem = ReturnType<typeof toItem>;

export interface ThreatsSnapshot {
  active: SyncDto | null;
  last: SyncDto | null;
  lastOk: SyncDto | null;
  history: SyncDto[];
  cves: StoredCve[];
  inventory: StoredItem[];
}

export async function readThreats(): Promise<ThreatsSnapshot> {
  return withTables(async () => {
    const r = await withMssqlPool((pool) =>
      pool.request().query(`
        SELECT TOP 1 * FROM dbo.agent_threat_sync WHERE status IN (N'pendiente', N'en_curso') ORDER BY requested_at DESC;
        SELECT TOP 1 * FROM dbo.agent_threat_sync WHERE status IN (N'terminado', N'fallido') ORDER BY ISNULL(finished_at, requested_at) DESC;
        SELECT TOP 1 * FROM dbo.agent_threat_sync WHERE status = N'terminado' ORDER BY finished_at DESC;
        SELECT TOP 10 * FROM dbo.agent_threat_sync ORDER BY requested_at DESC;
        SELECT * FROM dbo.agent_threat_cve;
        SELECT * FROM dbo.agent_threat_inventory ORDER BY rol, producto;
      `),
    );
    const s = r.recordsets as unknown as Row[][];
    return {
      active: toSync(s[0]?.[0]),
      last: toSync(s[1]?.[0]),
      lastOk: toSync(s[2]?.[0]),
      history: (s[3] ?? []).map((x) => toSync(x)!),
      cves: (s[4] ?? []).map(toCve),
      inventory: (s[5] ?? []).map(toItem),
    };
  });
}

export async function readInventory(): Promise<StoredItem[]> {
  return withTables(async () => {
    const r = await withMssqlPool((pool) => pool.request().query(`SELECT * FROM dbo.agent_threat_inventory ORDER BY rol, producto;`));
    return (r.recordset as Row[]).map(toItem);
  });
}

/** Light read for the sync job: what is already cached (to avoid re-downloading). */
export async function readCachedCves(): Promise<StoredCve[]> {
  return withTables(async () => {
    const r = await withMssqlPool((pool) => pool.request().query(`SELECT * FROM dbo.agent_threat_cve;`));
    return (r.recordset as Row[]).map(toCve);
  });
}

/** Asks for a refresh; only one pending/running at a time (returns the existing one). */
export async function requestSync(origin: "manual" | "programado", email: string | null): Promise<SyncDto> {
  return withTables(async () => {
    const r = await withMssqlPool((pool) =>
      pool
        .request()
        .input("origen", sql.NVarChar(20), origin)
        .input("email", sql.NVarChar(200), email).query(`
        SET XACT_ABORT ON; BEGIN TRAN;
        UPDATE dbo.agent_threat_sync SET status = N'fallido', finished_at = SYSUTCDATETIME(),
               error_summary = N'La actualización no terminó a tiempo (3 horas); se puede pedir de nuevo.'
        WHERE status = N'en_curso' AND started_at < DATEADD(HOUR, -3, SYSUTCDATETIME());
        DECLARE @id INT = (SELECT TOP 1 id_sync FROM dbo.agent_threat_sync WITH (UPDLOCK, HOLDLOCK)
                           WHERE status IN (N'pendiente', N'en_curso') ORDER BY requested_at DESC);
        IF @id IS NULL
        BEGIN
          INSERT INTO dbo.agent_threat_sync (origen, status, requested_by, requested_at) VALUES (@origen, N'pendiente', @email, SYSUTCDATETIME());
          SET @id = SCOPE_IDENTITY();
        END
        COMMIT TRAN;
        SELECT * FROM dbo.agent_threat_sync WHERE id_sync = @id;
      `),
    );
    return toSync((r.recordset as Row[])[0])!;
  });
}

/** Takes the oldest pending refresh (or null). A refresh started more than 1 h ago is considered lost. */
export async function claimSync(): Promise<SyncDto | null> {
  return withTables(async () => {
    const r = await withMssqlPool((pool) =>
      pool.request().query(`
        SET XACT_ABORT ON; BEGIN TRAN;
        UPDATE dbo.agent_threat_sync SET status = N'fallido', finished_at = SYSUTCDATETIME(),
               error_summary = N'La actualización no terminó a tiempo (3 horas); se puede pedir de nuevo.'
        WHERE status = N'en_curso' AND started_at < DATEADD(HOUR, -3, SYSUTCDATETIME());
        DECLARE @id INT = (SELECT TOP 1 id_sync FROM dbo.agent_threat_sync WITH (UPDLOCK, READPAST) WHERE status = N'pendiente' ORDER BY requested_at);
        IF @id IS NOT NULL
          UPDATE dbo.agent_threat_sync SET status = N'en_curso', started_at = SYSUTCDATETIME(), progreso = N'Descargando el catálogo de CISA…' WHERE id_sync = @id;
        COMMIT TRAN;
        SELECT * FROM dbo.agent_threat_sync WHERE id_sync = @id;
      `),
    );
    return toSync((r.recordset as Row[])[0]);
  });
}

export async function progressSync(id: number, text: string): Promise<void> {
  await withTables(() =>
    withMssqlPool((pool) =>
      pool
        .request()
        .input("id", sql.Int, id)
        .input("p", sql.NVarChar(200), text.slice(0, 200))
        .query(`UPDATE dbo.agent_threat_sync SET progreso = @p WHERE id_sync = @id AND status = N'en_curso';`),
    ),
  );
}

export async function failSync(id: number, error: string): Promise<void> {
  await withTables(() =>
    withMssqlPool((pool) =>
      pool
        .request()
        .input("id", sql.Int, id)
        .input("e", sql.NVarChar(1000), (error || "Error sin detalle").slice(0, 1000))
        .query(`UPDATE dbo.agent_threat_sync SET status = N'fallido', finished_at = SYSUTCDATETIME(), progreso = NULL, error_summary = @e
                WHERE id_sync = @id AND status IN (N'pendiente', N'en_curso');`),
    ),
  );
}

const UPSERT_CHUNK = 400;

/**
 * Upserts CVEs. NULL/empty values from the feed never erase cached data (a KEV-only refresh keeps the
 * CVSS and CPE ranges that NVD gave earlier); the KEV flags are sticky.
 */
export async function upsertCves(list: (ThreatCve & { fromNvd?: boolean })[]): Promise<void> {
  for (let i = 0; i < list.length; i += UPSERT_CHUNK) {
    const chunk = list.slice(i, i + UPSERT_CHUNK).map((c) => ({
      id: c.cveId,
      t: c.titleEn,
      d: c.description,
      w: c.cwes.join(",") || null,
      s: c.cvss,
      sev: c.severity,
      p: c.published,
      m: c.modified,
      k: c.kev ? 1 : 0,
      ka: c.kevAdded,
      kd: c.kevDue,
      kr: c.kevRansomware ? 1 : 0,
      kv: c.kevVendor,
      kp: c.kevProduct,
      e: c.epss,
      cp: c.cpes.length ? JSON.stringify(c.cpes) : null,
      n: c.fromNvd ? 1 : 0,
    }));
    await withTables(() =>
      withMssqlPool((pool) =>
        pool.request().input("j", sql.NVarChar(sql.MAX), JSON.stringify(chunk)).query(`
          SET XACT_ABORT ON;
          MERGE dbo.agent_threat_cve AS t
          USING (SELECT * FROM OPENJSON(@j) WITH (
                   id NVARCHAR(30) '$.id', t NVARCHAR(300) '$.t', d NVARCHAR(2000) '$.d', w NVARCHAR(200) '$.w',
                   s DECIMAL(3,1) '$.s', sev NVARCHAR(12) '$.sev', p DATETIME2 '$.p', m DATETIME2 '$.m', k BIT '$.k',
                   ka DATETIME2 '$.ka', kd DATETIME2 '$.kd', kr BIT '$.kr', kv NVARCHAR(150) '$.kv', kp NVARCHAR(200) '$.kp',
                   e DECIMAL(6,5) '$.e', cp NVARCHAR(MAX) '$.cp', n BIT '$.n')) AS s
          ON t.cve_id = s.id
          WHEN MATCHED THEN UPDATE SET
            titulo_en = ISNULL(s.t, t.titulo_en), descripcion = ISNULL(s.d, t.descripcion), cwes = ISNULL(s.w, t.cwes),
            cvss = ISNULL(s.s, t.cvss),
            severidad = CASE WHEN s.s IS NULL THEN t.severidad ELSE s.sev END,
            publicada = ISNULL(s.p, t.publicada), modificada = ISNULL(s.m, t.modificada),
            kev = CASE WHEN s.k = 1 OR t.kev = 1 THEN 1 ELSE 0 END,
            kev_agregada = ISNULL(s.ka, t.kev_agregada), kev_vence = ISNULL(s.kd, t.kev_vence),
            kev_ransomware = CASE WHEN s.kr = 1 OR t.kev_ransomware = 1 THEN 1 ELSE 0 END,
            kev_fabricante = ISNULL(s.kv, t.kev_fabricante), kev_producto = ISNULL(s.kp, t.kev_producto),
            epss = ISNULL(s.e, t.epss), cpes = ISNULL(s.cp, t.cpes),
            nvd_at = CASE WHEN s.n = 1 THEN SYSUTCDATETIME() ELSE t.nvd_at END,
            updated_at = SYSUTCDATETIME()
          WHEN NOT MATCHED THEN INSERT (cve_id, titulo_en, descripcion, cwes, cvss, severidad, publicada, modificada, kev, kev_agregada,
                 kev_vence, kev_ransomware, kev_fabricante, kev_producto, epss, cpes, nvd_at, updated_at)
            VALUES (s.id, s.t, s.d, s.w, s.s, s.sev, s.p, s.m, s.k, s.ka, s.kd, s.kr, s.kv, s.kp, s.e, s.cp,
                    CASE WHEN s.n = 1 THEN SYSUTCDATETIME() END, SYSUTCDATETIME());
        `),
      ),
    );
  }
}

/** Finishes a refresh and prunes CVEs that no source returned for 45 days. */
export async function finishSync(id: number, counts: { kev: number; nvd: number; summary: string }): Promise<void> {
  await withTables(() =>
    withMssqlPool((pool) =>
      pool
        .request()
        .input("id", sql.Int, id)
        .input("kev", sql.Int, counts.kev)
        .input("nvd", sql.Int, counts.nvd)
        .input("r", sql.NVarChar(2000), counts.summary.slice(0, 2000)).query(`
          SET XACT_ABORT ON; BEGIN TRAN;
          DELETE FROM dbo.agent_threat_cve WHERE updated_at < DATEADD(DAY, -45, SYSUTCDATETIME());
          UPDATE dbo.agent_threat_sync SET status = N'terminado', finished_at = SYSUTCDATETIME(), progreso = NULL, error_summary = NULL,
                 kev = @kev, nvd = @nvd, resumen = @r, cves = (SELECT COUNT(*) FROM dbo.agent_threat_cve)
          WHERE id_sync = @id;
          COMMIT TRAN;
        `),
    ),
  );
}

/* ------------------------------------------------------------------ inventory CRUD */

export async function createItem(x: InventoryInput, email: string): Promise<StoredItem> {
  return withTables(async () => {
    const r = await withMssqlPool((pool) =>
      pool
        .request()
        .input("producto", sql.NVarChar(150), x.product)
        .input("fabricante", sql.NVarChar(100), x.vendor)
        .input("version", sql.NVarChar(80), x.version)
        .input("rol", sql.NVarChar(100), x.role)
        .input("cpe", sql.NVarChar(400), x.cpe)
        .input("palabras", sql.NVarChar(300), x.keywords)
        .input("notas", sql.NVarChar(500), x.notes)
        .input("activo", sql.Bit, x.active)
        .input("email", sql.NVarChar(200), email).query(`
          INSERT INTO dbo.agent_threat_inventory (producto, fabricante, version, rol, cpe, palabras, notas, activo, updated_by)
          OUTPUT INSERTED.* VALUES (@producto, @fabricante, @version, @rol, @cpe, @palabras, @notas, @activo, @email);
        `),
    );
    return toItem((r.recordset as Row[])[0]);
  });
}

export async function updateItem(id: number, x: InventoryInput, email: string): Promise<StoredItem | null> {
  return withTables(async () => {
    const r = await withMssqlPool((pool) =>
      pool
        .request()
        .input("id", sql.Int, id)
        .input("producto", sql.NVarChar(150), x.product)
        .input("fabricante", sql.NVarChar(100), x.vendor)
        .input("version", sql.NVarChar(80), x.version)
        .input("rol", sql.NVarChar(100), x.role)
        .input("cpe", sql.NVarChar(400), x.cpe)
        .input("palabras", sql.NVarChar(300), x.keywords)
        .input("notas", sql.NVarChar(500), x.notes)
        .input("activo", sql.Bit, x.active)
        .input("email", sql.NVarChar(200), email).query(`
          UPDATE dbo.agent_threat_inventory SET producto = @producto, fabricante = @fabricante, version = @version, rol = @rol,
                 cpe = @cpe, palabras = @palabras, notas = @notas, activo = @activo, updated_by = @email, updated_at = SYSUTCDATETIME()
          OUTPUT INSERTED.*
          WHERE id_item = @id;
        `),
    );
    const row = (r.recordset as Row[])[0];
    return row ? toItem(row) : null;
  });
}

export async function deleteItem(id: number): Promise<boolean> {
  return withTables(async () => {
    const r = await withMssqlPool((pool) =>
      pool.request().input("id", sql.Int, id).query(`DELETE FROM dbo.agent_threat_inventory WHERE id_item = @id; SELECT @@ROWCOUNT AS n;`),
    );
    return Number((r.recordset as Row[])[0]?.n ?? 0) > 0;
  });
}
