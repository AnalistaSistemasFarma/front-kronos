/**
 * Registro de TODAS las tools de solo lectura del MCP de Kronos.
 *
 * Cada tool recibe el alcance (AuthScope) resuelto desde la API key y aplica
 * SIEMPRE el filtro de empresa. No existe ninguna tool de escritura/mutación.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthScope } from '../auth.js';
import { effectiveCompanyFilter, type CompanyFilter } from '../scope.js';
import { getPrisma, Prisma, queryReadOnly } from '../db.js';
import { executeWrite, type TxClient } from '../write.js';
import type { AuditLogger } from '../audit.js';

interface ToolContext {
  scope: AuthScope;
  audit: AuditLogger;
  maxPageSize: number;
  defaultPageSize: number;
}

/** Campos del usuario que NUNCA se exponen. */
const USER_SAFE_SELECT = {
  id: true,
  name: true,
  email: true,
  isActive: true,
  role: true,
  phone: true,
  identification: true,
  createdAt: true,
  // EXCLUIDOS a propósito: password, emailVerified, accounts (tokens), sessions.
} as const;

function clampLimit(ctx: ToolContext, limit?: number): number {
  if (!limit || limit <= 0) return ctx.defaultPageSize;
  return Math.min(limit, ctx.maxPageSize);
}

function clampOffset(offset?: number): number {
  if (!offset || offset < 0) return 0;
  return offset;
}

/**
 * Cláusula EXISTS: la solicitud `rg` tiene al usuario dado como
 * ENCARGADO/responsable del proceso asignado (bridge
 * process_category_request_general -> user_process_category_request_general).
 */
function requestResponsibleExists(userId: string): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1
    FROM process_category_request_general pcrg
    INNER JOIN user_process_category_request_general upcrg
      ON upcrg.id_process_category = pcrg.id_process_category
    WHERE pcrg.id_request_general = rg.id AND upcrg.id_user = ${userId}
  )`;
}

/** Empaqueta un resultado como contenido MCP (texto JSON). */
function jsonResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

/** Helper que envuelve la ejecución de una tool con auditoría. */
async function withAudit<T>(
  ctx: ToolContext,
  tool: string,
  params: unknown,
  fn: () => Promise<{ result: unknown; rows?: number }>
): Promise<T> {
  try {
    const { result, rows } = await fn();
    await ctx.audit.log({
      ts: new Date().toISOString(),
      agent: ctx.scope.agent,
      role: ctx.scope.role,
      companyIds: ctx.scope.companyIds,
      tool,
      params,
      outcome: 'ok',
      rows,
    });
    return jsonResult(result) as T;
  } catch (err) {
    await ctx.audit.log({
      ts: new Date().toISOString(),
      agent: ctx.scope.agent,
      role: ctx.scope.role,
      companyIds: ctx.scope.companyIds,
      tool,
      params,
      outcome: 'error',
      error: (err as Error).message,
    });
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
    } as T;
  }
}

/**
 * Construye el fragmento SQL del filtro de empresa a partir de un CompanyFilter.
 *
 * - Admin sin acotar (`applyFilter: false`): devuelve `1 = 1` (ve TODO, sin
 *   restricción de empresa).
 * - Lista vacía (`applyFilter: true`, ids `[]`): devuelve `1 = 0` (ninguna
 *   fila) — nunca abre el filtro al pedir empresas fuera del alcance.
 * - Lista con ids: devuelve `<column> IN (...)`.
 */
function companyClause(column: string, filter: CompanyFilter): Prisma.Sql {
  if (!filter.applyFilter) {
    return Prisma.sql`1 = 1`;
  }
  if (filter.companyIds.length === 0) {
    return Prisma.sql`1 = 0`;
  }
  return Prisma.sql`${Prisma.raw(column)} IN (${Prisma.join(filter.companyIds)})`;
}

/**
 * Limpia espacios/saltos de línea sobrantes en las etiquetas de proceso y
 * categoría de una solicitud (los valores del catálogo suelen traer `\r\n`).
 */
function trimRequestLabels(row: Record<string, unknown>): void {
  for (const key of ['category', 'process'] as const) {
    if (typeof row[key] === 'string') row[key] = (row[key] as string).trim();
  }
}

export const ENTITY_METADATA = {
  requests: {
    description:
      'Solicitudes generales (workflows) de la tabla requests_general. Filtradas por id_company.',
    companyColumn: 'requests_general.id_company',
    fields: [
      'id',
      'subject',
      'description',
      'status',
      'category',
      'process',
      'requester',
      'company',
      'id_company',
      'created_at',
      'date_resolution',
      'resolution',
      'url',
    ],
  },
  tickets: {
    description:
      'Tickets / casos de mesa de ayuda (tabla case). Filtrados por case.company (id_company).',
    companyColumn: 'case.company',
    fields: [
      'id_case',
      'subject_case',
      'description',
      'status',
      'priority',
      'case_type',
      'department',
      'requester',
      'technician',
      'technician_id',
      'category',
      'subcategory',
      'activity',
      'company',
      'creation_date',
      'end_date',
      'resolution',
    ],
  },
  processes: {
    description: 'Catálogo de procesos y subprocesos (global, no segmentado por empresa).',
    companyColumn: null,
    fields: ['id_process', 'process', 'process_url', 'subprocesses'],
  },
  activities: {
    description: 'Catálogo de actividades (global).',
    companyColumn: null,
    fields: ['id_activity', 'activity', 'id_subcategory'],
  },
  departments: {
    description: 'Catálogo de departamentos (global).',
    companyColumn: null,
    fields: ['id_department', 'department'],
  },
  categories: {
    description: 'Catálogo de categorías y subcategorías (global).',
    companyColumn: null,
    fields: ['id_category', 'category', 'subcategories'],
  },
  users: {
    description:
      'Usuarios. Solo se devuelven los pertenecientes a las empresas del alcance. Campos sensibles excluidos (password, tokens).',
    companyColumn: 'company_user.id_company (vía relación)',
    fields: Object.keys(USER_SAFE_SELECT),
  },
} as const;

/**
 * Capacidades del servidor: 13 tools en total = 11 de LECTURA + 2 de ESCRITURA.
 *
 * Las de escritura están acotadas exclusivamente a CATEGORIZACIÓN (asignar la
 * categoría de un caso o el proceso de una solicitud), son transaccionales,
 * parametrizadas, validan alcance/coherencia y se auditan. NO debilitan el
 * candado de solo lectura del resto del servidor.
 */
export const TOOL_CAPABILITIES = {
  totalTools: 16,
  readOnly: [
    'kronos_metadata',
    'kronos_list_requests',
    'kronos_get_request',
    'kronos_list_request_notes',
    'kronos_list_tickets',
    'kronos_get_ticket',
    'kronos_list_processes',
    'kronos_list_process_categories',
    'kronos_list_activities',
    'kronos_list_departments',
    'kronos_list_categories',
    'kronos_list_users',
    'kronos_search',
  ],
  write: ['kronos_categorize_case', 'kronos_categorize_request', 'kronos_create_request'],
  writeNote:
    'El servidor tiene rutas de escritura acotadas: categorización (caso: category_case; solicitud: process_category_request_general) y creación de solicitudes (kronos_create_request: inserta requests_general + workflow + notificaciones). Todas transaccionales, parametrizadas, validadas por alcance de empresa y auditadas. El candado assertReadOnlySql sigue intacto para las 12 tools de lectura.',
} as const;

export function registerTools(server: McpServer, ctx: ToolContext): void {
  const prisma = getPrisma();

  // ---------------------------------------------------------------------------
  // kronos_metadata
  // ---------------------------------------------------------------------------
  server.tool(
    'kronos_metadata',
    'Describe las entidades y campos disponibles, el alcance (empresas) de la API key actual, y las capacidades del servidor (12 tools de lectura + 3 de escritura: 2 de categorización y 1 de creación de solicitudes).',
    {},
    async () =>
      withAudit(ctx, 'kronos_metadata', {}, async () => ({
        result: {
          agent: ctx.scope.agent,
          role: ctx.scope.role,
          allCompanies: ctx.scope.allCompanies,
          allowedCompanyIds: ctx.scope.allCompanies ? '*' : ctx.scope.companyIds,
          // El servidor ya no es 100% solo lectura: una sola ruta de escritura
          // acotada a categorización (ver capabilities.write).
          readOnly: false,
          capabilities: TOOL_CAPABILITIES,
          paging: { defaultPageSize: ctx.defaultPageSize, maxPageSize: ctx.maxPageSize },
          entities: ENTITY_METADATA,
        },
      }))
  );

  // ---------------------------------------------------------------------------
  // kronos_list_requests  (requests_general)
  // ---------------------------------------------------------------------------
  server.tool(
    'kronos_list_requests',
    'Lista solicitudes generales (workflows). Filtra SIEMPRE por las empresas del alcance. Permite filtrar por responsable (encargado del proceso) con responsibleUserId (user.id). Paginada.',
    {
      companyId: z
        .number()
        .int()
        .optional()
        .describe('Empresa a consultar; se interseca con el alcance de la key.'),
      status: z.number().int().optional().describe('Filtra por id de estado (status_req).'),
      responsibleUserId: z
        .string()
        .optional()
        .describe(
          'Filtra solicitudes donde este usuario (user.id) es ENCARGADO/responsable del proceso asignado a la solicitud.'
        ),
      limit: z.number().int().optional(),
      offset: z.number().int().optional(),
    },
    async (args) =>
      withAudit(ctx, 'kronos_list_requests', args, async () => {
        const filter = effectiveCompanyFilter(ctx.scope, args.companyId ?? null);
        const limit = clampLimit(ctx, args.limit);
        const offset = clampOffset(args.offset);

        const where: Prisma.Sql[] = [companyClause('rg.id_company', filter)];
        if (args.status !== undefined) {
          where.push(Prisma.sql`rg.status_req = ${args.status}`);
        }
        if (args.responsibleUserId !== undefined) {
          where.push(requestResponsibleExists(args.responsibleUserId));
        }
        const whereSql = Prisma.join(where, ' AND ');

        const rows = await queryReadOnly<Record<string, unknown>>(Prisma.sql`
          SELECT rg.id, rg.subject_request AS subject, rg.[description],
                 rg.status_req AS id_status, sc.status AS status,
                 cr.category AS category, pc.process AS process,
                 rg.id_company, c.company, u.name AS requester,
                 rg.created_at, rg.date_resolution, rg.resolution, rg.url
          FROM requests_general rg
          INNER JOIN company c ON c.id_company = rg.id_company
          LEFT JOIN status_case sc ON sc.id_status_case = rg.status_req
          LEFT JOIN [user] u ON u.id = rg.id_requester
          LEFT JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
          LEFT JOIN process_category pc ON pc.id = pcrg.id_process_category
          LEFT JOIN category_request cr ON cr.id = pc.id_category_request
          WHERE ${whereSql}
          ORDER BY rg.id DESC
          OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
        `);

        for (const r of rows) trimRequestLabels(r);
        return { result: { count: rows.length, limit, offset, data: rows }, rows: rows.length };
      })
  );

  // ---------------------------------------------------------------------------
  // kronos_get_request
  // ---------------------------------------------------------------------------
  server.tool(
    'kronos_get_request',
    'Obtiene una solicitud por id, con sus notas/seguimientos y las tareas del workflow (con tiempos). Solo la devuelve si pertenece a una empresa del alcance.',
    { id: z.number().int().describe('id de la solicitud (requests_general.id).') },
    async (args) =>
      withAudit(ctx, 'kronos_get_request', args, async () => {
        const filter = effectiveCompanyFilter(ctx.scope, null);
        const rows = await queryReadOnly<Record<string, unknown>>(Prisma.sql`
          SELECT rg.id, rg.subject_request AS subject, rg.[description],
                 rg.status_req AS id_status, sc.status AS status,
                 cr.category AS category, pc.process AS process,
                 rg.id_company, c.company, u.name AS requester,
                 rg.created_at, rg.date_resolution, rg.resolution, rg.url
          FROM requests_general rg
          INNER JOIN company c ON c.id_company = rg.id_company
          LEFT JOIN status_case sc ON sc.id_status_case = rg.status_req
          LEFT JOIN [user] u ON u.id = rg.id_requester
          LEFT JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
          LEFT JOIN process_category pc ON pc.id = pcrg.id_process_category
          LEFT JOIN category_request cr ON cr.id = pc.id_category_request
          WHERE rg.id = ${args.id} AND ${companyClause('rg.id_company', filter)}
        `);

        const request = rows[0] ?? null;
        if (!request) return { result: null, rows: 0 };
        trimRequestLabels(request);

        // Notas/seguimientos de la solicitud (solo tras confirmar el alcance).
        const notes = await queryReadOnly<unknown>(Prisma.sql`
          SELECT n.id_note, n.note, u.name AS createdBy, n.creation_date
          FROM notes n
          LEFT JOIN [user] u ON u.id = n.created_by
          WHERE n.id_request = ${args.id}
          ORDER BY n.id_note DESC
        `);

        // Tareas del workflow de la solicitud, con sus tiempos.
        const tasks = await queryReadOnly<unknown>(Prisma.sql`
          SELECT trg.id, trg.id_task, tpc.task AS task, trg.id_status,
                 sc.status, trg.id_assigned, u.name AS assignedTo,
                 trg.start_date, trg.end_date, trg.date_resolution, trg.resolution
          FROM task_request_general trg
          LEFT JOIN task_process_category tpc ON tpc.id = trg.id_task
          LEFT JOIN status_case sc ON sc.id_status_case = trg.id_status
          LEFT JOIN [user] u ON u.id = trg.id_assigned
          WHERE trg.id_request_general = ${args.id}
          ORDER BY trg.id ASC
        `);
        return { result: { ...request, notes, tasks }, rows: 1 };
      })
  );

  // ---------------------------------------------------------------------------
  // kronos_list_request_notes  (vista vw_notas_solicitudes)
  // ---------------------------------------------------------------------------
  server.tool(
    'kronos_list_request_notes',
    'Lista notas/seguimientos de solicitudes desde la vista vw_notas_solicitudes, de forma eficiente y paginada (pensada para consultar TODAS las notas sin pedir solicitud por solicitud). Filtra SIEMPRE por las empresas del alcance. Permite acotar por solicitud (requestId) y empresa (companyId).',
    {
      requestId: z
        .number()
        .int()
        .optional()
        .describe('Acota a las notas de una solicitud (vw_notas_solicitudes.ID_Solicitud).'),
      companyId: z
        .number()
        .int()
        .optional()
        .describe('Empresa a consultar; se interseca con el alcance de la key.'),
      limit: z.number().int().optional(),
      offset: z.number().int().optional(),
    },
    async (args) =>
      withAudit(ctx, 'kronos_list_request_notes', args, async () => {
        const filter = effectiveCompanyFilter(ctx.scope, args.companyId ?? null);
        const limit = clampLimit(ctx, args.limit);
        const offset = clampOffset(args.offset);

        // El alcance por empresa se aplica ligando la nota con su solicitud
        // mediante la columna ID_Solicitud de la vista.
        const where: Prisma.Sql[] = [companyClause('rg.id_company', filter)];
        if (args.requestId !== undefined) {
          where.push(Prisma.sql`vn.ID_Solicitud = ${args.requestId}`);
        }
        const whereSql = Prisma.join(where, ' AND ');

        const rows = await queryReadOnly<unknown>(Prisma.sql`
          SELECT vn.id_note, vn.ID_Solicitud AS id_request, vn.Nota AS note,
                 vn.Creador_Nota AS createdBy, vn.Fecha_Nota AS creationDate,
                 rg.id_company, c.company
          FROM vw_notas_solicitudes vn
          INNER JOIN requests_general rg ON rg.id = vn.ID_Solicitud
          INNER JOIN company c ON c.id_company = rg.id_company
          WHERE ${whereSql}
          ORDER BY vn.ID_Solicitud DESC, vn.id_note DESC
          OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
        `);
        return { result: { count: rows.length, limit, offset, data: rows }, rows: rows.length };
      })
  );

  // ---------------------------------------------------------------------------
  // kronos_list_tickets  (case)
  // ---------------------------------------------------------------------------
  server.tool(
    'kronos_list_tickets',
    'Lista tickets/casos de mesa de ayuda. Filtra SIEMPRE por las empresas del alcance. Permite filtrar por técnico/responsable asignado con technicianId y expone las columnas "technician"/"technician_id". Paginada.',
    {
      companyId: z.number().int().optional(),
      status: z.number().int().optional().describe('id_status_case'),
      priority: z.string().optional(),
      technicianId: z
        .string()
        .optional()
        .describe('Filtra casos donde este usuario (user.id) es el TÉCNICO/responsable asignado.'),
      limit: z.number().int().optional(),
      offset: z.number().int().optional(),
    },
    async (args) =>
      withAudit(ctx, 'kronos_list_tickets', args, async () => {
        const filter = effectiveCompanyFilter(ctx.scope, args.companyId ?? null);
        const limit = clampLimit(ctx, args.limit);
        const offset = clampOffset(args.offset);

        const where: Prisma.Sql[] = [companyClause('c.company', filter)];
        if (args.status !== undefined) where.push(Prisma.sql`c.id_status_case = ${args.status}`);
        if (args.priority !== undefined) where.push(Prisma.sql`c.priority = ${args.priority}`);
        if (args.technicianId !== undefined) where.push(Prisma.sql`ut.id = ${args.technicianId}`);
        const whereSql = Prisma.join(where, ' AND ');

        const rows = await queryReadOnly<unknown>(Prisma.sql`
          SELECT c.id_case, c.subject_case, c.[description], c.priority, c.case_type,
                 sc.status, d.department, c.requester, ut.name AS technician, ut.id AS technician_id,
                 co.id_company, co.company,
                 c.creation_date, c.end_date, c.resolution, c.place
          FROM [case] c
          INNER JOIN status_case sc ON sc.id_status_case = c.id_status_case
          INNER JOIN department d ON d.id_department = c.id_department
          LEFT JOIN subprocess_user_company suc ON suc.id_subprocess_user_company = c.id_technical
          LEFT JOIN company_user cu ON cu.id_company_user = suc.id_company_user
          LEFT JOIN [user] ut ON ut.id = cu.id_user
          LEFT JOIN company co ON co.id_company = c.company
          WHERE ${whereSql}
          ORDER BY c.id_case DESC
          OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
        `);
        return { result: { count: rows.length, limit, offset, data: rows }, rows: rows.length };
      })
  );

  // ---------------------------------------------------------------------------
  // kronos_get_ticket
  // ---------------------------------------------------------------------------
  server.tool(
    'kronos_get_ticket',
    'Obtiene un ticket/caso por id, con sus categorías y notas. Solo si pertenece al alcance.',
    { id: z.number().int().describe('id_case') },
    async (args) =>
      withAudit(ctx, 'kronos_get_ticket', args, async () => {
        const filter = effectiveCompanyFilter(ctx.scope, null);
        const rows = await queryReadOnly<Record<string, unknown>>(Prisma.sql`
          SELECT c.id_case, c.subject_case, c.[description], c.priority, c.case_type,
                 sc.status, d.department, c.requester, ut.name AS technician, ut.id AS technician_id,
                 co.id_company, co.company,
                 c.creation_date, c.end_date, c.resolution, c.place
          FROM [case] c
          INNER JOIN status_case sc ON sc.id_status_case = c.id_status_case
          INNER JOIN department d ON d.id_department = c.id_department
          LEFT JOIN subprocess_user_company suc ON suc.id_subprocess_user_company = c.id_technical
          LEFT JOIN company_user cu ON cu.id_company_user = suc.id_company_user
          LEFT JOIN [user] ut ON ut.id = cu.id_user
          LEFT JOIN company co ON co.id_company = c.company
          WHERE c.id_case = ${args.id} AND ${companyClause('c.company', filter)}
        `);

        const ticket = rows[0] ?? null;
        if (!ticket) return { result: null, rows: 0 };

        // Notas asociadas (solo tras confirmar el alcance del caso).
        const notes = await queryReadOnly<unknown>(Prisma.sql`
          SELECT n.id_note, n.note FROM notes n WHERE n.id_case = ${args.id} ORDER BY n.id_note DESC
        `);
        return { result: { ...ticket, notes }, rows: 1 };
      })
  );

  // ---------------------------------------------------------------------------
  // kronos_list_processes  (catálogo global, Prisma)
  // ---------------------------------------------------------------------------
  server.tool(
    'kronos_list_processes',
    'Lista procesos y sus subprocesos (catálogo global). Paginada.',
    { limit: z.number().int().optional(), offset: z.number().int().optional() },
    async (args) =>
      withAudit(ctx, 'kronos_list_processes', args, async () => {
        const take = clampLimit(ctx, args.limit);
        const skip = clampOffset(args.offset);
        const data = await prisma.process.findMany({
          take,
          skip,
          orderBy: { id_process: 'asc' },
          include: {
            subprocesses: {
              select: { id_subprocess: true, subprocess: true, subprocess_url: true },
            },
          },
        });
        return { result: { count: data.length, limit: take, offset: skip, data }, rows: data.length };
      })
  );

  // ---------------------------------------------------------------------------
  // kronos_list_activities
  // ---------------------------------------------------------------------------
  server.tool(
    'kronos_list_activities',
    'Lista actividades (catálogo global). Paginada.',
    { limit: z.number().int().optional(), offset: z.number().int().optional() },
    async (args) =>
      withAudit(ctx, 'kronos_list_activities', args, async () => {
        const take = clampLimit(ctx, args.limit);
        const skip = clampOffset(args.offset);
        const data = await prisma.activity.findMany({
          take,
          skip,
          orderBy: { id_activity: 'asc' },
          select: { id_activity: true, activity: true, id_subcategory: true },
        });
        return { result: { count: data.length, limit: take, offset: skip, data }, rows: data.length };
      })
  );

  // ---------------------------------------------------------------------------
  // kronos_list_departments
  // ---------------------------------------------------------------------------
  server.tool(
    'kronos_list_departments',
    'Lista departamentos (catálogo global).',
    { limit: z.number().int().optional(), offset: z.number().int().optional() },
    async (args) =>
      withAudit(ctx, 'kronos_list_departments', args, async () => {
        const take = clampLimit(ctx, args.limit);
        const skip = clampOffset(args.offset);
        const data = await prisma.department.findMany({
          take,
          skip,
          orderBy: { department: 'asc' },
        });
        return { result: { count: data.length, limit: take, offset: skip, data }, rows: data.length };
      })
  );

  // ---------------------------------------------------------------------------
  // kronos_list_categories
  // ---------------------------------------------------------------------------
  server.tool(
    'kronos_list_categories',
    'Lista categorías y subcategorías (catálogo global).',
    { limit: z.number().int().optional(), offset: z.number().int().optional() },
    async (args) =>
      withAudit(ctx, 'kronos_list_categories', args, async () => {
        const take = clampLimit(ctx, args.limit);
        const skip = clampOffset(args.offset);
        const data = await prisma.category.findMany({
          take,
          skip,
          orderBy: { category: 'asc' },
          include: {
            subcategories: { select: { id_subcategory: true, subcategory: true } },
          },
        });
        return { result: { count: data.length, limit: take, offset: skip, data }, rows: data.length };
      })
  );

  // ---------------------------------------------------------------------------
  // kronos_list_process_categories  (catálogo de workflows de solicitudes)
  // ---------------------------------------------------------------------------
  server.tool(
    'kronos_list_process_categories',
    'Lista las CATEGORÍAS DE PROCESO (workflows) de solicitudes, con su descripción de qué hace cada una. Filtra por las empresas del alcance. Úsala para ASESORAR sobre qué proceso elegir y para obtener el id_process_category válido al crear una solicitud con kronos_create_request.',
    {
      companyId: z.number().int().optional().describe('Empresa a acotar; se interseca con el alcance de la key.'),
      onlyActive: z.boolean().optional().describe('Si es true, solo procesos activos (pc.active = 1).'),
      limit: z.number().int().optional(),
      offset: z.number().int().optional(),
    },
    async (args) =>
      withAudit(ctx, 'kronos_list_process_categories', args, async () => {
        const take = clampLimit(ctx, args.limit);
        const skip = clampOffset(args.offset);
        const filter = effectiveCompanyFilter(ctx.scope, args.companyId ?? null);
        const activeClause = args.onlyActive ? Prisma.sql`AND pc.active = 1` : Prisma.empty;
        const data = await queryReadOnly<unknown>(Prisma.sql`
          SELECT pc.id AS id_process_category, pc.process AS name, pc.description,
                 pc.active, ccr.id_company, co.company
          FROM process_category pc
          INNER JOIN company_category_request ccr ON ccr.id_category_request = pc.id_category_request
          INNER JOIN company co ON co.id_company = ccr.id_company
          WHERE ${companyClause('ccr.id_company', filter)} ${activeClause}
          ORDER BY co.company, pc.process
          OFFSET ${skip} ROWS FETCH NEXT ${take} ROWS ONLY
        `);
        return { result: { count: data.length, limit: take, offset: skip, data }, rows: data.length };
      })
  );

  // ---------------------------------------------------------------------------
  // kronos_list_users  (filtrados por empresa, sin campos sensibles)
  // ---------------------------------------------------------------------------
  server.tool(
    'kronos_list_users',
    'Lista usuarios de las empresas del alcance. Excluye password y tokens. Paginada.',
    {
      companyId: z.number().int().optional(),
      limit: z.number().int().optional(),
      offset: z.number().int().optional(),
    },
    async (args) =>
      withAudit(ctx, 'kronos_list_users', args, async () => {
        const filter = effectiveCompanyFilter(ctx.scope, args.companyId ?? null);
        const take = clampLimit(ctx, args.limit);
        const skip = clampOffset(args.offset);

        // Filtro de empresa vía relación companyUsers -> id_company. Para keys
        // admin sin acotar (applyFilter=false) NO se restringe por empresa.
        const where = filter.applyFilter
          ? { companyUsers: { some: { id_company: { in: filter.companyIds } } } }
          : {};
        const data = await prisma.user.findMany({
          take,
          skip,
          where,
          select: USER_SAFE_SELECT,
          orderBy: { name: 'asc' },
        });
        return { result: { count: data.length, limit: take, offset: skip, data }, rows: data.length };
      })
  );

  // ---------------------------------------------------------------------------
  // kronos_search  (solicitudes + tickets, con texto/fechas/estado)
  // ---------------------------------------------------------------------------
  server.tool(
    'kronos_search',
    'Búsqueda paginada sobre solicitudes y/o tickets con filtros de texto, fechas y estado. Siempre dentro del alcance de empresa de la key.',
    {
      entity: z
        .enum(['requests', 'tickets', 'all'])
        .default('all')
        .describe('Qué buscar: solicitudes, tickets o ambos.'),
      text: z.string().optional().describe('Texto a buscar en asunto/descripción.'),
      companyId: z.number().int().optional(),
      status: z.number().int().optional(),
      dateFrom: z.string().optional().describe('Fecha inicial YYYY-MM-DD (created_at/creation_date).'),
      dateTo: z.string().optional().describe('Fecha final YYYY-MM-DD.'),
      limit: z.number().int().optional(),
      offset: z.number().int().optional(),
    },
    async (args) =>
      withAudit(ctx, 'kronos_search', args, async () => {
        const filter = effectiveCompanyFilter(ctx.scope, args.companyId ?? null);
        const limit = clampLimit(ctx, args.limit);
        const offset = clampOffset(args.offset);
        const text = args.text ? `%${args.text}%` : null;
        const dateFrom = args.dateFrom ? new Date(args.dateFrom) : null;
        const dateTo = args.dateTo ? new Date(`${args.dateTo}T23:59:59`) : null;

        const out: Record<string, unknown> = {};

        if (args.entity === 'requests' || args.entity === 'all') {
          const where: Prisma.Sql[] = [companyClause('rg.id_company', filter)];
          if (args.status !== undefined) where.push(Prisma.sql`rg.status_req = ${args.status}`);
          if (text)
            where.push(
              Prisma.sql`(rg.subject_request LIKE ${text} OR rg.[description] LIKE ${text})`
            );
          if (dateFrom) where.push(Prisma.sql`rg.created_at >= ${dateFrom}`);
          if (dateTo) where.push(Prisma.sql`rg.created_at <= ${dateTo}`);
          const whereSql = Prisma.join(where, ' AND ');
          out.requests = await queryReadOnly<unknown>(Prisma.sql`
            SELECT rg.id, rg.subject_request AS subject, rg.status_req AS id_status,
                   rg.id_company, rg.created_at
            FROM requests_general rg
            WHERE ${whereSql}
            ORDER BY rg.id DESC
            OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
          `);
        }

        if (args.entity === 'tickets' || args.entity === 'all') {
          const where: Prisma.Sql[] = [companyClause('c.company', filter)];
          if (args.status !== undefined) where.push(Prisma.sql`c.id_status_case = ${args.status}`);
          if (text)
            where.push(Prisma.sql`(c.subject_case LIKE ${text} OR c.[description] LIKE ${text})`);
          if (dateFrom) where.push(Prisma.sql`c.creation_date >= ${dateFrom}`);
          if (dateTo) where.push(Prisma.sql`c.creation_date <= ${dateTo}`);
          const whereSql = Prisma.join(where, ' AND ');
          out.tickets = await queryReadOnly<unknown>(Prisma.sql`
            SELECT c.id_case, c.subject_case AS subject, c.id_status_case AS id_status,
                   c.company AS id_company, c.creation_date
            FROM [case] c
            WHERE ${whereSql}
            ORDER BY c.id_case DESC
            OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
          `);
        }

        const rows =
          ((out.requests as unknown[] | undefined)?.length ?? 0) +
          ((out.tickets as unknown[] | undefined)?.length ?? 0);
        return { result: { limit, offset, ...out }, rows };
      })
  );

  // ===========================================================================
  // TOOLS DE ESCRITURA (categorización) — camino separado, transaccional y
  // parametrizado. NO pasan por el candado de solo lectura (queryReadOnly):
  // usan executeWrite (src/write.ts), exclusivo de estas dos tools. El resto
  // del servidor sigue en solo lectura.
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // kronos_categorize_case  (ESCRITURA) — tabla puente category_case
  // ---------------------------------------------------------------------------
  server.tool(
    'kronos_categorize_case',
    'ESCRITURA. Asigna/recategoriza la terna (categoría, subcategoría, actividad) de un caso de mesa de ayuda en la tabla puente category_case. Solo afecta casos del alcance de empresa de la key. Valida que la terna sea jerárquicamente coherente. Transaccional y auditada.',
    {
      id_case: z.number().int().describe('id_case del caso a categorizar.'),
      id_category: z.number().int().describe('id_category (raíz de la terna).'),
      id_subcategory: z.number().int().describe('id_subcategory (debe colgar de id_category).'),
      id_activity: z.number().int().describe('id_activity (debe colgar de id_subcategory).'),
      companyId: z
        .number()
        .int()
        .optional()
        .describe('Empresa a acotar; se interseca con el alcance de la key.'),
    },
    async (args) =>
      withAudit(ctx, 'kronos_categorize_case', args, async () => {
        const filter = effectiveCompanyFilter(ctx.scope, args.companyId ?? null);
        const scopeClause = companyClause('c.company', filter);

        const result = await executeWrite(async (tx: TxClient) => {
          // a. El caso existe y pertenece al alcance. Si no, error genérico
          //    (no se confirma existencia fuera de alcance — regla de oro).
          const inScope = await tx.$queryRaw<{ ok: number }[]>(Prisma.sql`
            SELECT TOP 1 1 AS ok
            FROM [case] c
            WHERE c.id_case = ${args.id_case} AND ${scopeClause}
          `);
          if (inScope.length === 0) {
            throw new Error('caso inexistente o fuera de alcance');
          }

          // b. La terna categoría/subcategoría/actividad es coherente.
          const coherent = await tx.$queryRaw<{ ok: number }[]>(Prisma.sql`
            SELECT TOP 1 1 AS ok
            FROM activity a
            INNER JOIN subcategory s ON s.id_subcategory = a.id_subcategory
            WHERE a.id_activity = ${args.id_activity}
              AND a.id_subcategory = ${args.id_subcategory}
              AND s.id_category = ${args.id_category}
          `);
          if (coherent.length === 0) {
            throw new Error('terna categoría/subcategoría/actividad inconsistente');
          }

          // c. UPSERT en la tabla puente (1:1 con el caso).
          const updated = await tx.$executeRaw(Prisma.sql`
            UPDATE category_case
            SET id_category = ${args.id_category},
                id_subcategory = ${args.id_subcategory},
                id_activity = ${args.id_activity}
            WHERE id_case = ${args.id_case}
          `);
          let action: 'updated' | 'inserted' = 'updated';
          if (updated === 0) {
            await tx.$executeRaw(Prisma.sql`
              INSERT INTO category_case (id_case, id_category, id_subcategory, id_activity)
              VALUES (${args.id_case}, ${args.id_category}, ${args.id_subcategory}, ${args.id_activity})
            `);
            action = 'inserted';
          }

          // d. Resolver nombres (barato) para una respuesta clara.
          const names = await tx.$queryRaw<
            { category: string | null; subcategory: string | null; activity: string | null }[]
          >(Prisma.sql`
            SELECT cat.category, s.subcategory, a.activity
            FROM activity a
            INNER JOIN subcategory s ON s.id_subcategory = a.id_subcategory
            INNER JOIN category cat ON cat.id_category = s.id_category
            WHERE a.id_activity = ${args.id_activity}
              AND a.id_subcategory = ${args.id_subcategory}
              AND cat.id_category = ${args.id_category}
          `);

          return {
            id_case: args.id_case,
            action,
            rowsAffected: action === 'updated' ? updated : 1,
            category: { id_category: args.id_category, name: names[0]?.category ?? null },
            subcategory: {
              id_subcategory: args.id_subcategory,
              name: names[0]?.subcategory ?? null,
            },
            activity: { id_activity: args.id_activity, name: names[0]?.activity ?? null },
          };
        });

        return { result, rows: 1 };
      })
  );

  // ---------------------------------------------------------------------------
  // kronos_categorize_request  (ESCRITURA) — process_category_request_general
  // ---------------------------------------------------------------------------
  server.tool(
    'kronos_categorize_request',
    'ESCRITURA. Asigna/recategoriza el PROCESO (process_category) de una solicitud general en la tabla puente process_category_request_general. Solo afecta solicitudes del alcance de empresa de la key. Valida que el proceso esté activo y habilitado para la empresa de la solicitud. Transaccional y auditada.',
    {
      id_request: z.number().int().describe('requests_general.id de la solicitud a categorizar.'),
      id_process_category: z
        .number()
        .int()
        .describe('process_category.id del proceso a asignar (debe estar activo y habilitado para la empresa).'),
      companyId: z
        .number()
        .int()
        .optional()
        .describe('Empresa a acotar; se interseca con el alcance de la key.'),
    },
    async (args) =>
      withAudit(ctx, 'kronos_categorize_request', args, async () => {
        const filter = effectiveCompanyFilter(ctx.scope, args.companyId ?? null);
        const scopeClause = companyClause('rg.id_company', filter);

        const result = await executeWrite(async (tx: TxClient) => {
          // a. La solicitud existe y pertenece al alcance. Resolvemos su empresa
          //    para validar la habilitación del proceso contra esa empresa.
          const reqRow = await tx.$queryRaw<{ id_company: number }[]>(Prisma.sql`
            SELECT TOP 1 rg.id_company
            FROM requests_general rg
            WHERE rg.id = ${args.id_request} AND ${scopeClause}
          `);
          const idCompany = reqRow[0]?.id_company;
          if (idCompany === undefined) {
            throw new Error('solicitud inexistente o fuera de alcance');
          }

          // b. El proceso existe, está activo y su category_request está
          //    habilitada para la empresa de la solicitud.
          const okProcess = await tx.$queryRaw<{ ok: number }[]>(Prisma.sql`
            SELECT TOP 1 1 AS ok
            FROM process_category pc
            INNER JOIN company_category_request ccr
              ON ccr.id_category_request = pc.id_category_request
            WHERE pc.id = ${args.id_process_category}
              AND pc.active = 1
              AND ccr.id_company = ${idCompany}
          `);
          if (okProcess.length === 0) {
            throw new Error('proceso inexistente, inactivo o no habilitado para la empresa');
          }

          // c. UPSERT en la tabla puente (1:1 con la solicitud).
          const updated = await tx.$executeRaw(Prisma.sql`
            UPDATE process_category_request_general
            SET id_process_category = ${args.id_process_category}
            WHERE id_request_general = ${args.id_request}
          `);
          let action: 'updated' | 'inserted' = 'updated';
          if (updated === 0) {
            await tx.$executeRaw(Prisma.sql`
              INSERT INTO process_category_request_general (id_request_general, id_process_category)
              VALUES (${args.id_request}, ${args.id_process_category})
            `);
            action = 'inserted';
          }

          // Sincronización opcional de la columna legacy del row (best-effort,
          // dentro de la misma transacción), igual que hace parcialmente la app.
          await tx.$executeRaw(Prisma.sql`
            UPDATE requests_general
            SET id_process_category = ${args.id_process_category}
            WHERE id = ${args.id_request}
          `);

          // d. Nombre del proceso para una respuesta clara.
          const names = await tx.$queryRaw<{ process_category: string | null }[]>(Prisma.sql`
            SELECT pc.process_category
            FROM process_category pc
            WHERE pc.id = ${args.id_process_category}
          `);

          return {
            id_request: args.id_request,
            id_company: idCompany,
            action,
            rowsAffected: action === 'updated' ? updated : 1,
            process: {
              id_process_category: args.id_process_category,
              name: names[0]?.process_category ?? null,
            },
          };
        });

        return { result, rows: 1 };
      })
  );

  // ---------------------------------------------------------------------------
  // kronos_create_request  (ESCRITURA) — crea una solicitud + workflow + notifs
  // ---------------------------------------------------------------------------
  server.tool(
    'kronos_create_request',
    'ESCRITURA. Crea una nueva solicitud en SynerLink: inserta en requests_general, la vincula a su categoría de proceso, instancia automáticamente las tareas del workflow y registra notificaciones (en la app) para el responsable del proceso y los asignados. Acotada a las empresas del alcance de la key. Valida empresa, proceso (activo y habilitado para la empresa) y solicitante. Transaccional y auditada. Use kronos_list_process_categories para el id_process_category y kronos_list_users para el solicitante.',
    {
      companyId: z.number().int().describe('id_company de la empresa de la solicitud (debe estar en el alcance de la key).'),
      subject: z.string().min(1).describe('Asunto de la solicitud (subject_request).'),
      description: z.string().min(1).describe('Descripción de la solicitud.'),
      requesterUserId: z.string().min(1).describe('id del usuario solicitante (user.id). Resuélvalo con kronos_list_users.'),
      id_process_category: z.number().int().describe('process_category.id del proceso al que pertenece (kronos_list_process_categories).'),
      url: z.string().optional().describe('URL opcional asociada a la solicitud.'),
    },
    async (args) =>
      withAudit(ctx, 'kronos_create_request', args, async () => {
        const filter = effectiveCompanyFilter(ctx.scope, args.companyId);
        const result = await executeWrite(async (tx: TxClient) => {
          // 1. La empresa existe y está en el alcance de la key.
          const okCompany = await tx.$queryRaw<{ ok: number }[]>(Prisma.sql`
            SELECT TOP 1 1 AS ok
            FROM company c
            WHERE c.id_company = ${args.companyId} AND ${companyClause('c.id_company', filter)}
          `);
          if (okCompany.length === 0) {
            throw new Error('empresa inexistente o fuera de alcance');
          }

          // 2. El proceso existe, está activo y está habilitado para la empresa.
          const okProcess = await tx.$queryRaw<{ ok: number }[]>(Prisma.sql`
            SELECT TOP 1 1 AS ok
            FROM process_category pc
            INNER JOIN company_category_request ccr
              ON ccr.id_category_request = pc.id_category_request
            WHERE pc.id = ${args.id_process_category}
              AND pc.active = 1
              AND ccr.id_company = ${args.companyId}
          `);
          if (okProcess.length === 0) {
            throw new Error('proceso inexistente, inactivo o no habilitado para la empresa');
          }

          // 3. El solicitante existe.
          const okUser = await tx.$queryRaw<{ ok: number }[]>(Prisma.sql`
            SELECT TOP 1 1 AS ok FROM [user] u WHERE u.id = ${args.requesterUserId}
          `);
          if (okUser.length === 0) {
            throw new Error('usuario solicitante inexistente');
          }

          // 4. Insertar la solicitud (status_req = 1 = Abierto).
          const inserted = await tx.$queryRaw<{ id: number }[]>(Prisma.sql`
            INSERT INTO requests_general (description, subject_request, id_company, id_requester, status_req, url)
            OUTPUT INSERTED.id
            VALUES (${args.description}, ${args.subject}, ${args.companyId}, ${args.requesterUserId}, 1, ${args.url ?? null})
          `);
          const newRow = inserted[0];
          if (!newRow) {
            throw new Error('no se pudo crear la solicitud');
          }
          const newId = newRow.id;

          // 5. Vincular la solicitud a su categoría de proceso.
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO process_category_request_general (id_request_general, id_process_category)
            VALUES (${newId}, ${args.id_process_category})
          `);

          // 6. Instanciar las tareas del workflow (id_status = 4 = Sin Empezar).
          const tasks = await tx.$queryRaw<{ id_task: number; id_user: string; email: string | null }[]>(Prisma.sql`
            SELECT tpc.id AS id_task, utrg.id_user, u.email
            FROM user_task_request_general utrg
            INNER JOIN task_process_category tpc ON tpc.id = utrg.id_task
            INNER JOIN [user] u ON u.id = utrg.id_user
            WHERE tpc.id_process_category = ${args.id_process_category}
          `);
          for (const t of tasks) {
            await tx.$executeRaw(Prisma.sql`
              INSERT INTO task_request_general (id_request_general, id_task, id_status, id_assigned)
              VALUES (${newId}, ${t.id_task}, 4, ${t.id_user})
            `);
          }

          // 7. Correos: responsable del proceso + asignados de las tareas.
          const procUsers = await tx.$queryRaw<{ email: string | null }[]>(Prisma.sql`
            SELECT u.email
            FROM user_process_category_request_general upcrg
            INNER JOIN [user] u ON u.id = upcrg.id_user
            WHERE upcrg.id_process_category = ${args.id_process_category}
          `);
          const processEmail = procUsers[0]?.email ?? null;
          const taskEmails = Array.from(
            new Set(tasks.map((t) => t.email).filter((e): e is string => Boolean(e)))
          );

          // 8. Notificaciones en la app (tabla notifications), igual que notifyNewRequest.
          //    Nota: el push del navegador (web-push) lo envía la SPA; aquí se
          //    persiste la notificación en BD (campana), que es la parte durable.
          const viewUrl =
            args.url && args.url.trim()
              ? args.url.trim()
              : `/process/request-general/view-request?id=${newId}&from=general-requests`;
          const activitiesUrl = `/process/request-general/view-activities?id=${newId}&from=assigned-activities`;
          const processList = processEmail ? [processEmail] : [];
          const taskList = taskEmails.filter((e) => !processList.includes(e));

          for (const email of processList) {
            await tx.$executeRaw(Prisma.sql`
              INSERT INTO notifications (email, title, body, url)
              VALUES (${email}, ${'Nueva solicitud · SynerLink'}, ${`#${newId} — ${args.subject}`}, ${viewUrl})
            `);
          }
          for (const email of taskList) {
            await tx.$executeRaw(Prisma.sql`
              INSERT INTO notifications (email, title, body, url)
              VALUES (${email}, ${'Actividad asignada · SynerLink'}, ${`Tienes una actividad en la solicitud #${newId} — ${args.subject}`}, ${activitiesUrl})
            `);
          }

          return {
            id_request: newId,
            id_company: args.companyId,
            id_process_category: args.id_process_category,
            requester: args.requesterUserId,
            tasksCreated: tasks.length,
            notified: { processEmail, taskEmails },
          };
        });
        return { result, rows: 1 };
      })
  );
}
