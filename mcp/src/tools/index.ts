/**
 * Registro de TODAS las tools de solo lectura del MCP de Kronos.
 *
 * Cada tool recibe el alcance (AuthScope) resuelto desde la API key y aplica
 * SIEMPRE el filtro de empresa. No existe ninguna tool de escritura/mutación.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthScope } from '../auth.js';
import { effectiveCompanyIds } from '../scope.js';
import { getPrisma, Prisma } from '../db.js';
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
 * Construye un fragmento SQL `IN (...)` seguro a partir de una lista de ids.
 * Si la lista está vacía, devuelve `1 = 0` (ninguna fila) — nunca abre el filtro.
 */
function companyInClause(column: string, ids: number[]): Prisma.Sql {
  if (ids.length === 0) {
    return Prisma.sql`1 = 0`;
  }
  return Prisma.sql`${Prisma.raw(column)} IN (${Prisma.join(ids)})`;
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

export function registerTools(server: McpServer, ctx: ToolContext): void {
  const prisma = getPrisma();

  // ---------------------------------------------------------------------------
  // kronos_metadata
  // ---------------------------------------------------------------------------
  server.tool(
    'kronos_metadata',
    'Describe las entidades y campos disponibles, y el alcance (empresas) de la API key actual. Solo lectura.',
    {},
    async () =>
      withAudit(ctx, 'kronos_metadata', {}, async () => ({
        result: {
          agent: ctx.scope.agent,
          role: ctx.scope.role,
          allowedCompanyIds: ctx.scope.companyIds,
          readOnly: true,
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
    'Lista solicitudes generales (workflows). Filtra SIEMPRE por las empresas del alcance. Paginada.',
    {
      companyId: z
        .number()
        .int()
        .optional()
        .describe('Empresa a consultar; se interseca con el alcance de la key.'),
      status: z.number().int().optional().describe('Filtra por id de estado (status_req).'),
      limit: z.number().int().optional(),
      offset: z.number().int().optional(),
    },
    async (args) =>
      withAudit(ctx, 'kronos_list_requests', args, async () => {
        const companies = effectiveCompanyIds(ctx.scope, args.companyId ?? null);
        const limit = clampLimit(ctx, args.limit);
        const offset = clampOffset(args.offset);

        const where: Prisma.Sql[] = [companyInClause('rg.id_company', companies)];
        if (args.status !== undefined) {
          where.push(Prisma.sql`rg.status_req = ${args.status}`);
        }
        const whereSql = Prisma.join(where, ' AND ');

        const rows = await prisma.$queryRaw<unknown[]>(Prisma.sql`
          SELECT rg.id, rg.subject_request AS subject, rg.[description],
                 rg.status_req AS id_status, sc.status AS status,
                 rg.id_company, c.company, u.name AS requester,
                 rg.created_at, rg.date_resolution, rg.resolution, rg.url
          FROM requests_general rg
          INNER JOIN company c ON c.id_company = rg.id_company
          LEFT JOIN status_case sc ON sc.id_status_case = rg.status_req
          LEFT JOIN [user] u ON u.id = rg.id_requester
          WHERE ${whereSql}
          ORDER BY rg.id DESC
          OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
        `);

        return { result: { count: rows.length, limit, offset, data: rows }, rows: rows.length };
      })
  );

  // ---------------------------------------------------------------------------
  // kronos_get_request
  // ---------------------------------------------------------------------------
  server.tool(
    'kronos_get_request',
    'Obtiene una solicitud por id. Solo la devuelve si pertenece a una empresa del alcance.',
    { id: z.number().int().describe('id de la solicitud (requests_general.id).') },
    async (args) =>
      withAudit(ctx, 'kronos_get_request', args, async () => {
        const companies = effectiveCompanyIds(ctx.scope, null);
        const rows = await prisma.$queryRaw<unknown[]>(Prisma.sql`
          SELECT rg.id, rg.subject_request AS subject, rg.[description],
                 rg.status_req AS id_status, sc.status AS status,
                 rg.id_company, c.company, u.name AS requester,
                 rg.created_at, rg.date_resolution, rg.resolution, rg.url
          FROM requests_general rg
          INNER JOIN company c ON c.id_company = rg.id_company
          LEFT JOIN status_case sc ON sc.id_status_case = rg.status_req
          LEFT JOIN [user] u ON u.id = rg.id_requester
          WHERE rg.id = ${args.id} AND ${companyInClause('rg.id_company', companies)}
        `);
        return { result: rows[0] ?? null, rows: rows.length };
      })
  );

  // ---------------------------------------------------------------------------
  // kronos_list_tickets  (case)
  // ---------------------------------------------------------------------------
  server.tool(
    'kronos_list_tickets',
    'Lista tickets/casos de mesa de ayuda. Filtra SIEMPRE por las empresas del alcance. Paginada.',
    {
      companyId: z.number().int().optional(),
      status: z.number().int().optional().describe('id_status_case'),
      priority: z.string().optional(),
      limit: z.number().int().optional(),
      offset: z.number().int().optional(),
    },
    async (args) =>
      withAudit(ctx, 'kronos_list_tickets', args, async () => {
        const companies = effectiveCompanyIds(ctx.scope, args.companyId ?? null);
        const limit = clampLimit(ctx, args.limit);
        const offset = clampOffset(args.offset);

        const where: Prisma.Sql[] = [companyInClause('c.company', companies)];
        if (args.status !== undefined) where.push(Prisma.sql`c.id_status_case = ${args.status}`);
        if (args.priority !== undefined) where.push(Prisma.sql`c.priority = ${args.priority}`);
        const whereSql = Prisma.join(where, ' AND ');

        const rows = await prisma.$queryRaw<unknown[]>(Prisma.sql`
          SELECT c.id_case, c.subject_case, c.[description], c.priority, c.case_type,
                 sc.status, d.department, c.requester, co.id_company, co.company,
                 c.creation_date, c.end_date, c.resolution, c.place
          FROM [case] c
          INNER JOIN status_case sc ON sc.id_status_case = c.id_status_case
          INNER JOIN department d ON d.id_department = c.id_department
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
        const companies = effectiveCompanyIds(ctx.scope, null);
        const rows = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
          SELECT c.id_case, c.subject_case, c.[description], c.priority, c.case_type,
                 sc.status, d.department, c.requester, co.id_company, co.company,
                 c.creation_date, c.end_date, c.resolution, c.place
          FROM [case] c
          INNER JOIN status_case sc ON sc.id_status_case = c.id_status_case
          INNER JOIN department d ON d.id_department = c.id_department
          LEFT JOIN company co ON co.id_company = c.company
          WHERE c.id_case = ${args.id} AND ${companyInClause('c.company', companies)}
        `);

        const ticket = rows[0] ?? null;
        if (!ticket) return { result: null, rows: 0 };

        // Notas asociadas (solo tras confirmar el alcance del caso).
        const notes = await prisma.$queryRaw<unknown[]>(Prisma.sql`
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
        const companies = effectiveCompanyIds(ctx.scope, args.companyId ?? null);
        const take = clampLimit(ctx, args.limit);
        const skip = clampOffset(args.offset);

        // Filtro de empresa vía relación companyUsers -> id_company.
        const data = await prisma.user.findMany({
          take,
          skip,
          where: { companyUsers: { some: { id_company: { in: companies } } } },
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
        const companies = effectiveCompanyIds(ctx.scope, args.companyId ?? null);
        const limit = clampLimit(ctx, args.limit);
        const offset = clampOffset(args.offset);
        const text = args.text ? `%${args.text}%` : null;
        const dateFrom = args.dateFrom ? new Date(args.dateFrom) : null;
        const dateTo = args.dateTo ? new Date(`${args.dateTo}T23:59:59`) : null;

        const out: Record<string, unknown> = {};

        if (args.entity === 'requests' || args.entity === 'all') {
          const where: Prisma.Sql[] = [companyInClause('rg.id_company', companies)];
          if (args.status !== undefined) where.push(Prisma.sql`rg.status_req = ${args.status}`);
          if (text)
            where.push(
              Prisma.sql`(rg.subject_request LIKE ${text} OR rg.[description] LIKE ${text})`
            );
          if (dateFrom) where.push(Prisma.sql`rg.created_at >= ${dateFrom}`);
          if (dateTo) where.push(Prisma.sql`rg.created_at <= ${dateTo}`);
          const whereSql = Prisma.join(where, ' AND ');
          out.requests = await prisma.$queryRaw<unknown[]>(Prisma.sql`
            SELECT rg.id, rg.subject_request AS subject, rg.status_req AS id_status,
                   rg.id_company, rg.created_at
            FROM requests_general rg
            WHERE ${whereSql}
            ORDER BY rg.id DESC
            OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
          `);
        }

        if (args.entity === 'tickets' || args.entity === 'all') {
          const where: Prisma.Sql[] = [companyInClause('c.company', companies)];
          if (args.status !== undefined) where.push(Prisma.sql`c.id_status_case = ${args.status}`);
          if (text)
            where.push(Prisma.sql`(c.subject_case LIKE ${text} OR c.[description] LIKE ${text})`);
          if (dateFrom) where.push(Prisma.sql`c.creation_date >= ${dateFrom}`);
          if (dateTo) where.push(Prisma.sql`c.creation_date <= ${dateTo}`);
          const whereSql = Prisma.join(where, ' AND ');
          out.tickets = await prisma.$queryRaw<unknown[]>(Prisma.sql`
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
}
