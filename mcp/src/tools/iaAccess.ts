/**
 * kronos_request_ia_access (ESCRITURA acotada)
 *
 * Radica una "Solicitud de conectores para agentes IA" A NOMBRE de la persona
 * que le escribe al agente. Pensada para keys restringidas de agentes (OLP,
 * Unidossis) cuya lista blanca SOLO incluye esta herramienta.
 *
 * Reglas (decididas por Nicolás Rivera, 2026-10-09):
 *  - El agente lo identifica la KEY (agentCode); el cliente solo envía el correo
 *    de quien escribe y la descripción. Nunca escoge el agente.
 *  - La empresa se DEDUCE del permiso de la persona sobre el agente
 *    (subprocess_user_company del subproceso del agente, en empresas a las que
 *    el agente pertenece — agent_company —, dentro del alcance de la key):
 *      0 empresas  -> rechazo.
 *      1 empresa   -> esa.
 *      >1          -> devuelve la lista para que el agente pregunte; solo se
 *                     acepta un companyId de ESA lista.
 *    GSS nunca es candidata.
 *  - El proceso es el de la empresa: el proceso activo con nombre
 *    IA_ACCESS_PROCESS_NAME habilitado para la empresa (prod: UNIDOSSIS 249,
 *    OLP el duplicado). Se resuelve por nombre porque los ids difieren entre
 *    pruebas y producción.
 *  - Tope: 3 solicitudes por persona, por día y por agente. Sin duplicados:
 *    si la persona ya tiene una abierta del mismo sistema, se devuelve su número.
 *  - Las tareas se crean IGUAL que la app (ver src/workflow.ts).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthScope } from '../auth.js';
import type { AuditLogger } from '../audit.js';
import { Prisma } from '../db.js';
import { executeWrite, type TxClient } from '../write.js';
import {
  instantiateInitialTasks,
  insertNewRequestNotifications,
  processOwnerEmails,
} from '../workflow.js';

export const IA_ACCESS_TOOL = 'kronos_request_ia_access';
export const IA_ACCESS_PROCESS_NAME =
  process.env.MCP_IA_ACCESS_PROCESS_NAME?.trim() || 'Solicitud de conectores para agentes IA';
export const IA_ACCESS_DAILY_LIMIT = 3;
/** Empresa que nunca es candidata (comparación por nombre: el id difiere por entorno). */
const EXCLUDED_COMPANY_NAMES = new Set(['GSS']);

interface Ctx {
  scope: AuthScope;
  audit: AuditLogger;
}

export interface IaAccessArgs {
  requesterEmail: string;
  sistema: string;
  para_que: string;
  datos: string;
  solo_lectura?: boolean;
  companyId?: number;
}

export type IaAccessResult =
  | {
      status: 'creada';
      id_request: number;
      empresa: { id_company: number; company: string };
      id_process_category: number;
      solicitante: { email: string; name: string | null };
      tareas_creadas: { tarea: string | null; responsable: string | null; email: string | null }[];
      siguiente_paso: string;
    }
  | {
      status: 'elegir_empresa';
      empresas: { companyId: number; empresa: string }[];
      siguiente_paso: string;
    }
  | { status: 'duplicada'; id_request: number; siguiente_paso: string };

/** Error de negocio: se devuelve al agente como rechazo (isError) con mensaje claro. */
export class IaAccessRejection extends Error {}

export function normalizeSistema(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extrae el valor de la línea "Sistema: ..." de una descripción radicada por esta herramienta. */
export function parseSistemaLine(description: string | null | undefined): string | null {
  if (!description) return null;
  const m = /^Sistema:\s*(.+)$/m.exec(description);
  return m && m[1] ? normalizeSistema(m[1]) : null;
}

export function agentMarker(agentCode: string): string {
  return `[agente:${agentCode.toLowerCase()}]`;
}

function clean(s: string): string {
  return s.replace(/\r\n?/g, '\n').trim();
}

/** requests_general.description es NVARCHAR(1000) (la app la envía con ese tamaño). */
export const DESCRIPTION_MAX = 1000;

function shorten(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

export function buildDescription(o: {
  sistema: string;
  para_que: string;
  datos: string;
  solo_lectura?: boolean;
  agentName: string;
  agentCode: string;
  requesterEmail: string;
}): string {
  const acceso =
    o.solo_lectura === undefined ? 'No indicado' : o.solo_lectura ? 'Solo lectura' : 'Lectura y escritura';
  const build = (paraQue: string, datos: string) =>
    [
      'Solicitud de conector para agente IA',
      `Sistema: ${clean(o.sistema).replace(/\n+/g, ' ')}`,
      `Para qué: ${paraQue}`,
      `Datos que necesita: ${datos}`,
      `Acceso: ${acceso}`,
      `Agente: ${o.agentName}`,
      `Radicada por el agente ${o.agentName} a pedido de ${o.requesterEmail}. ${agentMarker(o.agentCode)}`,
    ].join('\n');
  let paraQue = clean(o.para_que);
  let datos = clean(o.datos);
  let text = build(paraQue, datos);
  // Si no cabe, se recortan los textos libres (nunca el sistema ni la marca del agente).
  while (text.length > DESCRIPTION_MAX && (paraQue.length > 20 || datos.length > 20)) {
    const over = text.length - DESCRIPTION_MAX;
    if (datos.length >= paraQue.length) datos = shorten(datos, Math.max(20, datos.length - over));
    else paraQue = shorten(paraQue, Math.max(20, paraQue.length - over));
    text = build(paraQue, datos);
  }
  return text;
}

/**
 * Lógica completa dentro de UNA transacción. Lanza IaAccessRejection para los
 * rechazos de negocio (rollback: nada se persiste).
 */
export async function requestIaAccess(
  tx: TxClient,
  scope: AuthScope,
  args: IaAccessArgs
): Promise<IaAccessResult> {
  const agentCode = scope.agentCode?.trim().toLowerCase();
  if (!agentCode) {
    throw new IaAccessRejection('esta llave no identifica a un agente (falta agentCode); no puede radicar solicitudes');
  }
  const email = args.requesterEmail.trim().toLowerCase();

  // 1. El agente de la llave.
  const agents = await tx.$queryRaw<
    { id_agent: number; code: string; display_name: string; id_subprocess: number | null }[]
  >(Prisma.sql`
    SELECT TOP 1 a.id_agent, a.code, a.display_name, a.id_subprocess
    FROM agent a
    WHERE LOWER(a.code) = ${agentCode} AND a.is_active = 1
  `);
  const agent = agents[0];
  if (!agent || agent.id_subprocess == null) {
    throw new IaAccessRejection(`el agente "${agentCode}" no existe, está inactivo o no tiene permiso asignable en SynerLink`);
  }

  // 2. La persona.
  const users = await tx.$queryRaw<{ id: string; name: string | null; email: string; isActive: boolean | number | null }[]>(
    Prisma.sql`
      SELECT u.id, u.name, u.email, u.isActive
      FROM [user] u
      WHERE LOWER(LTRIM(RTRIM(u.email))) = ${email}
    `
  );
  if (users.length === 0) {
    throw new IaAccessRejection(`no existe un usuario de SynerLink con el correo ${email}`);
  }
  if (users.length > 1) {
    throw new IaAccessRejection(`hay más de un usuario con el correo ${email}; debe revisarlo un administrador`);
  }
  const user = users[0]!;
  if (user.isActive === false || user.isActive === 0) {
    throw new IaAccessRejection(`el usuario ${email} está inactivo en SynerLink`);
  }

  // 3. Empresas donde la persona tiene ESTE agente asignado (y el agente pertenece).
  const grants = await tx.$queryRaw<{ id_company: number; company: string }[]>(Prisma.sql`
    SELECT DISTINCT c.id_company, c.company
    FROM subprocess_user_company suc
    INNER JOIN company_user cu ON cu.id_company_user = suc.id_company_user
    INNER JOIN company c ON c.id_company = cu.id_company
    INNER JOIN agent_company ac ON ac.id_company = cu.id_company AND ac.id_agent = ${agent.id_agent}
    WHERE cu.id_user = ${user.id} AND suc.id_subprocess = ${agent.id_subprocess}
  `);
  let candidates = grants
    .map((g) => ({ id_company: Number(g.id_company), company: String(g.company ?? '').trim() }))
    .filter((g) => !EXCLUDED_COMPANY_NAMES.has(g.company.toUpperCase()));
  if (!scope.allCompanies) {
    const allowed = new Set(scope.companyIds);
    candidates = candidates.filter((g) => allowed.has(g.id_company));
  }
  if (candidates.length === 0) {
    throw new IaAccessRejection(
      `${email} no tiene asignado el agente ${agent.display_name} en ninguna empresa habilitada; no se radicó nada`
    );
  }

  // 4. Proceso de cada empresa candidata (por nombre; exactamente uno).
  const procRows = await tx.$queryRaw<{ id: number; id_company: number }[]>(Prisma.sql`
    SELECT pc.id, ccr.id_company
    FROM process_category pc
    INNER JOIN company_category_request ccr ON ccr.id_category_request = pc.id_category_request
    WHERE pc.active = 1
      AND LTRIM(RTRIM(pc.process)) = ${IA_ACCESS_PROCESS_NAME}
      AND ccr.id_company IN (${Prisma.join(candidates.map((c) => c.id_company))})
  `);
  const procByCompany = new Map<number, number[]>();
  for (const r of procRows) {
    const list = procByCompany.get(Number(r.id_company)) ?? [];
    if (!list.includes(Number(r.id))) list.push(Number(r.id));
    procByCompany.set(Number(r.id_company), list);
  }
  const eligible = candidates.filter((c) => (procByCompany.get(c.id_company) ?? []).length === 1);
  if (eligible.length === 0) {
    throw new IaAccessRejection(
      `la empresa de ${email} (${candidates.map((c) => c.company).join(', ')}) no tiene configurado el proceso "${IA_ACCESS_PROCESS_NAME}"`
    );
  }

  // 5. Elegir empresa.
  let company: { id_company: number; company: string };
  if (args.companyId !== undefined && args.companyId !== null) {
    const chosen = eligible.find((c) => c.id_company === args.companyId);
    if (!chosen) {
      throw new IaAccessRejection(
        `la empresa ${args.companyId} no está entre las permitidas para ${email} con este agente: ${eligible
          .map((c) => `${c.id_company} (${c.company})`)
          .join(', ')}`
      );
    }
    company = chosen;
  } else if (eligible.length === 1) {
    company = eligible[0]!;
  } else {
    return {
      status: 'elegir_empresa',
      empresas: eligible.map((c) => ({ companyId: c.id_company, empresa: c.company })),
      siguiente_paso:
        'La persona tiene el agente en varias empresas. Pregúntele en cuál radicar y vuelva a llamar con companyId de esta lista.',
    };
  }
  const processId = procByCompany.get(company.id_company)![0]!;

  // 6. Serializar por persona (tope y duplicado consistentes ante llamadas simultáneas).
  await tx.$executeRaw(Prisma.sql`
    DECLARE @r int;
    EXEC @r = sp_getapplock @Resource = ${`kronos-ia-access:${user.id}`}, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000;
    IF @r < 0 THROW 50010, 'ocupado', 1;
  `);

  // 7. Duplicado abierto del mismo sistema y tope diario por agente.
  const previous = await tx.$queryRaw<
    { id: number; description: string | null; status_req: number | null; is_today: number }[]
  >(Prisma.sql`
    SELECT rg.id, rg.description, rg.status_req,
           CASE WHEN CAST(rg.created_at AS date) = CAST(GETDATE() AS date) THEN 1 ELSE 0 END AS is_today
    FROM requests_general rg
    INNER JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
    INNER JOIN process_category pc ON pc.id = pcrg.id_process_category
    WHERE rg.id_requester = ${user.id}
      AND LTRIM(RTRIM(pc.process)) = ${IA_ACCESS_PROCESS_NAME}
      AND (ISNULL(rg.status_req, 1) NOT IN (2, 3) OR CAST(rg.created_at AS date) = CAST(GETDATE() AS date))
    ORDER BY rg.id DESC
  `);
  const wanted = normalizeSistema(args.sistema);
  const dup = previous.find(
    (p) => ![2, 3].includes(Number(p.status_req ?? 1)) && parseSistemaLine(p.description) === wanted
  );
  if (dup) {
    return {
      status: 'duplicada',
      id_request: Number(dup.id),
      siguiente_paso: `${email} ya tiene abierta la solicitud #${dup.id} para "${args.sistema.trim()}". No se creó otra; puede seguirla en SynerLink.`,
    };
  }
  const marker = agentMarker(agent.code);
  const todayByAgent = previous.filter((p) => Number(p.is_today) === 1 && (p.description ?? '').includes(marker));
  if (todayByAgent.length >= IA_ACCESS_DAILY_LIMIT) {
    throw new IaAccessRejection(
      `${email} ya radicó ${todayByAgent.length} solicitudes hoy con el agente ${agent.display_name} (tope ${IA_ACCESS_DAILY_LIMIT} por día); intente mañana o pida ayuda a soporte`
    );
  }

  // 8. Crear la solicitud a nombre de la persona (mismas columnas que la app).
  const subject = `Conector IA: ${clean(args.sistema)}`.slice(0, 255);
  const description = buildDescription({
    sistema: args.sistema,
    para_que: args.para_que,
    datos: args.datos,
    solo_lectura: args.solo_lectura,
    agentName: agent.display_name,
    agentCode: agent.code,
    requesterEmail: email,
  });
  const inserted = await tx.$queryRaw<{ id: number }[]>(Prisma.sql`
    INSERT INTO requests_general (description, subject_request, id_company, id_requester, status_req, url)
    OUTPUT INSERTED.id
    VALUES (${description}, ${subject}, ${company.id_company}, ${user.id}, 1, ${null})
  `);
  const newId = inserted[0]?.id;
  if (!newId) throw new Error('no se pudo crear la solicitud');

  await tx.$executeRaw(Prisma.sql`
    INSERT INTO process_category_request_general (id_request_general, id_process_category)
    VALUES (${newId}, ${processId})
  `);

  const created = await instantiateInitialTasks(tx, newId, processId);
  const processEmails = await processOwnerEmails(tx, processId);
  await insertNewRequestNotifications(tx, {
    requestId: newId,
    subject,
    creatorEmail: email,
    processEmails,
    taskEmails: created.map((t) => t.email).filter((e): e is string => Boolean(e)),
  });

  const first = created[0];
  const siguiente = first
    ? `Siguiente paso: "${first.task ?? 'primera tarea'}" a cargo de ${first.name ?? first.email ?? 'el pool de autorizadores'}${
        first.email ? ` (${first.email})` : ''
      }.`
    : 'Siguiente paso: el encargado del proceso revisará la solicitud.';
  return {
    status: 'creada',
    id_request: newId,
    empresa: company,
    id_process_category: processId,
    solicitante: { email, name: user.name ?? null },
    tareas_creadas: created.map((t) => ({ tarea: t.task, responsable: t.name, email: t.email })),
    siguiente_paso: `Solicitud #${newId} radicada en ${company.company} a nombre de ${user.name ?? email}. ${siguiente}`,
  };
}

export function registerIaAccessTool(server: McpServer, ctx: Ctx): void {
  server.tool(
    IA_ACCESS_TOOL,
    'ESCRITURA acotada. Radica en SynerLink una "Solicitud de conectores para agentes IA" A NOMBRE de la persona que le escribe al agente. Envíe SOLO el correo de esa persona y la descripción (sistema, para qué, datos, si es solo lectura). La empresa la deduce el servidor del permiso de la persona sobre este agente: si tiene varias, responde status "elegir_empresa" con la lista y usted vuelve a llamar con companyId de esa lista. Si ya existe una abierta del mismo sistema responde status "duplicada" con su número. Tope 3 por persona por día. Devuelve el número de solicitud y el siguiente paso.',
    {
      requesterEmail: z.string().email().max(255).describe('Correo de la persona que le está escribiendo (la solicitud queda a su nombre).'),
      sistema: z.string().min(2).max(120).describe('Sistema o fuente a conectar (p. ej. "SAP Business One", "SharePoint de Calidad").'),
      para_que: z.string().min(5).max(350).describe('Para qué lo necesita (objetivo de negocio).'),
      datos: z.string().min(2).max(350).describe('Qué datos o módulos necesita consultar/usar.'),
      solo_lectura: z.boolean().optional().describe('true si basta con lectura; false si necesita escribir. Omítalo si la persona no lo sabe.'),
      companyId: z.number().int().positive().optional().describe('Solo si el servidor respondió "elegir_empresa": id de la lista que escogió la persona.'),
    },
    async (args) => {
      const base = {
        ts: new Date().toISOString(),
        agent: ctx.scope.agent,
        role: ctx.scope.role,
        companyIds: ctx.scope.companyIds,
        tool: IA_ACCESS_TOOL,
        params: args,
      };
      try {
        const result = await executeWrite((tx) => requestIaAccess(tx, ctx.scope, args));
        await ctx.audit.log({ ...base, outcome: 'ok', rows: result.status === 'creada' ? 1 : 0 });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const rejected = err instanceof IaAccessRejection;
        await ctx.audit.log({ ...base, outcome: rejected ? 'denied' : 'error', error: (err as Error).message });
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: rejected
                ? `Rechazada: ${(err as Error).message}`
                : `Error: no se pudo radicar la solicitud (${(err as Error).message})`,
            },
          ],
        };
      }
    }
  );
}
