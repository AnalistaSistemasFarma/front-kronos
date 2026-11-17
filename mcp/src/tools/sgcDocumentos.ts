/**
 * SGC documental (esquema `sgc`) — herramientas de SOLO LECTURA.
 *
 * Pedido de Nicolás Rivera (2026-11-13, SynerLink prod, mensaje 33865): «haz las
 * herramientas en el MCP también para que pueda descargar esos documentos y verlos».
 *
 * Tablas (ver prisma/schema.prisma): sgc.company_config (empresa activa en el
 * SGC), sgc.document, sgc.document_version (current_version_id = vigente),
 * sgc.document_type, sgc.process_map / sgc.process_type, dbo.department (área)
 * y sgc.signature (firmas electrónicas del flujo que aprobó la versión).
 * Los PDF controlados viven en el OneDrive del usuario de servicio
 * (SGC/<EMPRESA>/<TIPO>/<CODIGO>/v<n>/); se descargan por MS Graph con el MISMO
 * cliente app-only que ya usa el MCP para los adjuntos (src/graph.ts), igual
 * que la app (lib/sgc/onedrive.ts → downloadVerifiedPdf).
 *
 * Política de acceso (CONSERVADORA). La llave del MCP no es una persona: no
 * tiene departamento, ni accesos excepcionales, ni rol de Calidad. Por eso
 * estas herramientas aplican la regla de la app para una persona SIN
 * departamento y SIN accesos (lib/sgc/documentAccess.ts):
 *   - solo empresas del alcance de la llave Y con el SGC activo;
 *   - solo documentos VIGENTES con confidencialidad «publica»; los de
 *     «departamento» y «confidencial» no se listan ni se entregan (tampoco se
 *     confirma que existan);
 *   - solo se descarga la versión VIGENTE (current_version_id); del historial
 *     se dan metadatos (número, estado, fechas, descripción del cambio);
 *   - nunca se exponen rutas ni ids de OneDrive, IP ni navegador de firmantes,
 *     accesos excepcionales ni el archivo fuente (Word/Excel).
 *   - la copia entregada se verifica contra su SHA-256 registrado y se marca
 *     como copia controlada (quién y cuándo), como hace el visor de la app.
 * Nada escribe en la base de datos ni en OneDrive; todo el SQL pasa por
 * queryReadOnly (candado assertReadOnlySql).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthScope } from '../auth.js';
import { effectiveCompanyFilter, type CompanyFilter } from '../scope.js';
import { Prisma, queryReadOnly } from '../db.js';
import type { GraphClient } from '../graph.js';
import { extractPdfText, sha256Hex, stampAgentCopy } from '../sgcPdf.js';
import { likeContains } from './bitacoraProceso.js';

export const SGC_TOOLS = [
  'sgc_list_documents',
  'sgc_get_document',
  'sgc_download_document',
  'sgc_list_document_types',
  'sgc_master_list',
] as const;

/** Tope del PDF que se descarga para extraer texto o entregar (bytes). */
export const SGC_MAX_PDF_BYTES = 15 * 1024 * 1024;
/** Tope del PDF que se devuelve en base64 dentro de la respuesta (bytes). */
export const SGC_MAX_INLINE_PDF_BYTES = 4 * 1024 * 1024;
/** Caracteres de texto extraído por defecto y máximo. */
export const SGC_TEXT_DEFAULT_CHARS = 60_000;
export const SGC_TEXT_MAX_CHARS = 200_000;
/** Tope de filas del listado maestro. */
export const SGC_MASTER_LIST_MAX = 2000;

/** Ruta del documento dentro de SynerLink (la persona lo abre con SUS permisos). */
export function synerlinkDocumentPath(idDocument: number): string {
  return `/process/sgc-documental/documentos/${idDocument}`;
}

export interface SgcToolDeps {
  scope: AuthScope;
  maxPageSize: number;
  defaultPageSize: number;
  withAudit: <T>(tool: string, params: unknown, fn: () => Promise<{ result: unknown; rows?: number }>) => Promise<T>;
  companyClause: (column: string, filter: CompanyFilter) => Prisma.Sql;
  isMissingTableError: (err: unknown) => boolean;
  getGraphClient: () => GraphClient | null;
}

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Fecha de calendario (columnas `date`) como YYYY-MM-DD. */
function day(v: unknown): string | null {
  const s = iso(v);
  return s ? s.slice(0, 10) : null;
}

function txt(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function num(v: unknown): number {
  if (typeof v === 'bigint') return Number(v);
  return Number(v ?? 0);
}

/**
 * Condición de visibilidad para la llave del MCP (ver cabecera). Va SIEMPRE en
 * el WHERE junto al filtro de empresa del alcance.
 */
const VISIBLE = Prisma.sql`cc.is_active = 1 AND d.status = N'vigente' AND d.confidentiality = N'publica' AND d.current_version_id IS NOT NULL`;

/** Fecha de revisión efectiva: la de la versión vigente o, si no, la del documento. */
const REVIEW_DATE = Prisma.sql`COALESCE(v.review_due_date, d.next_review_date)`;
const TODAY = Prisma.sql`CAST(GETDATE() AS date)`;

/** Estado de la revisión: vencido | por_vencer (dentro de alert_months del tipo) | al_dia | sin_fecha. */
const VIGENCIA_CASE = Prisma.sql`CASE
  WHEN ${REVIEW_DATE} IS NULL THEN N'sin_fecha'
  WHEN ${REVIEW_DATE} < ${TODAY} THEN N'vencido'
  WHEN ${REVIEW_DATE} < DATEADD(month, dt.alert_months, ${TODAY}) THEN N'por_vencer'
  ELSE N'al_dia' END`;

const FROM_DOCS = Prisma.sql`
  FROM sgc.document d
  INNER JOIN sgc.company_config cc ON cc.id_company = d.id_company
  INNER JOIN company c ON c.id_company = d.id_company
  INNER JOIN sgc.document_type dt ON dt.id_document_type = d.id_document_type
  INNER JOIN sgc.process_map pm ON pm.id_process_map = d.id_process_map
  LEFT JOIN sgc.process_type pt ON pt.id_process_type = pm.id_process_type
  LEFT JOIN department od ON od.id_department = d.id_owner_department
  LEFT JOIN department pd ON pd.id_department = pm.id_department
  LEFT JOIN sgc.document_version v ON v.id_document_version = d.current_version_id AND v.id_document = d.id_document`;

const DOC_COLUMNS = Prisma.sql`
  d.id_document, d.id_company, c.company, d.code, d.title, d.status, d.confidentiality,
  dt.id_document_type, dt.code AS type_code, dt.name AS type_name,
  pm.id_process_map, pm.code AS process_code, pm.name AS process_name,
  pt.code AS process_type_code, pt.name AS process_type_name,
  COALESCE(d.id_owner_department, pm.id_department) AS id_area,
  COALESCE(od.department, pd.department) AS area,
  v.id_document_version, v.version_number, v.status AS version_status,
  v.effective_date, ${REVIEW_DATE} AS review_due_date,
  ${VIGENCIA_CASE} AS vigencia`;

function docSummary(r: Record<string, unknown>) {
  return {
    id_document: num(r.id_document),
    code: txt(r.code),
    title: txt(r.title),
    id_company: num(r.id_company),
    company: txt(r.company),
    status: txt(r.status),
    confidentiality: txt(r.confidentiality),
    document_type: { id: num(r.id_document_type), code: txt(r.type_code), name: txt(r.type_name) },
    process: {
      id: num(r.id_process_map),
      code: txt(r.process_code),
      name: txt(r.process_name),
      process_type: txt(r.process_type_name),
    },
    area: r.id_area == null ? null : { id: num(r.id_area), name: txt(r.area) },
    current_version:
      r.version_number == null
        ? null
        : {
            id_version: num(r.id_document_version),
            version_number: num(r.version_number),
            status: txt(r.version_status),
            effective_date: day(r.effective_date),
          },
    review_due_date: day(r.review_due_date),
    vigencia: txt(r.vigencia),
    synerlink_path: synerlinkDocumentPath(num(r.id_document)),
  };
}

const companyIdParam = z.number().int().positive().optional().describe('Empresa a consultar (id_company); se interseca con el alcance de la llave.');
const documentRefParams = {
  idDocument: z.number().int().positive().optional().describe('id del documento (id_document de sgc_list_documents).'),
  code: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .optional()
    .describe('Código documental exacto (p. ej. «PR-GC-001»). Si el código existe en varias empresas, indique también companyId.'),
  companyId: companyIdParam,
};

export function registerSgcTools(server: McpServer, deps: SgcToolDeps): void {
  const clampLimit = (limit?: number) => (!limit || limit <= 0 ? deps.defaultPageSize : Math.min(limit, deps.maxPageSize));
  const clampOffset = (offset?: number) => (!offset || offset < 0 ? 0 : offset);

  async function q<T>(sql: Prisma.Sql): Promise<T[]> {
    try {
      return await queryReadOnly<T>(sql);
    } catch (err) {
      if (deps.isMissingTableError(err)) {
        throw new Error('El módulo SGC documental aún no está instalado en esta base de datos de SynerLink.');
      }
      throw err;
    }
  }

  /** Resuelve UN documento visible por id o código. null si no existe o no es visible (no se distingue). */
  async function resolveDocument(args: { idDocument?: number; code?: string; companyId?: number }): Promise<Record<string, unknown> | null> {
    if (args.idDocument === undefined && !args.code) {
      throw new Error('Indique "idDocument" o "code".');
    }
    const filter = effectiveCompanyFilter(deps.scope, args.companyId ?? null);
    const conds: Prisma.Sql[] = [VISIBLE, deps.companyClause('d.id_company', filter)];
    if (args.idDocument !== undefined) conds.push(Prisma.sql`d.id_document = ${args.idDocument}`);
    if (args.code) conds.push(Prisma.sql`UPPER(d.code) = UPPER(${args.code})`);
    const rows = await q<Record<string, unknown>>(Prisma.sql`
      SELECT TOP 2 ${DOC_COLUMNS},
        d.created_by, d.created_at, d.updated_at, d.next_review_date,
        dt.review_months, dt.requires_training,
        v.pdf_item_id, v.pdf_file_name, v.pdf_sha256, v.pdf_size, v.change_description,
        v.id_request, v.created_by AS version_created_by, v.created_at AS version_created_at
      ${FROM_DOCS}
      WHERE ${Prisma.join(conds, ' AND ')}
      ORDER BY d.id_company`);
    if (rows.length > 1) {
      throw new Error(`El código "${args.code}" existe en varias empresas del alcance; indique companyId.`);
    }
    return rows[0] ?? null;
  }

  // -------------------------------------------------------------------------
  // sgc_list_documents
  // -------------------------------------------------------------------------
  server.tool(
    'sgc_list_documents',
    'SOLO LECTURA. Lista los documentos controlados del SGC documental de SynerLink (manuales, procedimientos, instructivos, formatos…) de las empresas del alcance que tengan el SGC activo. Por política, el asistente solo ve documentos VIGENTES de confidencialidad «pública» (los de área o confidenciales se consultan en SynerLink con el usuario de la persona). Filtros: texto (en el código o el título), tipo documental (código como «PR», nombre o id), área (id o nombre), estado (solo «vigente») y vigencia de la revisión (vencido, por_vencer, al_dia, sin_fecha). Paginado (limit/offset), ordenado por código. Devuelve id, código, título, empresa, tipo, proceso, área, versión vigente con su fecha de emisión, fecha de próxima revisión y la ruta del documento en SynerLink. Use sgc_get_document para el detalle y sgc_download_document para leer o descargar el PDF.',
    {
      companyId: companyIdParam,
      texto: z.string().trim().min(1).max(200).optional().describe('Texto a buscar en el código o el título (contiene, sin distinguir mayúsculas).'),
      tipo: z.string().trim().min(1).max(100).optional().describe('Tipo documental: código («PR», «FO»…), nombre o id numérico. Vea sgc_list_document_types.'),
      areaId: z.number().int().positive().optional().describe('Área dueña del documento (id_department).'),
      area: z.string().trim().min(1).max(150).optional().describe('Área dueña del documento por nombre (contiene).'),
      estado: z.enum(['vigente']).optional().describe('Estado del documento. El asistente solo accede a documentos vigentes (por defecto).'),
      vigencia: z
        .enum(['vencido', 'por_vencer', 'al_dia', 'sin_fecha'])
        .optional()
        .describe('Estado de la revisión periódica: vencido (fecha de revisión pasada), por_vencer (dentro de los meses de alerta del tipo), al_dia o sin_fecha.'),
      limit: z.number().int().positive().optional().describe('Filas por página (tope del servidor).'),
      offset: z.number().int().min(0).optional().describe('Desplazamiento para paginar.'),
    },
    async (args) =>
      deps.withAudit('sgc_list_documents', args, async () => {
        const filter = effectiveCompanyFilter(deps.scope, args.companyId ?? null);
        const limit = clampLimit(args.limit);
        const offset = clampOffset(args.offset);
        const conds: Prisma.Sql[] = [VISIBLE, deps.companyClause('d.id_company', filter)];
        if (args.texto) {
          const like = likeContains(args.texto);
          conds.push(Prisma.sql`(d.code LIKE ${like} OR d.title LIKE ${like})`);
        }
        if (args.tipo) {
          if (/^\d+$/.test(args.tipo)) conds.push(Prisma.sql`dt.id_document_type = ${Number(args.tipo)}`);
          else conds.push(Prisma.sql`(UPPER(dt.code) = UPPER(${args.tipo}) OR dt.name LIKE ${likeContains(args.tipo)} OR dt.plural_name LIKE ${likeContains(args.tipo)})`);
        }
        if (args.areaId !== undefined) conds.push(Prisma.sql`COALESCE(d.id_owner_department, pm.id_department) = ${args.areaId}`);
        if (args.area) conds.push(Prisma.sql`COALESCE(od.department, pd.department) LIKE ${likeContains(args.area)}`);
        if (args.vigencia) conds.push(Prisma.sql`(${VIGENCIA_CASE}) = ${args.vigencia}`);

        const rows = await q<Record<string, unknown>>(Prisma.sql`
          SELECT ${DOC_COLUMNS}, COUNT(*) OVER () AS total
          ${FROM_DOCS}
          WHERE ${Prisma.join(conds, ' AND ')}
          ORDER BY d.code, d.id_company
          OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`);
        const total = rows.length ? num(rows[0]!.total) : 0;
        return {
          result: {
            total,
            limit,
            offset,
            documents: rows.map(docSummary),
            access_note:
              'Solo documentos vigentes de confidencialidad pública de empresas con el SGC activo. Los de área o confidenciales se consultan en SynerLink con el usuario de la persona.',
          },
          rows: rows.length,
        };
      })
  );

  // -------------------------------------------------------------------------
  // sgc_get_document
  // -------------------------------------------------------------------------
  server.tool(
    'sgc_get_document',
    'SOLO LECTURA. Detalle de UN documento controlado del SGC documental (por idDocument o por código): metadatos (código, título, tipo, proceso, área, confidencialidad, creado por, fechas), versión vigente (número, fecha de emisión, fecha de revisión, descripción del cambio, nombre, tamaño y huella SHA-256 del PDF), historial de versiones (solo metadatos: número, estado, fechas de emisión y obsolescencia, descripción del cambio) y firmas electrónicas del flujo que aprobó la versión vigente (elaboró, revisó, aprobó, con fecha). Solo documentos vigentes de confidencialidad pública de empresas del alcance; si no es visible responde null.',
    documentRefParams,
    async (args) =>
      deps.withAudit('sgc_get_document', args, async () => {
        const doc = await resolveDocument(args);
        if (!doc) return { result: null, rows: 0 };
        const idDocument = num(doc.id_document);

        const versions = await q<Record<string, unknown>>(Prisma.sql`
          SELECT v.id_document_version, v.version_number, v.status, v.effective_date, v.review_due_date,
                 v.obsolete_date, v.change_description, v.created_at
          FROM sgc.document_version v
          WHERE v.id_document = ${idDocument}
          ORDER BY v.version_number DESC`);

        let signatures: Record<string, unknown>[] = [];
        if (doc.id_request != null) {
          signatures = await q<Record<string, unknown>>(Prisma.sql`
            SELECT s.signer_name, s.signer_email, s.meaning, s.signed_at, s.on_behalf_of
            FROM sgc.signature s
            WHERE s.id_request = ${num(doc.id_request)} AND s.id_company = ${num(doc.id_company)}
              AND s.meaning IN (N'elaboro', N'reviso', N'aprobo')
            ORDER BY s.signed_at`);
        }
        const MEANING: Record<string, string> = { elaboro: 'Elaboró', reviso: 'Revisó', aprobo: 'Aprobó' };

        return {
          result: {
            ...docSummary(doc),
            created_by: txt(doc.created_by),
            created_at: iso(doc.created_at),
            updated_at: iso(doc.updated_at),
            next_review_date: day(doc.next_review_date),
            review_months: doc.review_months == null ? null : num(doc.review_months),
            requires_training: doc.requires_training == null ? null : Boolean(doc.requires_training),
            current_version_detail: {
              version_number: num(doc.version_number),
              status: txt(doc.version_status),
              effective_date: day(doc.effective_date),
              review_due_date: day(doc.review_due_date),
              change_description: txt(doc.change_description),
              pdf_file_name: txt(doc.pdf_file_name),
              pdf_size: doc.pdf_size == null ? null : num(doc.pdf_size),
              pdf_sha256: txt(doc.pdf_sha256),
              created_by: txt(doc.version_created_by),
              created_at: iso(doc.version_created_at),
              origin: doc.id_request == null ? 'carga_inicial' : 'flujo_aprobacion',
            },
            versions: versions.map((v) => ({
              version_number: num(v.version_number),
              status: txt(v.status),
              is_current: num(v.id_document_version) === num(doc.id_document_version),
              effective_date: day(v.effective_date),
              review_due_date: day(v.review_due_date),
              obsolete_date: day(v.obsolete_date),
              change_description: txt(v.change_description),
              created_at: iso(v.created_at),
            })),
            signatures: signatures.map((s) => ({
              meaning: MEANING[String(s.meaning)] ?? txt(s.meaning),
              signer_name: txt(s.signer_name),
              signer_email: txt(s.signer_email),
              on_behalf_of: txt(s.on_behalf_of),
              signed_at: iso(s.signed_at),
            })),
            signatures_note:
              doc.id_request == null
                ? 'La versión vigente se cargó en la carga inicial de Calidad (documento ya firmado fuera del sistema): no tiene firmas electrónicas de SynerLink.'
                : undefined,
            download_note: 'Solo se descarga la versión vigente, con sgc_download_document. Las versiones anteriores se consultan en SynerLink (Calidad).',
          },
          rows: 1,
        };
      })
  );

  // -------------------------------------------------------------------------
  // sgc_download_document
  // -------------------------------------------------------------------------
  server.tool(
    'sgc_download_document',
    `SOLO LECTURA. Descarga el PDF controlado de la versión VIGENTE de un documento del SGC (por idDocument o código) desde OneDrive (MS Graph), verifica su huella SHA-256 registrada y devuelve: (1) el TEXTO extraído del PDF, página por página (por defecto hasta ${SGC_TEXT_DEFAULT_CHARS} caracteres; maxCaracteres hasta ${SGC_TEXT_MAX_CHARS}); y (2) si incluirPdf=true y pesa hasta 4 MB, el PDF en base64 marcado como «copia controlada» entregada al asistente (quién y cuándo). PDF de hasta 15 MB. Un PDF escaneado puede no tener texto (no hay OCR). Si indica "version", debe ser la vigente. Para abrirlo con su propio usuario, la persona puede usar synerlink_path en SynerLink. Solo documentos vigentes de confidencialidad pública de empresas del alcance.`,
    {
      ...documentRefParams,
      version: z.number().int().positive().optional().describe('Número de versión (version_number). Solo se entrega la vigente; por defecto, la vigente.'),
      incluirTexto: z.boolean().optional().describe('Extraer y devolver el texto del PDF (por defecto true).'),
      maxCaracteres: z
        .number()
        .int()
        .min(1000)
        .max(SGC_TEXT_MAX_CHARS)
        .optional()
        .describe(`Máximo de caracteres de texto (por defecto ${SGC_TEXT_DEFAULT_CHARS}).`),
      incluirPdf: z.boolean().optional().describe('Incluir el PDF (copia controlada) en base64, si pesa hasta 4 MB (por defecto false).'),
    },
    async (args) =>
      deps.withAudit('sgc_download_document', args, async () => {
        const doc = await resolveDocument(args);
        if (!doc) return { result: null, rows: 0 };
        const currentNumber = num(doc.version_number);
        if (args.version !== undefined && args.version !== currentNumber) {
          throw new Error(`Solo se entrega la versión vigente (V${currentNumber}) de ${txt(doc.code)}. Las versiones anteriores se consultan en SynerLink (Calidad).`);
        }
        const size = num(doc.pdf_size);
        if (size > SGC_MAX_PDF_BYTES) {
          throw new Error(`El PDF pesa ${Math.round(size / 1024 / 1024)} MB y supera el tope de ${SGC_MAX_PDF_BYTES / 1024 / 1024} MB; ábralo en SynerLink (${synerlinkDocumentPath(num(doc.id_document))}).`);
        }
        const itemId = txt(doc.pdf_item_id);
        const expectedSha = txt(doc.pdf_sha256)?.toLowerCase();
        if (!itemId || !expectedSha) throw new Error('La versión vigente no tiene el PDF registrado.');

        const graph = deps.getGraphClient();
        if (!graph) throw new Error('MS Graph no está configurado en este MCP; no se puede descargar el PDF de OneDrive.');
        const original = new Uint8Array(await graph.downloadContent(itemId));
        if (original.byteLength > SGC_MAX_PDF_BYTES) {
          throw new Error(`El PDF supera el tope de ${SGC_MAX_PDF_BYTES / 1024 / 1024} MB; ábralo en SynerLink.`);
        }
        if (sha256Hex(original) !== expectedSha) {
          throw new Error('El archivo guardado no coincide con su huella registrada (SHA-256); no se entrega. Avise a Calidad.');
        }

        const wantText = args.incluirTexto !== false;
        const maxChars = args.maxCaracteres ?? SGC_TEXT_DEFAULT_CHARS;
        let text: { text: string; pages: number; truncated: boolean } | null = null;
        let textError: string | undefined;
        if (wantText) {
          try {
            text = await extractPdfText(original, maxChars);
          } catch (err) {
            textError = `No se pudo extraer el texto del PDF: ${(err as Error).message}`;
          }
        }

        let pdfBase64: string | null = null;
        let pdfNote: string | undefined;
        if (args.incluirPdf) {
          const stamped = await stampAgentCopy(original, {
            code: txt(doc.code) ?? '',
            versionNumber: currentNumber,
            agent: deps.scope.agent,
            at: new Date(),
            versionStatus: txt(doc.version_status) ?? 'vigente',
          });
          if (stamped.byteLength <= SGC_MAX_INLINE_PDF_BYTES) {
            pdfBase64 = Buffer.from(stamped).toString('base64');
          } else {
            pdfNote = `La copia pesa más de ${SGC_MAX_INLINE_PDF_BYTES / 1024 / 1024} MB y no se incluye en base64; use el texto o ábrala en SynerLink.`;
          }
        }

        const code = txt(doc.code) ?? 'documento';
        return {
          result: {
            id_document: num(doc.id_document),
            code,
            title: txt(doc.title),
            company: txt(doc.company),
            version_number: currentNumber,
            version_status: txt(doc.version_status),
            effective_date: day(doc.effective_date),
            review_due_date: day(doc.review_due_date),
            file_name: `${code} V${currentNumber} - copia controlada.pdf`,
            mime_type: 'application/pdf',
            size: original.byteLength,
            sha256_verified: true,
            text_included: text !== null,
            ...(text ? { pages: text.pages, text_truncated: text.truncated, text: text.text } : {}),
            ...(text && text.text.replace(/--- Página \d+ ---/g, '').trim().length === 0
              ? { text_note: 'El PDF no trae capa de texto (posiblemente escaneado); pida incluirPdf=true o ábralo en SynerLink.' }
              : {}),
            ...(textError ? { text_error: textError } : {}),
            pdf_included: pdfBase64 !== null,
            content_base64: pdfBase64,
            ...(pdfNote ? { pdf_note: pdfNote } : {}),
            synerlink_path: synerlinkDocumentPath(num(doc.id_document)),
            usage_note:
              'Copia controlada para consulta. Impresa o descargada fuera del sistema es copia no controlada: verifique siempre la vigencia en SynerLink.',
          },
          rows: 1,
        };
      })
  );

  // -------------------------------------------------------------------------
  // sgc_list_document_types
  // -------------------------------------------------------------------------
  server.tool(
    'sgc_list_document_types',
    'SOLO LECTURA. Lista los tipos documentales activos del SGC (código como «PR», «FO», nombre, meses de revisión y de alerta) de las empresas del alcance con el SGC activo, con cuántos documentos vigentes de confidencialidad pública tiene cada tipo.',
    { companyId: companyIdParam },
    async (args) =>
      deps.withAudit('sgc_list_document_types', args, async () => {
        const filter = effectiveCompanyFilter(deps.scope, args.companyId ?? null);
        const rows = await q<Record<string, unknown>>(Prisma.sql`
          SELECT dt.id_document_type, dt.id_company, c.company, dt.code, dt.name, dt.plural_name,
                 dt.review_months, dt.alert_months, dt.sort_order,
                 (SELECT COUNT(*) FROM sgc.document d
                   WHERE d.id_document_type = dt.id_document_type AND d.status = N'vigente'
                     AND d.confidentiality = N'publica' AND d.current_version_id IS NOT NULL) AS documents
          FROM sgc.document_type dt
          INNER JOIN sgc.company_config cc ON cc.id_company = dt.id_company
          INNER JOIN company c ON c.id_company = dt.id_company
          WHERE cc.is_active = 1 AND dt.is_active = 1 AND ${deps.companyClause('dt.id_company', filter)}
          ORDER BY c.company, dt.sort_order, dt.code`);
        return {
          result: {
            total: rows.length,
            types: rows.map((r) => ({
              id_document_type: num(r.id_document_type),
              id_company: num(r.id_company),
              company: txt(r.company),
              code: txt(r.code),
              name: txt(r.name),
              plural_name: txt(r.plural_name),
              review_months: num(r.review_months),
              alert_months: num(r.alert_months),
              documents: num(r.documents),
            })),
          },
          rows: rows.length,
        };
      })
  );

  // -------------------------------------------------------------------------
  // sgc_master_list
  // -------------------------------------------------------------------------
  server.tool(
    'sgc_master_list',
    `SOLO LECTURA. Listado maestro del SGC: todos los documentos vigentes de confidencialidad pública de una empresa (o de las del alcance), ordenados por tipo y código, en formato compacto (código, título, tipo, proceso, área, versión, fecha de emisión, próxima revisión y vigencia). Hasta ${SGC_MASTER_LIST_MAX} filas.`,
    { companyId: companyIdParam },
    async (args) =>
      deps.withAudit('sgc_master_list', args, async () => {
        const filter = effectiveCompanyFilter(deps.scope, args.companyId ?? null);
        const rows = await q<Record<string, unknown>>(Prisma.sql`
          SELECT TOP (${SGC_MASTER_LIST_MAX + 1}) ${DOC_COLUMNS}
          ${FROM_DOCS}
          WHERE ${VISIBLE} AND ${deps.companyClause('d.id_company', filter)}
          ORDER BY c.company, dt.sort_order, dt.code, d.code`);
        const truncated = rows.length > SGC_MASTER_LIST_MAX;
        const list = rows.slice(0, SGC_MASTER_LIST_MAX).map((r) => ({
          id_document: num(r.id_document),
          company: txt(r.company),
          code: txt(r.code),
          title: txt(r.title),
          type: txt(r.type_code),
          process: txt(r.process_name),
          area: txt(r.area),
          version: r.version_number == null ? null : num(r.version_number),
          effective_date: day(r.effective_date),
          review_due_date: day(r.review_due_date),
          vigencia: txt(r.vigencia),
        }));
        return {
          result: {
            total: list.length,
            truncated,
            documents: list,
            access_note: 'Solo documentos vigentes de confidencialidad pública; los de área o confidenciales se consultan en SynerLink.',
          },
          rows: list.length,
        };
      })
  );
}
