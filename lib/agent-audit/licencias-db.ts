import "server-only";
import { sql, withMssqlPool } from "../mssqlPool";
import type { CuotaReportada } from "../proyectos/consumo-anthropic";
import {
  armarTablero,
  consumoVacio,
  validarAsignacion,
  valorApi,
  type AgenteLicenciaDto,
  type ConsumoDto,
  type TurnoRecienteDto,
  type LicenciaDto,
  type LicenciasDto,
  type SemanaUsoDto,
} from "./licencias";

/**
 * AUDITORÍA DE AGENTES → COSTOS Y LICENCIAS (Nicolás, 2026-11-17): qué licencias
 * de Anthropic tenemos, qué empresa paga cada una, qué agentes la usan, cuánto
 * cupo consumen (promedio de 4 semanas) y cuánto cuesta por empresa y área.
 * Tablas: prisma/manual/2026-11-17-auditoria-licencias-*.sql (sin modelo Prisma).
 * Reglas puras en ./licencias.ts. Nunca se guarda un token: solo su huella.
 */

export class LicenciasNoDisponibles extends Error {
  constructor() {
    super("El tablero de costos y licencias aún no está habilitado en este ambiente.");
  }
}
export class LicenciasValidacionError extends Error {}

type Fila = Record<string, unknown>;
/** 208 = objeto inexistente; 207 = columna inexistente (SQL del pase sin correr). */
const esAusente = (e: unknown) => [207, 208].includes((e as { number?: number } | null)?.number ?? 0);
async function conTablas<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (esAusente(e)) throw new LicenciasNoDisponibles();
    throw e;
  }
}
const iso = (v: unknown) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString() : null);
const fechaCorta = (v: unknown) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString().slice(0, 10) : null);
const txt = (v: unknown) => (v === null || v === undefined ? null : String(v).trim());
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Lee todo el tablero (solo administración; la reja está en el endpoint). */
export async function leerLicencias(): Promise<LicenciasDto> {
  return conTablas(async () => {
    const r = await withMssqlPool((pool) =>
      pool.request().query(`
        SELECT l.*, RTRIM(c.company) AS empresa
        FROM dbo.ai_license l JOIN dbo.company c ON c.id_company = l.id_company
        ORDER BY l.codigo;

        SELECT huella, id_license, estado, notas FROM dbo.ai_license_token;

        SELECT a.id_agent, a.code, a.display_name, a.avatar_url, a.avatar_updated_at,
               emp.id_company, RTRIM(emp.company) AS empresa,
               COALESCE(d.departamento, us.departamento) AS departamento,
               q.utilization_7d, q.reset_7d, q.utilization_5h, q.overage, q.measured_at, q.token_fp,
               la.id_license
        FROM dbo.agent a
        LEFT JOIN dbo.ai_license_agent la ON la.id_agent = a.id_agent
        LEFT JOIN dbo.chat_agent_quota q ON q.id_agent = a.id_agent
        LEFT JOIN dbo.agent_departamento d ON d.id_agent = a.id_agent
        OUTER APPLY (SELECT TOP 1 s.departamento FROM dbo.agent_use_summary s
                     WHERE s.id_agent = a.id_agent ORDER BY s.corte DESC) us
        OUTER APPLY (SELECT TOP 1 c.id_company, c.company FROM dbo.agent_company ac
                     JOIN dbo.company c ON c.id_company = ac.id_company
                     WHERE ac.id_agent = a.id_agent ORDER BY ac.is_primary DESC, ac.id_agent_company) emp
        WHERE a.is_active = 1
        ORDER BY a.display_name;

        -- Pico de cada semana (cada reinicio) por licencia, últimas 5 semanas.
        SELECT la.id_license, h.reset_7d, MAX(h.utilization_7d) AS pico
        FROM dbo.chat_agent_quota_history h
        JOIN dbo.ai_license_agent la ON la.id_agent = h.id_agent
        WHERE h.measured_at >= DATEADD(DAY, -35, SYSUTCDATETIME())
          AND h.reset_7d IS NOT NULL AND h.utilization_7d IS NOT NULL
        GROUP BY la.id_license, h.reset_7d;

        SELECT id_company, RTRIM(company) AS empresa FROM dbo.company ORDER BY company;

        -- CONSUMO EN VIVO (hook de consumo por turno de cada agente): mes y día en curso, hora de Colombia.
        DECLARE @ahoraCot DATETIME2(0) = DATEADD(HOUR, -5, SYSUTCDATETIME());
        DECLARE @iniMes DATETIME2(0) = DATEADD(HOUR, 5, CAST(DATEFROMPARTS(YEAR(@ahoraCot), MONTH(@ahoraCot), 1) AS DATETIME2(0)));
        DECLARE @iniDia DATETIME2(0) = DATEADD(HOUR, 5, CAST(CAST(@ahoraCot AS DATE) AS DATETIME2(0)));
        SELECT u.id_agent, u.models, CASE WHEN u.created_at >= @iniDia THEN 1 ELSE 0 END AS hoy,
               COUNT(*) AS turnos,
               SUM(CAST(ISNULL(u.input_tokens, 0) AS BIGINT)) AS entrada,
               SUM(CAST(ISNULL(u.cache_creation_tokens, 0) AS BIGINT)) AS cache_escritura,
               SUM(CAST(ISNULL(u.cache_read_tokens, 0) AS BIGINT)) AS cache_lectura,
               SUM(CAST(ISNULL(u.output_tokens, 0) AS BIGINT)) AS salida
        FROM dbo.chat_agent_turn_usage u
        WHERE u.created_at >= @iniMes
        GROUP BY u.id_agent, u.models, CASE WHEN u.created_at >= @iniDia THEN 1 ELSE 0 END;

        SELECT id_agent, MAX(created_at) AS ultimo FROM dbo.chat_agent_turn_usage
        WHERE created_at >= DATEADD(DAY, -90, SYSUTCDATETIME()) GROUP BY id_agent;

        SELECT TOP 25 u.id_agent, u.models, u.input_tokens, u.cache_creation_tokens, u.cache_read_tokens, u.output_tokens,
               COALESCE(u.turn_ended_at, u.created_at) AS fin
        FROM dbo.chat_agent_turn_usage u
        WHERE u.created_at >= DATEADD(DAY, -7, SYSUTCDATETIME())
        ORDER BY u.created_at DESC;
      `),
    );
    const [lics, tokens, agentes, semanas, empresas, consumos, ultimos, recientes] = r.recordsets as unknown as Fila[][];

    const tk = (f: Fila) => ({
      entrada: Number(f.entrada ?? f.input_tokens ?? 0),
      cacheEscritura: Number(f.cache_escritura ?? f.cache_creation_tokens ?? 0),
      cacheLectura: Number(f.cache_lectura ?? f.cache_read_tokens ?? 0),
      salida: Number(f.salida ?? f.output_tokens ?? 0),
    });
    const total = (x: ReturnType<typeof tk>) => x.entrada + x.cacheEscritura + x.cacheLectura + x.salida;
    const mes = new Map<number, ConsumoDto>();
    const dia = new Map<number, ConsumoDto>();
    for (const c of consumos ?? []) {
      const id = Number(c.id_agent);
      const t = tk(c);
      const v = { turnos: Number(c.turnos), tokens: total(t), valorApi: valorApi(txt(c.models), t) };
      const m = mes.get(id) ?? consumoVacio();
      mes.set(id, { turnos: m.turnos + v.turnos, tokens: m.tokens + v.tokens, valorApi: m.valorApi + v.valorApi });
      if (Number(c.hoy) === 1) {
        const d = dia.get(id) ?? consumoVacio();
        dia.set(id, { turnos: d.turnos + v.turnos, tokens: d.tokens + v.tokens, valorApi: d.valorApi + v.valorApi });
      }
    }
    const ultimoPorAgente = new Map<number, string | null>((ultimos ?? []).map((u) => [Number(u.id_agent), iso(u.ultimo)]));

    const licPorHuella = new Map<string, number>();
    for (const t of tokens) if (t.estado === "activo") licPorHuella.set(String(t.huella), Number(t.id_license));

    const ags: AgenteLicenciaDto[] = agentes.map((a) => {
      const huella = txt(a.token_fp);
      return {
        idAgent: Number(a.id_agent),
        code: String(a.code),
        nombre: String(a.display_name),
        idEmpresa: num(a.id_company),
        empresa: txt(a.empresa),
        departamento: txt(a.departamento),
        uso7d: num(a.utilization_7d),
        reinicio7d: iso(a.reset_7d),
        uso5h: num(a.utilization_5h),
        overage: txt(a.overage),
        medidoEn: iso(a.measured_at),
        idLicencia: num(a.id_license),
        idLicenciaPorHuella: huella ? (licPorHuella.get(huella) ?? null) : null,
        huellaToken: huella,
        consumoMes: mes.get(Number(a.id_agent)) ?? consumoVacio(),
        consumoHoy: dia.get(Number(a.id_agent)) ?? consumoVacio(),
        ultimoTurno: ultimoPorAgente.get(Number(a.id_agent)) ?? null,
        avatarUrl: txt(a.avatar_url),
        avatarVersion: a.avatar_updated_at instanceof Date ? a.avatar_updated_at.getTime() : null,
        participacion: null,
        costoAsignado: null,
      };
    });

    const semPorLic = new Map<number, SemanaUsoDto[]>();
    for (const s of semanas) {
      const k = Number(s.id_license);
      const lista = semPorLic.get(k) ?? [];
      lista.push({ reinicio: iso(s.reset_7d) ?? "", pico: Math.round(Number(s.pico) * 10) / 10 });
      semPorLic.set(k, lista);
    }

    const base = lics.map((l) => {
      const id = Number(l.id_license);
      // Un agente sin asignación manual cae en la licencia que indica su huella.
      const delaLicencia = ags.filter((a) => (a.idLicencia ?? a.idLicenciaPorHuella) === id);
      return {
        idLicencia: id,
        codigo: String(l.codigo),
        nombre: txt(l.nombre),
        idEmpresa: Number(l.id_company),
        empresa: String(l.empresa),
        organizacion: txt(l.organizacion),
        plan: txt(l.plan),
        costoMensual: num(l.costo_mensual),
        moneda: txt(l.moneda) ?? "USD",
        renovacion: fechaCorta(l.renovacion),
        responsable: txt(l.responsable),
        notas: txt(l.notas),
        activa: Boolean(l.activa),
        huellas: tokens
          .filter((t) => Number(t.id_license) === id)
          .map((t) => ({ huella: String(t.huella), estado: String(t.estado) })),
        agentes: delaLicencia,
        semanas: semPorLic.get(id) ?? [],
      } satisfies Omit<LicenciaDto, "usoActual" | "uso5h" | "promedio4" | "pico4" | "semaforo" | "costoPorAgente" | "capacidadSinUsar" | "alertas" | "consumoMes" | "consumoHoy" | "rendimiento">;
    });

    const sinLicencia = ags.filter((a) => a.idLicencia === null && a.idLicenciaPorHuella === null);
    const porRevocar = tokens
      .filter((t) => t.estado === "revocar")
      .map((t) => ({ huella: String(t.huella), notas: txt(t.notas) }));
    const porId = new Map(ags.map((a) => [a.idAgent, a]));
    const codigoLic = new Map(base.map((b) => [b.idLicencia, b.codigo]));
    const ultimosTurnos: TurnoRecienteDto[] = (recientes ?? []).map((u) => {
      const a = porId.get(Number(u.id_agent));
      const t = tk(u);
      const lic = a ? (a.idLicencia ?? a.idLicenciaPorHuella) : null;
      return {
        code: a?.code ?? String(u.id_agent),
        avatarUrl: a?.avatarUrl ?? null,
        avatarVersion: a?.avatarVersion ?? null,
        agente: a?.nombre ?? `Agente ${String(u.id_agent)}`,
        empresa: a?.empresa ?? null,
        licencia: lic ? (codigoLic.get(lic) ?? null) : null,
        modelos: txt(u.models),
        tokens: total(t),
        valorApi: valorApi(txt(u.models), t),
        fin: iso(u.fin),
      };
    });
    return armarTablero(
      base,
      sinLicencia,
      porRevocar,
      empresas.map((e) => ({ idEmpresa: Number(e.id_company), empresa: String(e.empresa) })),
      new Date(),
      { ultimosTurnos, agentesActivos: ags },
    );
  });
}

export interface LicenciaEntrada {
  idLicencia?: number | null;
  codigo?: string;
  nombre?: string | null;
  idEmpresa?: number;
  organizacion?: string | null;
  plan?: string | null;
  costoMensual?: number | null;
  moneda?: string | null;
  renovacion?: string | null;
  responsable?: string | null;
  notas?: string | null;
  activa?: boolean;
}

const corto = (v: unknown, max: number) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

/** Valida lo que llega del formulario. Lanza LicenciasValidacionError. */
export function parseLicencia(body: Record<string, unknown>): LicenciaEntrada {
  const e: LicenciaEntrada = {};
  if (body.idLicencia !== undefined && body.idLicencia !== null) {
    const id = Number(body.idLicencia);
    if (!Number.isInteger(id) || id <= 0) throw new LicenciasValidacionError("Licencia inválida.");
    e.idLicencia = id;
  }
  const codigo = corto(body.codigo, 10);
  if (codigo !== undefined && codigo !== null) {
    if (!/^[A-Za-z0-9_-]{1,10}$/.test(codigo)) throw new LicenciasValidacionError("El código usa letras, números o guiones (máx. 10).");
    e.codigo = codigo.toUpperCase();
  }
  if (body.idEmpresa !== undefined) {
    const id = Number(body.idEmpresa);
    if (!Number.isInteger(id) || id <= 0) throw new LicenciasValidacionError("Elija la empresa que paga la licencia.");
    e.idEmpresa = id;
  }
  if (body.costoMensual !== undefined) {
    if (body.costoMensual === null || body.costoMensual === "") e.costoMensual = null;
    else {
      const c = Number(body.costoMensual);
      if (!Number.isFinite(c) || c < 0 || c > 1_000_000) throw new LicenciasValidacionError("Costo mensual inválido.");
      e.costoMensual = Math.round(c * 100) / 100;
    }
  }
  if (body.renovacion !== undefined) {
    const r = corto(body.renovacion, 10);
    if (r && !/^\d{4}-\d{2}-\d{2}$/.test(r)) throw new LicenciasValidacionError("Fecha de renovación inválida (AAAA-MM-DD).");
    e.renovacion = r ?? null;
  }
  const moneda = corto(body.moneda, 3);
  if (moneda) {
    if (!/^[A-Za-z]{3}$/.test(moneda)) throw new LicenciasValidacionError("Moneda inválida (por ejemplo USD o COP).");
    e.moneda = moneda.toUpperCase();
  }
  e.nombre = corto(body.nombre, 120);
  e.organizacion = corto(body.organizacion, 40);
  e.plan = corto(body.plan, 40);
  e.responsable = corto(body.responsable, 200);
  e.notas = corto(body.notas, 500);
  if (body.activa !== undefined) e.activa = Boolean(body.activa);
  if (!e.idLicencia && (!e.codigo || !e.idEmpresa))
    throw new LicenciasValidacionError("Para crear una licencia hace falta el código y la empresa que la paga.");
  return e;
}

/** Crea o actualiza una licencia. Si cambia la empresa, revisa que sus agentes sigan siendo de esa empresa. */
export async function guardarLicencia(e: LicenciaEntrada, usuario: string): Promise<number> {
  return conTablas(() =>
    withMssqlPool(async (pool) => {
      if (e.idLicencia && e.idEmpresa) {
        const otros = await pool
          .request()
          .input("lic", sql.Int, e.idLicencia)
          .input("emp", sql.Int, e.idEmpresa)
          .query(`
            SELECT COUNT(*) AS n FROM dbo.ai_license_agent la
            OUTER APPLY (SELECT TOP 1 ac.id_company FROM dbo.agent_company ac
                         WHERE ac.id_agent = la.id_agent ORDER BY ac.is_primary DESC, ac.id_agent_company) emp
            WHERE la.id_license = @lic AND (emp.id_company IS NULL OR emp.id_company <> @emp)`);
        if (Number(otros.recordset[0]?.n ?? 0) > 0)
          throw new LicenciasValidacionError(
            "La licencia tiene agentes de otra empresa: muévalos primero (una licencia no se comparte entre empresas).",
          );
      }
      const q = pool
        .request()
        .input("id", sql.Int, e.idLicencia ?? null)
        .input("codigo", sql.NVarChar(10), e.codigo ?? null)
        .input("nombre", sql.NVarChar(120), e.nombre ?? null)
        .input("emp", sql.Int, e.idEmpresa ?? null)
        .input("org", sql.NVarChar(40), e.organizacion ?? null)
        .input("plan", sql.NVarChar(40), e.plan ?? null)
        .input("costo", sql.Decimal(12, 2), e.costoMensual ?? null)
        .input("moneda", sql.NVarChar(3), e.moneda ?? null)
        .input("renov", sql.Date, e.renovacion ? new Date(`${e.renovacion}T00:00:00Z`) : null)
        .input("resp", sql.NVarChar(200), e.responsable ?? null)
        .input("notas", sql.NVarChar(500), e.notas ?? null)
        .input("activa", sql.Bit, e.activa ?? null)
        .input("usr", sql.NVarChar(200), usuario)
        // Los campos que no vienen (undefined) no se tocan: se marcan con @set_*.
        .input("set_nombre", sql.Bit, e.nombre !== undefined)
        .input("set_org", sql.Bit, e.organizacion !== undefined)
        .input("set_plan", sql.Bit, e.plan !== undefined)
        .input("set_costo", sql.Bit, e.costoMensual !== undefined)
        .input("set_renov", sql.Bit, e.renovacion !== undefined)
        .input("set_resp", sql.Bit, e.responsable !== undefined)
        .input("set_notas", sql.Bit, e.notas !== undefined);
      const r = await q.query(`
        SET XACT_ABORT ON;
        IF @id IS NULL
        BEGIN
          IF EXISTS (SELECT 1 FROM dbo.ai_license WHERE codigo = @codigo)
            THROW 51710, N'Ya existe una licencia con ese código.', 1;
          INSERT dbo.ai_license (codigo, nombre, id_company, organizacion, plan, costo_mensual, moneda, renovacion, responsable, notas, activa, updated_by)
          VALUES (@codigo, @nombre, @emp, @org, @plan, @costo, ISNULL(@moneda, N'USD'), @renov, @resp, @notas, ISNULL(@activa, 1), @usr);
          SELECT CAST(SCOPE_IDENTITY() AS INT) AS id;
        END
        ELSE
        BEGIN
          UPDATE dbo.ai_license SET
            id_company    = ISNULL(@emp, id_company),
            nombre        = CASE WHEN @set_nombre = 1 THEN @nombre ELSE nombre END,
            organizacion  = CASE WHEN @set_org = 1 THEN @org ELSE organizacion END,
            plan          = CASE WHEN @set_plan = 1 THEN @plan ELSE plan END,
            costo_mensual = CASE WHEN @set_costo = 1 THEN @costo ELSE costo_mensual END,
            moneda        = ISNULL(@moneda, moneda),
            renovacion    = CASE WHEN @set_renov = 1 THEN @renov ELSE renovacion END,
            responsable   = CASE WHEN @set_resp = 1 THEN @resp ELSE responsable END,
            notas         = CASE WHEN @set_notas = 1 THEN @notas ELSE notas END,
            activa        = ISNULL(@activa, activa),
            updated_at    = SYSUTCDATETIME(),
            updated_by    = @usr
          WHERE id_license = @id;
          IF @@ROWCOUNT = 0 THROW 51711, N'La licencia no existe.', 1;
          SELECT @id AS id;
        END`);
      return Number(r.recordset[0]?.id);
    }).catch((err) => {
      const n = (err as { number?: number } | null)?.number;
      if (n === 51710 || n === 51711) throw new LicenciasValidacionError((err as Error).message);
      throw err;
    }),
  );
}

/** Asigna (o quita, con idLicencia null) la licencia de un agente. Regla: misma empresa. */
export async function asignarAgente(idAgent: number, idLicencia: number | null, usuario: string): Promise<void> {
  return conTablas(() =>
    withMssqlPool(async (pool) => {
      if (idLicencia === null) {
        await pool.request().input("ag", sql.Int, idAgent).query(`DELETE FROM dbo.ai_license_agent WHERE id_agent = @ag`);
        return;
      }
      const r = await pool
        .request()
        .input("ag", sql.Int, idAgent)
        .input("lic", sql.Int, idLicencia)
        .query(`
          SELECT (SELECT id_company FROM dbo.ai_license WHERE id_license = @lic) AS empresa_licencia,
                 (SELECT TOP 1 ac.id_company FROM dbo.agent_company ac WHERE ac.id_agent = @ag
                  ORDER BY ac.is_primary DESC, ac.id_agent_company) AS empresa_agente,
                 (SELECT COUNT(*) FROM dbo.agent WHERE id_agent = @ag) AS existe`);
      const f = r.recordset[0] ?? {};
      if (!Number(f.existe)) throw new LicenciasValidacionError("El agente no existe.");
      if (f.empresa_licencia === null || f.empresa_licencia === undefined) throw new LicenciasValidacionError("La licencia no existe.");
      const error = validarAsignacion(num(f.empresa_agente), Number(f.empresa_licencia));
      if (error) throw new LicenciasValidacionError(error);
      await pool
        .request()
        .input("ag", sql.Int, idAgent)
        .input("lic", sql.Int, idLicencia)
        .input("usr", sql.NVarChar(200), usuario)
        .query(`
          UPDATE dbo.ai_license_agent SET id_license = @lic, updated_at = SYSUTCDATETIME(), updated_by = @usr WHERE id_agent = @ag;
          IF @@ROWCOUNT = 0 INSERT dbo.ai_license_agent (id_agent, id_license, updated_by) VALUES (@ag, @lic, @usr);`);
    }),
  );
}

/**
 * Historial del cupo (máx. una fila por agente y hora, o cuando cambia la semana)
 * y huellas que declara el puente. Lo llama guardarCuota; si las tablas no
 * existen todavía o algo falla, NO tumba el reporte del cupo.
 */
export async function registrarHistorialCuota(idAgent: number, c: CuotaReportada): Promise<void> {
  try {
    await withMssqlPool((pool) =>
      pool
        .request()
        .input("ag", sql.Int, idAgent)
        .input("u7", sql.Float, c.utilizacion7d)
        .input("r7", sql.DateTime2(0), c.reset7d)
        .input("u5", sql.Float, c.utilizacion5h)
        .input("ov", sql.NVarChar(40), c.overage)
        .input("tfp", sql.NVarChar(16), c.huellaToken ?? null)
        .input("ofp", sql.NVarChar(16), c.huellaOrganizacion ?? null)
        .input("m", sql.DateTime2(0), c.medidoEn)
        .input("src", sql.NVarChar(20), c.fuente)
        .query(`
          IF NOT EXISTS (SELECT 1 FROM dbo.chat_agent_quota_history
                         WHERE id_agent = @ag AND measured_at > DATEADD(MINUTE, -55, @m)
                           AND ISNULL(reset_7d, '19000101') = ISNULL(@r7, '19000101'))
            INSERT dbo.chat_agent_quota_history (id_agent, utilization_7d, reset_7d, utilization_5h, overage, token_fp, org_fp, measured_at, source)
            VALUES (@ag, @u7, @r7, @u5, @ov, @tfp, @ofp, @m, @src);
          IF @tfp IS NOT NULL OR @ofp IS NOT NULL
            UPDATE dbo.chat_agent_quota SET token_fp = ISNULL(@tfp, token_fp), org_fp = ISNULL(@ofp, org_fp) WHERE id_agent = @ag;`),
    );
  } catch (error) {
    if (!esAusente(error)) console.warn("[licencias] no se pudo registrar el historial del cupo", (error as Error)?.message);
  }
}
