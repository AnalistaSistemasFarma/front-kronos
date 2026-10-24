/**
 * Administración de usuarios de SynerLink por agente (2026-10-22, solicitud #6283,
 * tarea #7541; autorizó Cristian Baldión «crear y consultar en KRONOSDB» y Nicolás
 * Rivera «de una»). Dos herramientas, habilitadas SOLO para las llaves que traen el
 * bloque `usuarios` en MCP_API_KEYS (hoy: el agente de Nicolás Rojas):
 *
 *  - kronos_usuarios_consultar (LECTURA): busca usuarios por nombre, correo o empresa.
 *    Devuelve nombre, correo, activo, rol, empresas, departamentos y agentes del chat.
 *    NUNCA devuelve hash de contraseña, tokens, sesiones, teléfono, identificación ni NIT.
 *  - kronos_usuarios_crear (ESCRITURA acotada): crea un usuario igual que la app
 *    (POST /api/users: Prisma con id cuid, bcryptjs costo 12, rol `user`, fila CREATE en
 *    user_audit_log) y le asigna empresa, departamentos y subprocesos de la lista blanca
 *    de la llave.
 *
 * Candados de kronos_usuarios_crear:
 *  - Solo rol `user` (cualquier otro rol se rechaza; no existe forma de pedir admin).
 *  - La persona que ordena (solicitante) debe estar en `usuarios.solicitantes` de la llave
 *    y ser un usuario activo de SynerLink.
 *  - Correo con formato válido, de un dominio permitido, que no exista ya, y (si
 *    `exigirEntra`) habilitado y con licencia en Entra.
 *  - Empresa, departamentos y subprocesos SOLO de la lista blanca de la llave. Además,
 *    sin importar la configuración, NUNCA se asignan: administración (usuarios,
 *    inicios de sesión, flujos de trabajo), el módulo Chat y sus agentes, la auditoría de
 *    agentes ni los permisos de agentes en Proyectos.
 *  - Tope de creaciones por hora y por día, contado en user_audit_log (sobrevive reinicios).
 *  - Contraseña inicial única (aleatoria, crypto) que se devuelve UNA sola vez; nunca se
 *    registra en logs ni en la auditoría.
 *  - Todo dentro de UNA transacción (src/write.ts) y SQL parametrizado (Prisma.sql).
 */
import { randomInt } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { AuditLogger } from '../audit.js';
import type { AuthScope } from '../auth.js';
import type { UsuariosConfig } from '../config.js';
import { Prisma, queryReadOnly } from '../db.js';
import { GraphClient, loadGraphConfig } from '../graph.js';
import { executeWrite, type TxClient } from '../write.js';

export const USUARIOS_CONSULTAR_TOOL = 'kronos_usuarios_consultar';
export const USUARIOS_CREAR_TOOL = 'kronos_usuarios_crear';
export const USUARIOS_TOOLS = [USUARIOS_CONSULTAR_TOOL, USUARIOS_CREAR_TOOL] as const;

export const USUARIOS_MAX_RESULTADOS = 25;
/** Costo de bcrypt de la app (app/api/users/route.ts). */
export const BCRYPT_COSTO = 12;
/** Rol único permitido. */
export const ROL_PERMITIDO = 'user';

/**
 * Subprocesos que NUNCA se asignan por esta vía, aunque alguien los ponga en la lista
 * blanca de la llave. Se comparan por URL (los ids difieren entre pruebas y producción).
 */
export const SUBPROCESOS_PROHIBIDOS_URL: RegExp[] = [
  /^\/process\/administration(\/|$)/i, // Usuarios (12), inicios de sesión, etc.
  /^\/process\/chat(\/|$)/i, // módulo Chat, agentes, auditoría de agentes, Personas
  /^\/process\/proyectos\/permisos-agentes(\/|$)/i,
  /^\/process\/request-general\/admin-workflow(\/|$)/i,
  /\/admin(istration)?([-/]|$)/i,
  /\/auditoria(\/|$)/i,
];
/** Defensa adicional por nombre del subproceso. */
const SUBPROCESOS_PROHIBIDOS_NOMBRE = /(auditor[ií]a|usuarios|permisos de agentes|asistente )/i;

export class UsuariosRechazo extends Error {}

interface Ctx {
  scope: AuthScope;
  audit: AuditLogger;
  /** Verificación en Entra (pruebas: una simulada). */
  entra?: VerificadorEntra | null;
}

export type VerificadorEntra = (
  email: string
) => Promise<{ displayName: string | null; accountEnabled: boolean; licencias: number } | null>;

function verificadorPorDefecto(): VerificadorEntra | null {
  const cfg = loadGraphConfig();
  if (!cfg) return null;
  const graph = new GraphClient(cfg);
  return (email) => graph.getDirectoryUser(email);
}

const EMAIL_RE = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function normalizarCorreo(email: string): string {
  return email.trim().toLowerCase();
}

/** Escapa los comodines de LIKE de SQL Server. */
export function escaparLike(s: string): string {
  return s.replace(/[[\]%_]/g, (c) => `[${c}]`);
}

/** Contraseña inicial única: Syn-XXXX-XXXX* (sin caracteres ambiguos), 14 caracteres. */
export function generarContrasena(): string {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bloque = () => Array.from({ length: 4 }, () => a[randomInt(a.length)]).join('');
  return `Syn-${bloque()}-${bloque()}*`;
}

export function subprocesoProhibido(s: { subprocess_url: string | null; subprocess: string | null; es_agente: number | boolean }): boolean {
  if (s.es_agente === true || s.es_agente === 1) return true;
  const url = (s.subprocess_url ?? '').trim();
  if (SUBPROCESOS_PROHIBIDOS_URL.some((re) => re.test(url))) return true;
  return SUBPROCESOS_PROHIBIDOS_NOMBRE.test(s.subprocess ?? '');
}

function configDe(scope: AuthScope): UsuariosConfig {
  if (!scope.usuarios || !scope.agentCode) {
    throw new UsuariosRechazo('Esta llave no tiene permiso de administración de usuarios.');
  }
  return scope.usuarios;
}

function marcaAgente(scope: AuthScope): string {
  return `agente:${String(scope.agentCode).toLowerCase()} (kronos-mcp)`;
}

// ---------------------------------------------------------------------------
// Consultar (solo lectura)
// ---------------------------------------------------------------------------

export interface ConsultarArgs {
  texto?: string;
  email?: string;
  companyId?: number;
  limite?: number;
}

export async function consultarUsuarios(scope: AuthScope, args: ConsultarArgs) {
  const cfg = configDe(scope);
  const texto = args.texto?.trim();
  const email = args.email ? normalizarCorreo(args.email) : undefined;
  if (!texto && !email && !args.companyId) {
    throw new UsuariosRechazo('Indique al menos un criterio: texto (nombre o correo), email o companyId.');
  }
  if (args.companyId && !cfg.companyIds.includes(args.companyId)) {
    throw new UsuariosRechazo(`La empresa ${args.companyId} está fuera del alcance de esta llave.`);
  }
  const limite = Math.min(Math.max(args.limite ?? 10, 1), USUARIOS_MAX_RESULTADOS);
  const empresas = Prisma.join(cfg.companyIds);

  const filtros: Prisma.Sql[] = [];
  if (texto) {
    const t = `%${escaparLike(texto)}%`;
    filtros.push(Prisma.sql`(u.name LIKE ${t} OR u.email LIKE ${t})`);
  }
  if (email) filtros.push(Prisma.sql`LOWER(LTRIM(RTRIM(u.email))) = ${email}`);
  if (args.companyId) {
    filtros.push(
      Prisma.sql`EXISTS (SELECT 1 FROM company_user cf WHERE cf.id_user = u.id AND cf.id_company = ${args.companyId})`
    );
  }
  // Alcance: usuarios con alguna empresa de la llave, o sin ninguna (cuentas a medio crear).
  filtros.push(Prisma.sql`(EXISTS (SELECT 1 FROM company_user cs WHERE cs.id_user = u.id AND cs.id_company IN (${empresas}))
      OR NOT EXISTS (SELECT 1 FROM company_user cn WHERE cn.id_user = u.id))`);

  // Columnas EXPLÍCITAS: nunca password, emailVerified, phone, identification, nit, tokens.
  const usuarios = await queryReadOnly<{
    id: string;
    name: string | null;
    email: string;
    isActive: boolean;
    role: string;
    createdAt: Date;
  }>(Prisma.sql`
    SELECT TOP (${limite}) u.id, u.name, u.email, u.isActive, u.role, u.createdAt
    FROM [user] u
    WHERE ${Prisma.join(filtros, ' AND ')}
    ORDER BY u.name
  `);
  if (usuarios.length === 0) return { total: 0, usuarios: [] };

  const ids = Prisma.join(usuarios.map((u) => u.id));
  const [emp, dep, ag] = await Promise.all([
    queryReadOnly<{ id_user: string; id_company: number; company: string }>(Prisma.sql`
      SELECT DISTINCT cu.id_user, c.id_company, c.company
      FROM company_user cu INNER JOIN company c ON c.id_company = cu.id_company
      WHERE cu.id_user IN (${ids})
    `),
    queryReadOnly<{ id_user: string; id_department: number; department: string }>(Prisma.sql`
      SELECT du.id_user, d.id_department, d.department
      FROM department_user du INNER JOIN department d ON d.id_department = du.id_department
      WHERE du.id_user IN (${ids})
    `),
    // Misma regla que lib/chat/access.ts: el agente pertenece a la empresa (agent_company)
    // y la persona tiene el subproceso del agente en esa empresa.
    queryReadOnly<{ id_user: string; code: string; display_name: string; company: string }>(Prisma.sql`
      SELECT DISTINCT cu.id_user, a.code, a.display_name, c.company
      FROM agent a
      INNER JOIN agent_company ac ON ac.id_agent = a.id_agent
      INNER JOIN company c ON c.id_company = ac.id_company
      INNER JOIN company_user cu ON cu.id_company = ac.id_company
      INNER JOIN subprocess_user_company suc ON suc.id_company_user = cu.id_company_user AND suc.id_subprocess = a.id_subprocess
      WHERE a.is_active = 1 AND cu.id_user IN (${ids}) AND ac.id_company IN (${empresas})
    `),
  ]);

  const enAlcance = new Set(cfg.companyIds);
  return {
    total: usuarios.length,
    usuarios: usuarios.map((u) => {
      const suyas = emp.filter((e) => e.id_user === u.id);
      return {
        id: u.id,
        nombre: u.name,
        correo: u.email,
        activo: Boolean(u.isActive),
        rol: u.role,
        creado: u.createdAt,
        empresas: suyas.filter((e) => enAlcance.has(e.id_company)).map((e) => ({ id: e.id_company, empresa: e.company })),
        otras_empresas_fuera_de_alcance: suyas.filter((e) => !enAlcance.has(e.id_company)).length,
        departamentos: dep.filter((d) => d.id_user === u.id).map((d) => ({ id: d.id_department, departamento: d.department })),
        agentes: ag.filter((a) => a.id_user === u.id).map((a) => ({ codigo: a.code, nombre: a.display_name, empresa: a.company })),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Crear (escritura acotada)
// ---------------------------------------------------------------------------

export interface CrearArgs {
  solicitanteEmail: string;
  nombre: string;
  email: string;
  companyId: number;
  departmentIds?: number[];
  subprocessIds?: number[];
  rol?: string;
}

export interface CrearDeps {
  entra?: VerificadorEntra | null;
  /** Inyectables para pruebas. */
  generar?: () => string;
  hash?: (pw: string) => Promise<string>;
}

/** Validaciones que no tocan la base (lista blanca de la llave). */
export function validarSolicitudCreacion(scope: AuthScope, args: CrearArgs) {
  const cfg = configDe(scope);
  const rol = (args.rol ?? ROL_PERMITIDO).trim().toLowerCase();
  if (rol !== ROL_PERMITIDO) {
    throw new UsuariosRechazo(`Solo se pueden crear usuarios con rol "${ROL_PERMITIDO}". El rol "${args.rol}" no está permitido.`);
  }
  const solicitante = normalizarCorreo(args.solicitanteEmail);
  if (!cfg.solicitantes.map(normalizarCorreo).includes(solicitante)) {
    throw new UsuariosRechazo('La persona que lo pide no está autorizada para ordenar creaciones de usuarios con este agente.');
  }
  const email = normalizarCorreo(args.email);
  if (!EMAIL_RE.test(email) || email.length > 255) {
    throw new UsuariosRechazo(`El correo "${args.email}" no tiene un formato válido.`);
  }
  const dominio = email.split('@')[1] ?? '';
  if (!cfg.dominios.map((d) => d.toLowerCase()).includes(dominio)) {
    throw new UsuariosRechazo(`El dominio "${dominio}" no está permitido. Permitidos: ${cfg.dominios.join(', ')}.`);
  }
  const nombre = args.nombre.replace(/\s+/g, ' ').trim();
  if (nombre.length < 5 || nombre.length > 120 || !/^[\p{L}][\p{L}' .-]+$/u.test(nombre) || !nombre.includes(' ')) {
    throw new UsuariosRechazo('El nombre debe ser el nombre completo de la persona (nombre y apellido, solo letras).');
  }
  if (!cfg.companyIds.includes(args.companyId)) {
    throw new UsuariosRechazo(`La empresa ${args.companyId} no está en la lista permitida de esta llave.`);
  }
  const departmentIds = [...new Set(args.departmentIds ?? [])];
  const fueraDep = departmentIds.filter((d) => !cfg.departmentIds.includes(d));
  if (fueraDep.length) {
    throw new UsuariosRechazo(`Departamentos no permitidos para esta llave: ${fueraDep.join(', ')}.`);
  }
  const subprocessIds = [...new Set(args.subprocessIds ?? [])];
  const fueraSub = subprocessIds.filter((s) => !cfg.subprocessIds.includes(s));
  if (fueraSub.length) {
    throw new UsuariosRechazo(`Subprocesos no permitidos para esta llave: ${fueraSub.join(', ')}.`);
  }
  return { cfg, solicitante, email, nombre, departmentIds, subprocessIds };
}

export type CrearResultado = {
  status: 'creado';
  usuario: {
    id: string;
    nombre: string;
    correo: string;
    rol: string;
    empresa: { id: number; empresa: string };
    departamentos: { id: number; departamento: string }[];
    subprocesos: { id: number; subproceso: string }[];
  };
  contrasena_inicial: string;
  url_ingreso: string;
  aviso: string;
};

export async function crearUsuario(scope: AuthScope, args: CrearArgs, deps: CrearDeps = {}): Promise<CrearResultado> {
  const v = validarSolicitudCreacion(scope, args);

  // Entra (fuera de la transacción: es una llamada de red).
  if (v.cfg.exigirEntra) {
    const entra = deps.entra === undefined ? verificadorPorDefecto() : deps.entra;
    if (!entra) throw new UsuariosRechazo('No se pudo verificar el correo en Entra (Graph no está configurado en el servidor).');
    let cuenta;
    try {
      cuenta = await entra(v.email);
    } catch (err) {
      throw new UsuariosRechazo(`No se pudo verificar el correo en Entra (${(err as Error).message}).`);
    }
    if (!cuenta) throw new UsuariosRechazo(`El correo ${v.email} no existe en el directorio (Entra). Verifique cómo está escrito.`);
    if (!cuenta.accountEnabled || cuenta.licencias < 1) {
      throw new UsuariosRechazo(`La cuenta ${v.email} está deshabilitada o sin licencia en Entra.`);
    }
  }

  const contrasena = (deps.generar ?? generarContrasena)();
  const hash = await (deps.hash ?? ((pw: string) => bcrypt.hash(pw, BCRYPT_COSTO)))(contrasena);
  const marca = marcaAgente(scope);
  const performedBy = `${marca} a pedido de ${v.solicitante}`.slice(0, 250);

  const creado = await executeWrite(async (tx: TxClient) => {
    // 1. Solicitante: usuario activo de SynerLink.
    const sol = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT TOP 1 u.id FROM [user] u
      WHERE LOWER(LTRIM(RTRIM(u.email))) = ${v.solicitante} AND u.isActive = 1
    `);
    if (!sol.length) throw new UsuariosRechazo('La persona que lo pide no es un usuario activo de SynerLink.');

    // 2. Tope por hora y por día (bloqueo para que dos llamadas simultáneas no lo salten).
    const marcaLike = `${escaparLike(marca)}%`;
    const conteo = await tx.$queryRaw<{ hora: number | null; dia: number | null }[]>(Prisma.sql`
      SELECT SUM(CASE WHEN l.created_at >= DATEADD(HOUR, -1, SYSUTCDATETIME()) THEN 1 ELSE 0 END) AS hora,
             COUNT(*) AS dia
      FROM user_audit_log l WITH (UPDLOCK, HOLDLOCK)
      WHERE l.action = 'CREATE' AND l.performed_by LIKE ${marcaLike}
        AND l.created_at >= DATEADD(HOUR, -24, SYSUTCDATETIME())
    `);
    const hora = Number(conteo[0]?.hora ?? 0);
    const dia = Number(conteo[0]?.dia ?? 0);
    if (hora >= v.cfg.maxPorHora) {
      throw new UsuariosRechazo(`Se alcanzó el tope de ${v.cfg.maxPorHora} usuarios creados por hora con este agente. Intente más tarde.`);
    }
    if (dia >= v.cfg.maxPorDia) {
      throw new UsuariosRechazo(`Se alcanzó el tope de ${v.cfg.maxPorDia} usuarios creados en 24 horas con este agente.`);
    }

    // 3. El correo no puede existir (mismo criterio del login).
    const existe = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT TOP 1 u.id FROM [user] u WHERE LOWER(LTRIM(RTRIM(u.email))) = ${v.email}
    `);
    if (existe.length) throw new UsuariosRechazo(`Ya existe un usuario con el correo ${v.email}. Use kronos_usuarios_consultar para revisarlo.`);

    // 4. Empresa, departamentos y subprocesos existen; subprocesos no prohibidos.
    const empresa = await tx.$queryRaw<{ id_company: number; company: string }[]>(Prisma.sql`
      SELECT TOP 1 c.id_company, c.company FROM company c WHERE c.id_company = ${args.companyId}
    `);
    if (!empresa[0]) throw new UsuariosRechazo(`La empresa ${args.companyId} no existe.`);

    let departamentos: { id_department: number; department: string }[] = [];
    if (v.departmentIds.length) {
      departamentos = await tx.$queryRaw<{ id_department: number; department: string }[]>(Prisma.sql`
        SELECT d.id_department, d.department FROM department d WHERE d.id_department IN (${Prisma.join(v.departmentIds)})
      `);
      const faltan = v.departmentIds.filter((id) => !departamentos.some((d) => d.id_department === id));
      if (faltan.length) throw new UsuariosRechazo(`Departamentos inexistentes: ${faltan.join(', ')}.`);
    }

    let subprocesos: { id_subprocess: number; subprocess: string | null; subprocess_url: string | null; es_agente: number }[] = [];
    if (v.subprocessIds.length) {
      subprocesos = await tx.$queryRaw<typeof subprocesos>(Prisma.sql`
        SELECT s.id_subprocess, s.subprocess, s.subprocess_url,
               CASE WHEN EXISTS (SELECT 1 FROM agent a WHERE a.id_subprocess = s.id_subprocess) THEN 1 ELSE 0 END AS es_agente
        FROM subprocess s WHERE s.id_subprocess IN (${Prisma.join(v.subprocessIds)})
      `);
      const faltan = v.subprocessIds.filter((id) => !subprocesos.some((s) => s.id_subprocess === id));
      if (faltan.length) throw new UsuariosRechazo(`Subprocesos inexistentes: ${faltan.join(', ')}.`);
      const prohibidos = subprocesos.filter(subprocesoProhibido);
      if (prohibidos.length) {
        throw new UsuariosRechazo(
          `Subprocesos prohibidos para asignar por agente (administración, chat/agentes, auditoría): ${prohibidos
            .map((s) => `${s.id_subprocess} ${s.subprocess ?? ''}`.trim())
            .join(', ')}.`
        );
      }
    }

    // 5. Crear el usuario igual que POST /api/users (id cuid de Prisma, rol user).
    const user = await tx.user.create({
      data: { name: v.nombre, email: v.email, password: hash, role: ROL_PERMITIDO },
      select: { id: true },
    });
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO user_audit_log (user_id, action, performed_by, details, created_at)
      VALUES (${user.id}, 'CREATE', ${performedBy}, ${`User created with role: ${ROL_PERMITIDO}`}, SYSUTCDATETIME())
    `);

    // 6. Empresa + subprocesos.
    const cu = await tx.$queryRaw<{ id_company_user: number }[]>(Prisma.sql`
      INSERT INTO company_user (id_company, id_user) OUTPUT INSERTED.id_company_user VALUES (${args.companyId}, ${user.id})
    `);
    const idCompanyUser = cu[0]?.id_company_user;
    if (!idCompanyUser) throw new Error('no se pudo asociar la empresa');
    for (const s of v.subprocessIds) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO subprocess_user_company (id_subprocess, id_company_user) VALUES (${s}, ${idCompanyUser})
      `);
    }
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO user_audit_log (user_id, action, performed_by, details, created_at)
      VALUES (${user.id}, 'UPDATE_SUBPROCESSES', ${performedBy},
              ${JSON.stringify({ companyId: args.companyId, subprocessIds: v.subprocessIds, mode: 'add' })}, SYSUTCDATETIME())
    `);

    // 7. Departamentos.
    for (const d of v.departmentIds) {
      await tx.$executeRaw(Prisma.sql`INSERT INTO department_user (id_user, id_department) VALUES (${user.id}, ${d})`);
    }
    if (v.departmentIds.length) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO user_audit_log (user_id, action, performed_by, details, created_at)
        VALUES (${user.id}, 'UPDATE', ${performedBy}, ${JSON.stringify({ departmentIds: v.departmentIds })}, SYSUTCDATETIME())
      `);
    }

    return { id: user.id, empresa: empresa[0], departamentos, subprocesos };
  });

  return {
    status: 'creado',
    usuario: {
      id: creado.id,
      nombre: v.nombre,
      correo: v.email,
      rol: ROL_PERMITIDO,
      empresa: { id: creado.empresa.id_company, empresa: creado.empresa.company },
      departamentos: creado.departamentos.map((d) => ({ id: d.id_department, departamento: d.department })),
      subprocesos: creado.subprocesos.map((s) => ({ id: s.id_subprocess, subproceso: s.subprocess ?? '' })),
    },
    contrasena_inicial: contrasena,
    url_ingreso: process.env.MCP_USUARIOS_URL_INGRESO?.trim() || 'https://groupsharedservices.farmalogica.com:8445/login',
    aviso: `Entregue la contraseña inicial SOLO a ${v.solicitante}, que pidió la creación. No se vuelve a mostrar ni queda guardada en claro. Recomiende cambiarla en el primer ingreso.`,
  };
}

// ---------------------------------------------------------------------------
// Registro de las herramientas
// ---------------------------------------------------------------------------

function texto(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

/** Registra las dos herramientas SOLO si la llave trae el bloque `usuarios`. */
export function registerUsuariosTools(server: McpServer, ctx: Ctx): void {
  if (!ctx.scope.usuarios || !ctx.scope.agentCode) return;

  const auditar = (tool: string, params: unknown, outcome: 'ok' | 'error' | 'denied', extra: { rows?: number; error?: string } = {}) =>
    ctx.audit.log({
      ts: new Date().toISOString(),
      agent: ctx.scope.agent,
      role: ctx.scope.role,
      companyIds: ctx.scope.companyIds,
      tool,
      params,
      outcome,
      ...extra,
    });

  const rechazo = (err: unknown, que: string) => ({
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: err instanceof UsuariosRechazo ? `Rechazada: ${(err as Error).message}` : `Error: no se pudo ${que} (${(err as Error).message})`,
      },
    ],
  });

  server.tool(
    USUARIOS_CONSULTAR_TOOL,
    'SOLO LECTURA. Busca usuarios de SynerLink por nombre, correo o empresa (dentro de las empresas permitidas para este agente). Devuelve nombre, correo, si está activo, rol, empresas, departamentos y agentes del chat asignados. Nunca devuelve contraseñas, tokens ni datos personales sensibles. Úsela antes de crear un usuario para confirmar que no exista.',
    {
      texto: z.string().min(2).max(120).optional().describe('Parte del nombre o del correo (p. ej. "giraldo").'),
      email: z.string().max(255).optional().describe('Correo exacto.'),
      companyId: z.number().int().positive().optional().describe('Id de la empresa (debe estar en el alcance del agente).'),
      limite: z.number().int().min(1).max(USUARIOS_MAX_RESULTADOS).optional().describe(`Máximo de resultados (1-${USUARIOS_MAX_RESULTADOS}, por defecto 10).`),
    },
    async (args) => {
      try {
        const r = await consultarUsuarios(ctx.scope, args);
        await auditar(USUARIOS_CONSULTAR_TOOL, args, 'ok', { rows: r.total });
        return texto(r);
      } catch (err) {
        await auditar(USUARIOS_CONSULTAR_TOOL, args, err instanceof UsuariosRechazo ? 'denied' : 'error', { error: (err as Error).message });
        return rechazo(err, 'consultar usuarios');
      }
    }
  );

  server.tool(
    USUARIOS_CREAR_TOOL,
    `ESCRITURA acotada. Crea un usuario de SynerLink con rol "user" (nunca administrador), SOLO cuando la persona autorizada de este agente se lo pida. Valida el correo (formato, dominio permitido, que no exista y que esté activo en Entra), asigna la empresa, los departamentos y los subprocesos de la lista permitida de este agente (nunca administración de usuarios, chat/agentes ni auditoría), deja registro en la bitácora de usuarios y respeta un tope de creaciones por hora. Devuelve UNA sola vez la contraseña inicial: entréguesela únicamente a quien la pidió.`,
    {
      solicitanteEmail: z.string().max(255).describe('Correo de la persona que le está pidiendo la creación (debe ser la autorizada para este agente).'),
      nombre: z.string().min(5).max(120).describe('Nombre completo como aparece en el directorio (Entra).'),
      email: z.string().max(255).describe('Correo corporativo de la persona nueva.'),
      companyId: z.number().int().positive().describe('Id de la empresa (de la lista permitida).'),
      departmentIds: z.array(z.number().int().positive()).max(10).optional().describe('Ids de departamentos (de la lista permitida).'),
      subprocessIds: z.array(z.number().int().positive()).max(30).optional().describe('Ids de subprocesos/permisos (de la lista permitida).'),
      rol: z.string().max(30).optional().describe('Solo se acepta "user". Omítalo.'),
    },
    async (args) => {
      try {
        const r = await crearUsuario(ctx.scope, args, { entra: ctx.entra });
        // La contraseña NO va a la auditoría: solo los parámetros (que no la contienen).
        await auditar(USUARIOS_CREAR_TOOL, args, 'ok', { rows: 1 });
        return texto(r);
      } catch (err) {
        await auditar(USUARIOS_CREAR_TOOL, args, err instanceof UsuariosRechazo ? 'denied' : 'error', { error: (err as Error).message });
        return rechazo(err, 'crear el usuario');
      }
    }
  );
}
