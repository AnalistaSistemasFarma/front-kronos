/**
 * Bitácora de Proceso (módulo de SynerLink para planta) — tools de SOLO LECTURA.
 *
 * Pedido de Nicolás Rivera (2026-10-14): «el MCP de SynerLink debe tener el
 * contexto de las órdenes de trabajo / producción para que podamos consultar
 * qué bitácoras han hecho a tiempo real».
 *
 * Tablas (nombre interno `ot_*`, ver prisma/schema.prisma y las migraciones
 * 20261013180000_ordenes_trabajo_p0, ..._inspector_iconos y ..._firmas):
 *   ot_orden_trabajo   una bitácora = un turno (código visible BP-0001 por empresa)
 *   ot_orden_operador  operarios SIN usuario programados en la bitácora (desde 2026-10-14)
 *   ot_operador        maestro de operarios por empresa
 *   ot_orden_operario  auxiliares CON usuario (solo bitácoras anteriores al 2026-10-14)
 *   ot_registro        intervenciones (hora del SERVIDOR, UTC; inmutables): operario
 *                      elegido (id_operador/operador_nombre) y usuario de la sesión (id_user)
 *   ot_actividad       catálogo de intervenciones por empresa
 *   ot_firma           VISTOS BUENOS (desde 2026-10-15, migración ..._cuatro_actores): OPERARIO,
 *                      SUPERVISOR («Cerró», cierra), INSPECTOR y JEFE_PROD, sin contraseña
 *                      (sesión propia o PIN en la tablet: auth_method). Las filas viejas
 *                      INSPECTOR «Verificó» eran del JEFE DE PRODUCCIÓN y se muestran así.
 *   ot_orden_trabajo.id_inspector / id_jefe_produccion: inspector y jefe de producción
 *                      (en las bitácoras del 2026-10-14 el jefe estaba en id_inspector; la
 *                      migración del 2026-10-15 lo pasó a id_jefe_produccion).
 *
 * Reglas de estas tools:
 *   - TODO el SQL pasa por queryReadOnly (candado assertReadOnlySql) y filtra
 *     SIEMPRE por las empresas del alcance de la key (companyClause).
 *   - NUNCA se exponen la imagen de la firma (firma_png), las huellas SHA-256,
 *     la IP ni el navegador de quien firma o registra.
 *   - Las horas se devuelven en ISO 8601 UTC (sufijo Z). Colombia = UTC-5.
 *   - En una base sin el módulo (producción antes del pase) responden con un
 *     error claro en vez de un 208 de SQL Server.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthScope } from '../auth.js';
import { effectiveCompanyFilter, type CompanyFilter } from '../scope.js';
import { Prisma, queryReadOnly } from '../db.js';

export const BITACORA_TOOLS = [
  'kronos_list_bitacoras',
  'kronos_get_bitacora',
  'kronos_bitacora_actividad_reciente',
  'kronos_list_bitacora_actividades',
] as const;

/** Tope de registros que devuelve kronos_get_bitacora para una sola bitácora. */
export const MAX_REGISTROS_POR_BITACORA = 2000;
/** Ventana por defecto de kronos_bitacora_actividad_reciente (minutos). */
export const ACTIVIDAD_RECIENTE_MINUTOS_DEFECTO = 60;
/** Ventana máxima hacia atrás de kronos_bitacora_actividad_reciente (días). */
export const ACTIVIDAD_RECIENTE_MAX_DIAS = 31;

const TURNO_LABEL: Record<string, string> = { MANANA: 'Mañana (06–14)', TARDE: 'Tarde (14–22)', NOCHE: 'Noche (22–06)' };
const SIGNIFICADO: Record<string, string> = { OPERARIO: 'Visto bueno', SUPERVISOR: 'Cerró', INSPECTOR: 'Visto bueno', JEFE_PROD: 'Visto bueno' };
const ROL_VISIBLE: Record<string, string> = { OPERARIO: 'operario', SUPERVISOR: 'supervisor', INSPECTOR: 'inspector', JEFE_PROD: 'jefe_produccion' };
const METODO_VISIBLE: Record<string, string> = {
  sesion_propia: 'sesion_propia',
  pin_tablet: 'pin_tablet',
  operario_tablet: 'operario_tablet',
  contrasena_synerlink: 'contrasena_synerlink',
};

/** Rol visible de una fila de ot_firma: la INSPECTOR «Verificó» del modelo anterior es del jefe. */
export function rolVisibleFirma(rol: unknown, significado: unknown): string {
  if (String(rol) === 'INSPECTOR' && String(significado) === 'Verificó') return 'jefe_produccion';
  return ROL_VISIBLE[String(rol)] ?? String(rol);
}

export interface BitacoraToolDeps {
  scope: AuthScope;
  maxPageSize: number;
  defaultPageSize: number;
  withAudit: <T>(
    tool: string,
    params: unknown,
    fn: () => Promise<{ result: unknown; rows?: number }>
  ) => Promise<T>;
  companyClause: (column: string, filter: CompanyFilter) => Prisma.Sql;
  isMissingTableError: (err: unknown) => boolean;
}

/** Código visible de la bitácora (igual que components/bitacora-proceso/otClient.ts). */
export function codigoBitacora(consecutivo: number): string {
  return `BP-${String(consecutivo).padStart(4, '0')}`;
}

/** Acepta «BP-0003», «bp-3», «BP3» o «3» y devuelve el consecutivo, o null. */
export function parseCodigoBitacora(codigo: string): number | null {
  const m = /^\s*(?:BP\s*-?\s*)?0*(\d{1,9})\s*$/i.exec(codigo);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Escapa los comodines de LIKE de SQL Server para buscar el texto literal. */
export function likeContains(text: string): string {
  return `%${text.replace(/[[%_]/g, (c) => `[${c}]`)}%`;
}

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Texto recortado (los nombres de usuario a veces traen espacios al final), o null. */
function txt(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function maxIso(...vals: unknown[]): string | null {
  let best: string | null = null;
  for (const v of vals) {
    const s = iso(v);
    if (s && (!best || s > best)) best = s;
  }
  return best;
}

function num(v: unknown): number {
  if (typeof v === 'bigint') return Number(v);
  return Number(v ?? 0);
}

function estadoVisible(estado: unknown, verificada: boolean): 'abierta' | 'cerrada' | 'verificada' {
  if (String(estado) === 'ABIERTA') return 'abierta';
  return verificada ? 'verificada' : 'cerrada';
}

export interface VistosBuenos {
  operario: boolean;
  supervisor: boolean;
  inspector: boolean;
  jefe_produccion: boolean;
}

/**
 * Estado de los vistos buenos en el orden operario → supervisor → inspector → jefe;
 * solo cuentan los actores que la bitácora tiene (operarios programados, inspector).
 */
export function estadoVistos(v: VistosBuenos, tiene: { operarios: boolean; inspector: boolean; jefe: boolean }): string {
  if (tiene.operarios && !v.operario) return 'falta_operario';
  if (!v.supervisor) return 'falta_supervisor';
  if (tiene.inspector && !v.inspector) return 'falta_inspector';
  if (tiene.jefe && !v.jefe_produccion) return 'falta_jefe_produccion';
  return 'completa';
}

/** Fecha ISO o YYYY-MM-DD válida (zod). */
const isoDate = z
  .string()
  .trim()
  .max(40)
  .refine((s) => !Number.isNaN(new Date(s).getTime()), { message: 'Fecha inválida: use ISO 8601 o YYYY-MM-DD.' });

/** ¿Existe el visto bueno de ese rol VISIBLE? (la fila INSPECTOR «Verificó» vieja cuenta como del jefe). */
const firmaExists = (rol: 'OPERARIO' | 'SUPERVISOR' | 'INSPECTOR' | 'JEFE_PROD') => {
  if (rol === 'INSPECTOR') {
    return Prisma.sql`EXISTS (SELECT 1 FROM ot_firma f WHERE f.id_orden_trabajo = o.id_orden_trabajo AND f.rol = N'INSPECTOR' AND f.significado <> N'Verificó')`;
  }
  if (rol === 'JEFE_PROD') {
    return Prisma.sql`EXISTS (SELECT 1 FROM ot_firma f WHERE f.id_orden_trabajo = o.id_orden_trabajo AND (f.rol = N'JEFE_PROD' OR (f.rol = N'INSPECTOR' AND f.significado = N'Verificó')))`;
  }
  return Prisma.sql`EXISTS (SELECT 1 FROM ot_firma f WHERE f.id_orden_trabajo = o.id_orden_trabajo AND f.rol = ${rol})`;
};

/** Filtro de persona: id exacto, o nombre/correo que contengan el texto. */
function personaClause(column: string, alias: string, value: string): Prisma.Sql {
  const like = likeContains(value);
  return Prisma.sql`(${Prisma.raw(column)} = ${value} OR ${Prisma.raw(alias)}.name LIKE ${like} OR ${Prisma.raw(alias)}.email LIKE ${like})`;
}

export function registerBitacoraTools(server: McpServer, deps: BitacoraToolDeps): void {
  const clampLimit = (limit?: number) =>
    !limit || limit <= 0 ? deps.defaultPageSize : Math.min(limit, deps.maxPageSize);
  const clampOffset = (offset?: number) => (!offset || offset < 0 ? 0 : offset);

  /** Corre la consulta y traduce «tabla inexistente» a un mensaje claro. */
  async function q<T>(sql: Prisma.Sql): Promise<T[]> {
    try {
      return await queryReadOnly<T>(sql);
    } catch (err) {
      if (deps.isMissingTableError(err)) {
        throw new Error('El módulo Bitácora de Proceso aún no está instalado en esta base de datos de SynerLink.');
      }
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // kronos_list_bitacoras
  // -------------------------------------------------------------------------
  server.tool(
    'kronos_list_bitacoras',
    'Lista las bitácoras de proceso (módulo «Bitácora de Proceso» de SynerLink: una bitácora = un turno de planta) de las empresas del alcance, más recientes primero. Cuatro actores: operario, supervisor, inspector y jefe de producción, cada uno con su visto bueno (en orden operario → supervisor, que cierra → inspector → jefe). Filtros: empresa, estado (abierta, cerrada = cerrada por el supervisor y con vistos buenos pendientes, verificada = con el visto bueno final del jefe de producción), rango de fechas de apertura, producto, lote, supervisor, inspector, jefe de producción y orden de producción de SAP. Devuelve el código BP-xxxx, producto, lote, turno con horario, área, horas de apertura y cierre (UTC), supervisor, inspector, jefe de producción, número de operarios y de registros, los cuatro vistos buenos (dados o no) con el siguiente pendiente, y la última actividad. Solo lectura.',
    {
      companyId: z.number().int().positive().optional().describe('Empresa a consultar; se interseca con el alcance de la key.'),
      estado: z.enum(['abierta', 'cerrada', 'verificada']).optional().describe('abierta | cerrada (con vistos buenos pendientes) | verificada (con el visto bueno del jefe de producción).'),
      desde: isoDate.optional().describe('Apertura desde (ISO 8601 o YYYY-MM-DD, UTC).'),
      hasta: isoDate.optional().describe('Apertura hasta (ISO 8601 o YYYY-MM-DD; con solo fecha incluye todo ese día UTC).'),
      producto: z.string().trim().min(1).max(200).optional().describe('Texto contenido en el producto o en el código de artículo.'),
      lote: z.string().trim().min(1).max(50).optional().describe('Texto contenido en el lote.'),
      supervisor: z.string().trim().min(1).max(255).optional().describe('Id de usuario, o texto del nombre o del correo de quien abrió la bitácora.'),
      jefeProduccion: z.string().trim().min(1).max(255).optional().describe('Id de usuario, o texto del nombre o del correo del jefe de producción (último visto bueno).'),
      inspector: z.string().trim().min(1).max(255).optional().describe('Id de usuario, o texto del nombre o del correo del inspector (desde 2026-10-15 es un actor distinto del jefe).'),
      ordenProduccion: z.number().int().positive().optional().describe('Número (DocNum) de la orden de producción de SAP asociada.'),
      limit: z.number().int().optional().describe('Tamaño de página (se limita al máximo del servidor).'),
      offset: z.number().int().optional(),
    },
    async (args) =>
      deps.withAudit('kronos_list_bitacoras', args, async () => {
        const filter = effectiveCompanyFilter(deps.scope, args.companyId ?? null);
        const limit = clampLimit(args.limit);
        const offset = clampOffset(args.offset);

        const where: Prisma.Sql[] = [deps.companyClause('o.id_company', filter)];
        if (args.estado === 'abierta') where.push(Prisma.sql`o.estado = N'ABIERTA'`);
        if (args.estado === 'cerrada') where.push(Prisma.sql`o.estado = N'CERRADA' AND NOT ${firmaExists('JEFE_PROD')}`);
        if (args.estado === 'verificada') where.push(Prisma.sql`o.estado = N'CERRADA' AND ${firmaExists('JEFE_PROD')}`);
        if (args.desde) where.push(Prisma.sql`o.abierta_en >= ${new Date(args.desde)}`);
        if (args.hasta) {
          const soloFecha = /^\d{4}-\d{2}-\d{2}$/.test(args.hasta);
          const hasta = new Date(args.hasta);
          if (soloFecha) {
            hasta.setUTCDate(hasta.getUTCDate() + 1);
            where.push(Prisma.sql`o.abierta_en < ${hasta}`);
          } else {
            where.push(Prisma.sql`o.abierta_en <= ${hasta}`);
          }
        }
        if (args.producto) {
          const like = likeContains(args.producto);
          where.push(Prisma.sql`(o.producto LIKE ${like} OR o.item_code LIKE ${like})`);
        }
        if (args.lote) where.push(Prisma.sql`o.lote LIKE ${likeContains(args.lote)}`);
        if (args.supervisor) where.push(personaClause('o.abierta_por', 'us', args.supervisor));
        if (args.jefeProduccion) where.push(personaClause('o.id_jefe_produccion', 'uj', args.jefeProduccion));
        if (args.inspector) where.push(personaClause('o.id_inspector', 'ui', args.inspector));
        if (args.ordenProduccion !== undefined) where.push(Prisma.sql`o.sap_op_docnum = ${args.ordenProduccion}`);
        const whereSql = Prisma.join(where, ' AND ');

        const rows = await q<Record<string, unknown>>(Prisma.sql`
          SELECT o.id_orden_trabajo, o.consecutivo, o.id_company, c.company,
                 o.producto, o.item_code, o.lote, o.turno, o.area, o.sap_op_docnum,
                 o.estado, o.abierta_en, o.cerrada_en,
                 o.abierta_por AS supervisor_id, us.name AS supervisor_nombre,
                 o.id_inspector AS inspector_id, ui.name AS inspector_nombre,
                 o.id_jefe_produccion AS jefe_id, uj.name AS jefe_nombre,
                 (SELECT COUNT(*) FROM ot_orden_operador op WHERE op.id_orden_trabajo = o.id_orden_trabajo)
                   + (SELECT COUNT(*) FROM ot_orden_operario oo WHERE oo.id_orden_trabajo = o.id_orden_trabajo) AS operarios,
                 (SELECT COUNT(*) FROM ot_orden_operador op WHERE op.id_orden_trabajo = o.id_orden_trabajo) AS operarios_programados,
                 (SELECT COUNT(*) FROM ot_registro r WHERE r.id_orden_trabajo = o.id_orden_trabajo) AS registros,
                 (SELECT MAX(r.registrado_en) FROM ot_registro r WHERE r.id_orden_trabajo = o.id_orden_trabajo) AS ultimo_registro_en,
                 (SELECT MAX(f.firmado_en) FROM ot_firma f WHERE f.id_orden_trabajo = o.id_orden_trabajo) AS ultima_firma_en,
                 CASE WHEN ${firmaExists('OPERARIO')} THEN 1 ELSE 0 END AS vb_operario,
                 CASE WHEN ${firmaExists('SUPERVISOR')} THEN 1 ELSE 0 END AS vb_supervisor,
                 CASE WHEN ${firmaExists('INSPECTOR')} THEN 1 ELSE 0 END AS vb_inspector,
                 CASE WHEN ${firmaExists('JEFE_PROD')} THEN 1 ELSE 0 END AS vb_jefe,
                 COUNT(*) OVER () AS total
          FROM ot_orden_trabajo o
          INNER JOIN company c ON c.id_company = o.id_company
          LEFT JOIN [user] us ON us.id = o.abierta_por
          LEFT JOIN [user] ui ON ui.id = o.id_inspector
          LEFT JOIN [user] uj ON uj.id = o.id_jefe_produccion
          WHERE ${whereSql}
          ORDER BY o.abierta_en DESC, o.id_orden_trabajo DESC
          OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
        `);

        const total = rows.length > 0 ? num(rows[0]?.total) : 0;
        const data = rows.map((r) => {
          const vistos: VistosBuenos = {
            operario: num(r.vb_operario) === 1,
            supervisor: num(r.vb_supervisor) === 1,
            inspector: num(r.vb_inspector) === 1,
            jefe_produccion: num(r.vb_jefe) === 1,
          };
          return {
            id: num(r.id_orden_trabajo),
            codigo: codigoBitacora(num(r.consecutivo)),
            id_company: num(r.id_company),
            company: r.company,
            producto: r.producto,
            item_code: r.item_code ?? null,
            lote: r.lote,
            turno: r.turno ? TURNO_LABEL[String(r.turno)] ?? r.turno : null,
            area: r.area ?? null,
            orden_produccion_sap: r.sap_op_docnum ?? null,
            estado: estadoVisible(r.estado, vistos.jefe_produccion),
            abierta_en: iso(r.abierta_en),
            cerrada_en: iso(r.cerrada_en),
            supervisor: { id: r.supervisor_id, nombre: txt(r.supervisor_nombre) },
            inspector: r.inspector_id ? { id: r.inspector_id, nombre: txt(r.inspector_nombre) } : null,
            jefe_produccion: r.jefe_id ? { id: r.jefe_id, nombre: txt(r.jefe_nombre) } : null,
            operarios: num(r.operarios),
            registros: num(r.registros),
            vistos_buenos: vistos,
            firmas: estadoVistos(vistos, { operarios: num(r.operarios_programados) > 0, inspector: Boolean(r.inspector_id), jefe: Boolean(r.jefe_id) }),
            ultima_actividad_en: maxIso(r.abierta_en, r.ultimo_registro_en, r.cerrada_en, r.ultima_firma_en),
          };
        });
        return {
          result: { count: data.length, total, limit, offset, zona_horaria: 'UTC (Colombia = UTC-5)', data },
          rows: data.length,
        };
      })
  );

  // -------------------------------------------------------------------------
  // kronos_get_bitacora
  // -------------------------------------------------------------------------
  server.tool(
    'kronos_get_bitacora',
    'Trae UNA bitácora de proceso completa: encabezado (código BP-xxxx, producto, lote, turno con horario, área, orden de producción de SAP y su copia, estado, horas de apertura y cierre, observación de cierre), participantes (supervisor, inspector, jefe de producción y operarios), todos los registros en orden cronológico (actividad, hora del servidor en UTC, operario que la hizo, usuario de la sesión que la registró y observación) y los cuatro vistos buenos (operario, supervisor «Cerró», inspector y jefe de producción) con nombre, hora y cómo se confirmó (sesión propia, PIN en tablet u operario en tablet). Indique id, o código (BP-0003) más companyId si la key ve varias empresas. Nunca devuelve imágenes de firma, huellas ni IP. Solo lectura.',
    {
      id: z.number().int().positive().optional().describe('Id interno de la bitácora (campo id de kronos_list_bitacoras).'),
      codigo: z.string().trim().min(1).max(20).optional().describe('Código visible, p. ej. BP-0003 (el consecutivo es por empresa).'),
      companyId: z.number().int().positive().optional().describe('Empresa; necesaria si el código existe en varias empresas del alcance.'),
    },
    async (args) =>
      deps.withAudit('kronos_get_bitacora', args, async () => {
        if (args.id === undefined && !args.codigo) throw new Error('Indique id o codigo de la bitácora.');
        const filter = effectiveCompanyFilter(deps.scope, args.companyId ?? null);
        const where: Prisma.Sql[] = [deps.companyClause('o.id_company', filter)];
        if (args.id !== undefined) where.push(Prisma.sql`o.id_orden_trabajo = ${args.id}`);
        if (args.codigo) {
          const consecutivo = parseCodigoBitacora(args.codigo);
          if (consecutivo === null) throw new Error('Código de bitácora inválido: use el formato BP-0001.');
          where.push(Prisma.sql`o.consecutivo = ${consecutivo}`);
        }

        const headers = await q<Record<string, unknown>>(Prisma.sql`
          SELECT TOP 6 o.id_orden_trabajo, o.consecutivo, o.id_company, c.company,
                 o.producto, o.item_code, o.lote, o.turno, o.area,
                 o.sap_op_docnum, o.sap_op_snapshot, o.estado,
                 o.abierta_en, o.cerrada_en, o.observacion_cierre,
                 o.abierta_por AS supervisor_id, us.name AS supervisor_nombre, us.email AS supervisor_email,
                 o.id_inspector AS inspector_id, ui.name AS inspector_nombre, ui.email AS inspector_email,
                 o.id_jefe_produccion AS jefe_id, uj.name AS jefe_nombre, uj.email AS jefe_email,
                 o.cerrada_por AS cerrada_por_id, uc.name AS cerrada_por_nombre
          FROM ot_orden_trabajo o
          INNER JOIN company c ON c.id_company = o.id_company
          LEFT JOIN [user] us ON us.id = o.abierta_por
          LEFT JOIN [user] ui ON ui.id = o.id_inspector
          LEFT JOIN [user] uj ON uj.id = o.id_jefe_produccion
          LEFT JOIN [user] uc ON uc.id = o.cerrada_por
          WHERE ${Prisma.join(where, ' AND ')}
          ORDER BY o.id_company
        `);
        if (headers.length === 0) {
          // Mismo mensaje si no existe o si está fuera del alcance (no confirma existencia).
          return { result: { found: false, message: 'No se encontró la bitácora en las empresas del alcance.' }, rows: 0 };
        }
        if (headers.length > 1) {
          return {
            result: {
              found: false,
              ambiguo: true,
              message: 'El código existe en varias empresas del alcance; repita la consulta con companyId o con id.',
              candidatos: headers.map((h) => ({ id: num(h.id_orden_trabajo), id_company: num(h.id_company), company: h.company, producto: h.producto, lote: h.lote })),
            },
            rows: 0,
          };
        }
        const h = headers[0]!;
        const idOrden = num(h.id_orden_trabajo);

        const [auxiliares, operadores, registros, firmas] = await Promise.all([
          q<Record<string, unknown>>(Prisma.sql`
            SELECT oo.id_user, u.name, u.email
            FROM ot_orden_operario oo
            LEFT JOIN [user] u ON u.id = oo.id_user
            WHERE oo.id_orden_trabajo = ${idOrden}
            ORDER BY u.name
          `),
          q<Record<string, unknown>>(Prisma.sql`
            SELECT op.id_operador, m.nombre, m.activo
            FROM ot_orden_operador op
            INNER JOIN ot_operador m ON m.id_operador = op.id_operador
            WHERE op.id_orden_trabajo = ${idOrden}
            ORDER BY m.nombre
          `),
          q<Record<string, unknown>>(Prisma.sql`
            SELECT TOP (${MAX_REGISTROS_POR_BITACORA + 1})
                   CAST(r.id_registro AS NVARCHAR(20)) AS id_registro, r.id_actividad, r.actividad_nombre,
                   r.registrado_en, r.observacion, r.id_user, u.name AS usuario_nombre,
                   r.id_operador, r.operador_nombre
            FROM ot_registro r
            LEFT JOIN [user] u ON u.id = r.id_user
            WHERE r.id_orden_trabajo = ${idOrden}
            ORDER BY r.registrado_en ASC, r.id_registro ASC
          `),
          // Solo columnas seguras: SIN firma_png, firma_sha256, content_sha256, ip ni user_agent.
          q<Record<string, unknown>>(Prisma.sql`
            SELECT f.rol, f.significado, f.id_user, f.signer_name, f.signer_email, f.firmado_en, f.auth_method, f.id_operador
            FROM ot_firma f
            WHERE f.id_orden_trabajo = ${idOrden}
            ORDER BY f.firmado_en ASC
          `),
        ]);

        let sapOp: unknown = null;
        if (typeof h.sap_op_snapshot === 'string' && h.sap_op_snapshot) {
          try {
            sapOp = JSON.parse(h.sap_op_snapshot);
          } catch {
            sapOp = null;
          }
        }
        const truncado = registros.length > MAX_REGISTROS_POR_BITACORA;
        const regs = registros.slice(0, MAX_REGISTROS_POR_BITACORA).map((r) => ({
          id: String(r.id_registro),
          actividad: r.actividad_nombre,
          id_actividad: num(r.id_actividad),
          registrado_en: iso(r.registrado_en),
          operario: r.id_operador != null ? { id: num(r.id_operador), nombre: txt(r.operador_nombre) } : null,
          usuario_sesion: { id: r.id_user, nombre: txt(r.usuario_nombre) },
          observacion: r.observacion ?? null,
        }));
        const firmasOut = firmas.map((f) => {
          const rol = rolVisibleFirma(f.rol, f.significado);
          return {
            rol,
            significado: f.significado ?? SIGNIFICADO[String(f.rol)] ?? null,
            nombre: f.signer_name ?? null,
            // El operario no tiene usuario: su visto bueno se dio desde la sesión de la tablet.
            email: rol === 'operario' ? null : (f.signer_email ?? null),
            id_user: rol === 'operario' ? null : f.id_user,
            id_operador: f.id_operador != null ? num(f.id_operador) : null,
            firmado_en: iso(f.firmado_en),
            metodo_autenticacion: METODO_VISIBLE[String(f.auth_method)] ?? f.auth_method ?? null,
          };
        });
        const vistos: VistosBuenos = {
          operario: firmasOut.some((f) => f.rol === 'operario'),
          supervisor: firmasOut.some((f) => f.rol === 'supervisor'),
          inspector: firmasOut.some((f) => f.rol === 'inspector'),
          jefe_produccion: firmasOut.some((f) => f.rol === 'jefe_produccion'),
        };

        return {
          result: {
            found: true,
            zona_horaria: 'UTC (Colombia = UTC-5)',
            bitacora: {
              id: idOrden,
              codigo: codigoBitacora(num(h.consecutivo)),
              id_company: num(h.id_company),
              company: h.company,
              producto: h.producto,
              item_code: h.item_code ?? null,
              lote: h.lote,
              turno: h.turno ? TURNO_LABEL[String(h.turno)] ?? h.turno : null,
              area: h.area ?? null,
              orden_produccion_sap: h.sap_op_docnum ?? null,
              orden_produccion_sap_copia: sapOp,
              estado: estadoVisible(h.estado, vistos.jefe_produccion),
              vistos_buenos: vistos,
              firmas_estado: estadoVistos(vistos, { operarios: operadores.length > 0, inspector: Boolean(h.inspector_id), jefe: Boolean(h.jefe_id) }),
              abierta_en: iso(h.abierta_en),
              cerrada_en: iso(h.cerrada_en),
              cerrada_por: h.cerrada_por_id ? { id: h.cerrada_por_id, nombre: txt(h.cerrada_por_nombre) } : null,
              observacion_cierre: h.observacion_cierre ?? null,
              ultima_actividad_en: maxIso(h.abierta_en, h.cerrada_en, ...regs.map((r) => r.registrado_en), ...firmasOut.map((f) => f.firmado_en)),
            },
            participantes: {
              supervisor: { id: h.supervisor_id, nombre: txt(h.supervisor_nombre), email: h.supervisor_email ?? null },
              inspector: h.inspector_id ? { id: h.inspector_id, nombre: txt(h.inspector_nombre), email: h.inspector_email ?? null } : null,
              jefe_produccion: h.jefe_id ? { id: h.jefe_id, nombre: txt(h.jefe_nombre), email: h.jefe_email ?? null } : null,
              operarios: operadores.map((a) => ({ id: num(a.id_operador), nombre: txt(a.nombre), activo: Boolean(a.activo) })),
              auxiliares_con_usuario: auxiliares.map((a) => ({ id: a.id_user, nombre: txt(a.name), email: a.email ?? null })),
            },
            registros: regs,
            registros_truncados: truncado,
            firmas: firmasOut,
          },
          rows: regs.length,
        };
      })
  );

  // -------------------------------------------------------------------------
  // kronos_bitacora_actividad_reciente
  // -------------------------------------------------------------------------
  server.tool(
    'kronos_bitacora_actividad_reciente',
    'Monitoreo en tiempo real de la Bitácora de Proceso: devuelve los registros (intervenciones) hechos desde una hora dada, de las bitácoras de las empresas del alcance (por defecto solo las abiertas y los últimos 60 minutos), en orden cronológico, con el código BP-xxxx, producto, lote, turno, actividad, operario que la hizo, usuario de la sesión, hora del servidor (UTC) y observación. Para seguir consultando sin repetir, envíe en despuesDeRegistro el valor siguiente_cursor de la respuesta anterior. Solo lectura.',
    {
      desde: isoDate.optional().describe('Registros desde esta hora (ISO 8601, UTC). Por defecto, hace 60 minutos. Máximo 31 días atrás.'),
      despuesDeRegistro: z.string().trim().regex(/^\d{1,19}$/).optional().describe('Cursor: solo registros con id mayor a este (siguiente_cursor de la llamada anterior).'),
      soloAbiertas: z.boolean().optional().describe('Solo bitácoras abiertas. Por defecto true.'),
      companyId: z.number().int().positive().optional().describe('Empresa a consultar; se interseca con el alcance de la key.'),
      bitacoraId: z.number().int().positive().optional().describe('Acota a una bitácora (id de kronos_list_bitacoras).'),
      limit: z.number().int().optional().describe('Máximo de registros (se limita al máximo del servidor).'),
    },
    async (args) =>
      deps.withAudit('kronos_bitacora_actividad_reciente', args, async () => {
        const filter = effectiveCompanyFilter(deps.scope, args.companyId ?? null);
        const limit = clampLimit(args.limit);
        const ahora = Date.now();
        const minimo = new Date(ahora - ACTIVIDAD_RECIENTE_MAX_DIAS * 24 * 60 * 60 * 1000);
        let desde = args.desde ? new Date(args.desde) : new Date(ahora - ACTIVIDAD_RECIENTE_MINUTOS_DEFECTO * 60 * 1000);
        if (desde < minimo) desde = minimo;
        const soloAbiertas = args.soloAbiertas ?? true;

        const where: Prisma.Sql[] = [deps.companyClause('o.id_company', filter), Prisma.sql`r.registrado_en >= ${desde}`];
        if (soloAbiertas) where.push(Prisma.sql`o.estado = N'ABIERTA'`);
        if (args.bitacoraId !== undefined) where.push(Prisma.sql`o.id_orden_trabajo = ${args.bitacoraId}`);
        if (args.despuesDeRegistro) where.push(Prisma.sql`r.id_registro > CAST(${args.despuesDeRegistro} AS BIGINT)`);

        const rows = await q<Record<string, unknown>>(Prisma.sql`
          SELECT TOP (${limit})
                 CAST(r.id_registro AS NVARCHAR(20)) AS id_registro, r.registrado_en, r.actividad_nombre,
                 r.observacion, r.id_user, u.name AS usuario_nombre, r.id_operador, r.operador_nombre,
                 o.id_orden_trabajo, o.consecutivo, o.id_company, c.company,
                 o.producto, o.lote, o.turno, o.estado
          FROM ot_registro r
          INNER JOIN ot_orden_trabajo o ON o.id_orden_trabajo = r.id_orden_trabajo
          INNER JOIN company c ON c.id_company = o.id_company
          LEFT JOIN [user] u ON u.id = r.id_user
          WHERE ${Prisma.join(where, ' AND ')}
          ORDER BY r.id_registro ASC
        `);

        const data = rows.map((r) => ({
          id: String(r.id_registro),
          registrado_en: iso(r.registrado_en),
          actividad: r.actividad_nombre,
          operario: r.id_operador != null ? { id: num(r.id_operador), nombre: txt(r.operador_nombre) } : null,
          usuario_sesion: { id: r.id_user, nombre: txt(r.usuario_nombre) },
          observacion: r.observacion ?? null,
          bitacora: {
            id: num(r.id_orden_trabajo),
            codigo: codigoBitacora(num(r.consecutivo)),
            id_company: num(r.id_company),
            company: r.company,
            producto: r.producto,
            lote: r.lote,
            turno: r.turno ? TURNO_LABEL[String(r.turno)] ?? r.turno : null,
            estado: String(r.estado) === 'ABIERTA' ? 'abierta' : 'cerrada',
          },
        }));
        return {
          result: {
            count: data.length,
            desde: desde.toISOString(),
            solo_abiertas: soloAbiertas,
            hay_mas: data.length === limit,
            siguiente_cursor: data.length > 0 ? data[data.length - 1]!.id : args.despuesDeRegistro ?? null,
            consultado_en: new Date(ahora).toISOString(),
            zona_horaria: 'UTC (Colombia = UTC-5)',
            data,
          },
          rows: data.length,
        };
      })
  );

  // -------------------------------------------------------------------------
  // kronos_list_bitacora_actividades (catálogo)
  // -------------------------------------------------------------------------
  server.tool(
    'kronos_list_bitacora_actividades',
    'Lista el catálogo de intervenciones de la Bitácora de Proceso por empresa (alimentación de tolva, mantenimiento, refrigerio, «Otra», etc.), en el orden en que se muestran en planta. La observación es opcional en todas. Por defecto solo las activas. Solo lectura.',
    {
      companyId: z.number().int().positive().optional().describe('Empresa a consultar; se interseca con el alcance de la key.'),
      incluirInactivas: z.boolean().optional().describe('Incluir actividades desactivadas. Por defecto false.'),
    },
    async (args) =>
      deps.withAudit('kronos_list_bitacora_actividades', args, async () => {
        const filter = effectiveCompanyFilter(deps.scope, args.companyId ?? null);
        const where: Prisma.Sql[] = [deps.companyClause('a.id_company', filter)];
        if (!args.incluirInactivas) where.push(Prisma.sql`a.activo = 1`);
        const rows = await q<Record<string, unknown>>(Prisma.sql`
          SELECT TOP 500 a.id_actividad, a.id_company, c.company, a.nombre, a.icono,
                 a.orden, a.activo
          FROM ot_actividad a
          INNER JOIN company c ON c.id_company = a.id_company
          WHERE ${Prisma.join(where, ' AND ')}
          ORDER BY a.id_company, a.orden, a.nombre
        `);
        const data = rows.map((a) => ({
          id: num(a.id_actividad),
          id_company: num(a.id_company),
          company: a.company,
          nombre: a.nombre,
          icono: a.icono ?? null,
          orden: num(a.orden),
          activo: Boolean(a.activo),
        }));
        return { result: { count: data.length, data }, rows: data.length };
      })
  );
}
