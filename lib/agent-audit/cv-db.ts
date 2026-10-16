/**
 * HOJA DE VIDA DE LOS AGENTES (Auditoría de agentes, F2) — parte que toca la
 * base. La lógica pura está en ./cv.ts.
 *
 * DE DÓNDE SALE CADA DATO (nada de esto lee el TEXTO de las conversaciones):
 *   - métricas: chat_message (solo rol, autor, hilo y hora) y
 *     chat_agent_turn_usage (consumo declarado por el agente, deduplicado);
 *   - herramientas, MCP, skills y canales: el inventario de F1;
 *   - historial: altas, cambios entre escaneos, hallazgos y cambios de perfil;
 *   - usuarios asignados: el subproceso-permiso del agente.
 */
import { Prisma } from '../../app/generated/prisma';
import { prisma } from '../prisma';
import { mapearInventario } from './inventory-db';
import {
  consumoPorDia,
  cambiosPerfil,
  describirInventario,
  diaColombia,
  diffInventarios,
  inicioDiaColombia,
  lunesDe,
  sumarDias,
  tituloHallazgos,
  type FilaConsumo,
  type FotoInventario,
  type PerfilEntrada,
} from './cv';

// ── Métricas diarias ─────────────────────────────────────────────────────────

/** Días que recalcula la corrida nocturna por defecto (incluye hoy, parcial). */
export const VENTANA_NOCTURNA_DIAS = 7;

type FilaMensajes = {
  id_agent: number;
  dia: Date;
  recibidos: number;
  enviados: number;
  usuarios: number;
  conversaciones: number;
};

/**
 * Recalcula agent_metrics_daily para los días [desde, hasta] (Colombia). Se
 * borra la ventana y se vuelve a escribir en una transacción: repetir la
 * corrida da el mismo resultado.
 *
 * Hilos de un agente: los directos (chat_conversation.id_agent) y los grupos
 * donde participa (chat_participant). Los hilos entre personas no cuentan.
 */
export async function calcularMetricas(desde: string, hasta: string) {
  const ini = inicioDiaColombia(desde);
  const fin = inicioDiaColombia(sumarDias(hasta, 1));

  const mensajes = await prisma.$queryRaw<FilaMensajes[]>(Prisma.sql`
    WITH hilos AS (
      SELECT c.id AS id_conversation, c.id_agent
      FROM chat_conversation c WHERE c.kind = 'direct'
      UNION
      SELECT p.id_conversation, p.id_agent
      FROM chat_participant p
      JOIN chat_conversation c ON c.id = p.id_conversation
      WHERE c.kind = 'group' AND p.id_agent IS NOT NULL
    )
    SELECT h.id_agent,
      CAST(DATEADD(HOUR, -5, m.created_at) AS date) AS dia,
      SUM(CASE WHEN m.role = 'user' THEN 1 ELSE 0 END) AS recibidos,
      SUM(CASE WHEN m.role = 'agent' AND COALESCE(m.id_agent_author, c.id_agent) = h.id_agent THEN 1 ELSE 0 END) AS enviados,
      COUNT(DISTINCT CASE WHEN m.role = 'user' THEN COALESCE(m.id_user_author, c.id_user) END) AS usuarios,
      COUNT(DISTINCT CASE WHEN m.role = 'user'
        OR (m.role = 'agent' AND COALESCE(m.id_agent_author, c.id_agent) = h.id_agent)
        THEN m.id_conversation END) AS conversaciones
    FROM chat_message m
    JOIN chat_conversation c ON c.id = m.id_conversation
    JOIN hilos h ON h.id_conversation = m.id_conversation
    WHERE m.created_at >= ${ini} AND m.created_at < ${fin} AND m.event_type IS NULL
    GROUP BY h.id_agent, CAST(DATEADD(HOUR, -5, m.created_at) AS date)
  `);

  // El consumo se trae por la hora del turno y, si falta, por la del reporte.
  // Se amplía un día a cada lado para no perder turnos que cruzan la medianoche.
  const filasConsumo = await prisma.chatAgentTurnUsage.findMany({
    where: {
      created_at: { gte: new Date(ini.getTime() - 86_400_000), lt: new Date(fin.getTime() + 86_400_000) },
    },
    select: {
      id: true,
      id_agent: true,
      session_id: true,
      turn_started_at: true,
      created_at: true,
      input_tokens: true,
      cache_creation_tokens: true,
      cache_read_tokens: true,
      output_tokens: true,
      total_tokens: true,
    },
  });
  const consumo = consumoPorDia(filasConsumo as FilaConsumo[]);

  const agentes = new Set((await prisma.agent.findMany({ select: { id_agent: true } })).map((a) => a.id_agent));
  const filas = new Map<string, Prisma.AgentMetricsDailyCreateManyInput>();
  const base = (idAgent: number, dia: string): Prisma.AgentMetricsDailyCreateManyInput => ({
    id_agent: idAgent,
    day: new Date(`${dia}T00:00:00.000Z`),
    messages_received: 0,
    messages_sent: 0,
    active_users: 0,
    conversations: 0,
    turns: 0,
    input_tokens: BigInt(0),
    cache_creation_tokens: BigInt(0),
    cache_read_tokens: BigInt(0),
    output_tokens: BigInt(0),
    total_tokens: BigInt(0),
  });

  for (const m of mensajes) {
    const dia = m.dia.toISOString().slice(0, 10);
    if (dia < desde || dia > hasta || !agentes.has(m.id_agent)) continue;
    const f = base(m.id_agent, dia);
    f.messages_received = Number(m.recibidos);
    f.messages_sent = Number(m.enviados);
    f.active_users = Number(m.usuarios);
    f.conversations = Number(m.conversaciones);
    filas.set(`${m.id_agent}|${dia}`, f);
  }
  for (const [clave, c] of consumo) {
    const [idTxt, dia] = clave.split('|');
    const idAgent = Number(idTxt);
    if (dia < desde || dia > hasta || !agentes.has(idAgent)) continue;
    const f = filas.get(clave) ?? base(idAgent, dia);
    f.turns = c.turns;
    f.input_tokens = BigInt(c.input_tokens);
    f.cache_creation_tokens = BigInt(c.cache_creation_tokens);
    f.cache_read_tokens = BigInt(c.cache_read_tokens);
    f.output_tokens = BigInt(c.output_tokens);
    f.total_tokens = BigInt(c.total_tokens);
    filas.set(clave, f);
  }

  const lista = [...filas.values()];
  await prisma.$transaction([
    prisma.agentMetricsDaily.deleteMany({
      where: {
        day: { gte: new Date(`${desde}T00:00:00.000Z`), lte: new Date(`${hasta}T00:00:00.000Z`) },
      },
    }),
    ...(lista.length ? [prisma.agentMetricsDaily.createMany({ data: lista })] : []),
  ]);

  return { desde, hasta, filas: lista.length };
}

// ── Historial (línea de tiempo) ──────────────────────────────────────────────

type NuevaEntrada = {
  id_agent: number;
  occurred_at: Date;
  kind: string;
  title: string;
  detail: string | null;
  source_ref: string;
  created_by?: string | null;
};

/** Inserta las entradas cuyo source_ref todavía no exista para ese agente. */
async function insertarEntradas(entradas: NuevaEntrada[]): Promise<number> {
  if (entradas.length === 0) return 0;
  const porAgente = new Map<number, NuevaEntrada[]>();
  for (const e of entradas) porAgente.set(e.id_agent, [...(porAgente.get(e.id_agent) ?? []), e]);

  let creadas = 0;
  for (const [idAgent, lista] of porAgente) {
    const existentes = new Set(
      (
        await prisma.agentCvEntry.findMany({
          where: { id_agent: idAgent, source_ref: { in: lista.map((e) => e.source_ref) } },
          select: { source_ref: true },
        })
      ).map((e) => e.source_ref)
    );
    const nuevas = lista.filter((e) => !existentes.has(e.source_ref));
    if (nuevas.length === 0) continue;
    await prisma.agentCvEntry.createMany({
      data: nuevas.map((e) => ({ ...e, detail: e.detail ? e.detail.slice(0, 2000) : null, title: e.title.slice(0, 300) })),
    });
    creadas += nuevas.length;
  }
  return creadas;
}

function foto(inv: ReturnType<typeof mapearInventario>): FotoInventario {
  return {
    kind: inv.kind,
    host: inv.host,
    model: inv.model,
    execMode: inv.execMode,
    execRequiresApproval: inv.execRequiresApproval,
    tools: inv.tools,
    skills: inv.skills,
    channels: inv.channels.map((c) => ({ type: c.type, policy: c.policy })),
    mcps: inv.mcps.map((m) => ({ name: m.name, access: m.access, auth: m.auth, company: m.company })),
  };
}

/**
 * Reconstruye la línea de tiempo. Idempotente (source_ref único por agente).
 *
 * `desde` acota cuánto se revisa: los inventarios desde esa fecha (más el
 * inmediatamente anterior, como punto de comparación) y los hallazgos que se
 * abrieron o cerraron desde entonces. null = todo el historial.
 */
export async function reconstruirHistorial(opts: { desde?: Date | null; idAgents?: number[] } = {}) {
  const desde = opts.desde ?? null;
  const filtroAgente = opts.idAgents?.length ? { id_agent: { in: opts.idAgents } } : {};
  const entradas: NuevaEntrada[] = [];

  // 1. Altas.
  const agentes = await prisma.agent.findMany({
    where: opts.idAgents?.length ? { id_agent: { in: opts.idAgents } } : {},
    select: { id_agent: true, created_at: true, display_name: true },
  });
  for (const a of agentes) {
    entradas.push({
      id_agent: a.id_agent,
      occurred_at: a.created_at,
      kind: 'alta',
      title: 'Alta en SynerLink',
      detail: `${a.display_name.trim()} quedó registrado como agente del chat.`,
      source_ref: 'alta',
    });
  }

  // 2. Cambios de inventario entre escaneos.
  for (const a of agentes) {
    const base = desde
      ? await prisma.agentInventory.findFirst({
          where: { id_agent: a.id_agent, scanned_at: { lt: desde }, scan_error: null },
          orderBy: { id: 'desc' },
          include: { mcps: { orderBy: { name: 'asc' } } },
        })
      : null;
    const invs = await prisma.agentInventory.findMany({
      where: { id_agent: a.id_agent, ...(desde ? { scanned_at: { gte: desde } } : {}) },
      include: { mcps: { orderBy: { name: 'asc' } } },
      orderBy: { id: 'asc' },
    });
    let previa: FotoInventario | null = base ? foto(mapearInventario(base)) : null;
    for (const inv of invs) {
      // Un escaneo que no pudo leer al agente no es un cambio: se salta y se
      // sigue comparando contra la última foto buena.
      if (inv.scan_error) continue;
      const actual = foto(mapearInventario(inv));
      if (!previa) {
        entradas.push({
          id_agent: a.id_agent,
          occurred_at: inv.scanned_at,
          kind: 'inventario',
          title: 'Primer inventario',
          detail: describirInventario(actual),
          source_ref: `inv:${inv.id}`,
        });
      } else {
        const cambios = diffInventarios(previa, actual);
        if (cambios.length > 0) {
          entradas.push({
            id_agent: a.id_agent,
            occurred_at: inv.scanned_at,
            kind: 'inventario',
            title: cambios.length === 1 ? 'Cambió el inventario' : `Cambió el inventario (${cambios.length} cambios)`,
            detail: cambios.join('\n'),
            source_ref: `inv:${inv.id}`,
          });
        }
      }
      previa = actual;
    }
  }

  // 3. Hallazgos abiertos y cerrados, agrupados por la corrida que los produjo.
  const hallazgos = await prisma.agentAuditFinding.findMany({
    where: {
      ...filtroAgente,
      ...(desde ? { OR: [{ first_seen_at: { gte: desde } }, { resolved_at: { gte: desde } }] } : {}),
    },
    select: { id_agent: true, severity: true, title: true, first_seen_at: true, resolved_at: true, status: true },
  });
  const grupos = new Map<string, { idAgent: number; tipo: 'abre' | 'cierra'; at: Date; items: typeof hallazgos }>();
  for (const h of hallazgos) {
    const marcas: ['abre' | 'cierra', Date | null][] = [
      ['abre', h.first_seen_at],
      ['cierra', h.status === 'resuelto' ? h.resolved_at : null],
    ];
    for (const [tipo, at] of marcas) {
      if (!at || (desde && at < desde)) continue;
      const clave = `${h.id_agent}|${tipo}|${at.getTime()}`;
      const g = grupos.get(clave) ?? { idAgent: h.id_agent, tipo, at, items: [] };
      g.items.push(h);
      grupos.set(clave, g);
    }
  }
  const ORDEN: Record<string, number> = { critico: 0, alto: 1, medio: 2, bajo: 3 };
  for (const g of grupos.values()) {
    const items = [...g.items].sort((x, y) => (ORDEN[x.severity] ?? 9) - (ORDEN[y.severity] ?? 9));
    entradas.push({
      id_agent: g.idAgent,
      occurred_at: g.at,
      kind: g.tipo === 'abre' ? 'hallazgo_abierto' : 'hallazgo_cerrado',
      title: tituloHallazgos(
        g.tipo,
        items.map((i) => i.severity)
      ),
      detail: items.map((i) => i.title).join('\n'),
      source_ref: `hal-${g.tipo}:${g.at.getTime()}`,
    });
  }

  const creadas = await insertarEntradas(entradas);
  return { revisadas: entradas.length, creadas };
}

// ── Perfil ───────────────────────────────────────────────────────────────────

export async function guardarPerfil(code: string, entrada: PerfilEntrada, email: string) {
  const agente = await prisma.agent.findUnique({ where: { code }, select: { id_agent: true } });
  if (!agente) return null;
  const antes = await prisma.agentProfile.findUnique({ where: { id_agent: agente.id_agent } });
  const cambios = cambiosPerfil(
    antes ? { purpose: antes.purpose, ownerName: antes.owner_name, ownerEmail: antes.owner_email } : null,
    entrada
  );
  // Sin cambios no se escribe nada: ni la fila ni la marca de "actualizado por".
  if (cambios.length === 0) return { cambios };
  const ahora = new Date();
  const data = {
    purpose: entrada.purpose,
    owner_name: entrada.ownerName,
    owner_email: entrada.ownerEmail,
    updated_by: email,
    updated_at: ahora,
  };
  await prisma.agentProfile.upsert({
    where: { id_agent: agente.id_agent },
    create: { id_agent: agente.id_agent, ...data },
    update: data,
  });
  if (cambios.length > 0) {
    await insertarEntradas([
      {
        id_agent: agente.id_agent,
        occurred_at: ahora,
        kind: 'perfil',
        title: 'Se actualizó la hoja de vida',
        detail: cambios.join('\n'),
        source_ref: `perfil:${ahora.getTime()}`,
        created_by: email,
      },
    ]);
  }
  return { cambios };
}

// ── Lectura de la ficha ──────────────────────────────────────────────────────

const n = (v: bigint | number | null | undefined) => Number(v ?? 0);

type FilaUsuarioActividad = { id_user: string; mensajes: number; ultimo: Date };

/** Personas que le escribieron al agente desde `desde` (conteo y última vez; nunca el texto). */
async function actividadPorUsuario(idAgent: number, desde: Date | null) {
  const filtro = desde ? Prisma.sql`AND m.created_at >= ${desde}` : Prisma.empty;
  return prisma.$queryRaw<FilaUsuarioActividad[]>(Prisma.sql`
    WITH hilos AS (
      SELECT c.id AS id_conversation FROM chat_conversation c WHERE c.kind = 'direct' AND c.id_agent = ${idAgent}
      UNION
      SELECT p.id_conversation FROM chat_participant p
      JOIN chat_conversation c ON c.id = p.id_conversation
      WHERE c.kind = 'group' AND p.id_agent = ${idAgent}
    )
    SELECT COALESCE(m.id_user_author, c.id_user) AS id_user, COUNT(*) AS mensajes, MAX(m.created_at) AS ultimo
    FROM chat_message m
    JOIN chat_conversation c ON c.id = m.id_conversation
    JOIN hilos h ON h.id_conversation = m.id_conversation
    WHERE m.role = 'user' AND m.event_type IS NULL ${filtro}
    GROUP BY COALESCE(m.id_user_author, c.id_user)
  `);
}

function totales(filas: { messages_received: number; messages_sent: number; turns: number; total_tokens: bigint; input_tokens: bigint; output_tokens: bigint; cache_creation_tokens: bigint; cache_read_tokens: bigint; conversations: number }[]) {
  const t = {
    mensajesRecibidos: 0,
    mensajesEnviados: 0,
    conversaciones: 0,
    turnos: 0,
    tokensTotal: 0,
    tokensEntrada: 0,
    tokensSalida: 0,
    tokensCacheCreacion: 0,
    tokensCacheLectura: 0,
    diasActivos: 0,
  };
  for (const f of filas) {
    t.mensajesRecibidos += f.messages_received;
    t.mensajesEnviados += f.messages_sent;
    t.conversaciones += f.conversations;
    t.turnos += f.turns;
    t.tokensTotal += n(f.total_tokens);
    t.tokensEntrada += n(f.input_tokens);
    t.tokensSalida += n(f.output_tokens);
    t.tokensCacheCreacion += n(f.cache_creation_tokens);
    t.tokensCacheLectura += n(f.cache_read_tokens);
    if (f.messages_received + f.messages_sent + f.turns > 0) t.diasActivos += 1;
  }
  return t;
}

export async function leerHojaDeVida(code: string) {
  const agente = await prisma.agent.findUnique({
    where: { code },
    select: {
      id_agent: true,
      code: true,
      display_name: true,
      handle: true,
      description: true,
      is_active: true,
      created_at: true,
      id_subprocess: true,
      avatar_url: true,
      avatar_updated_at: true,
      companies: { select: { is_primary: true, company: { select: { company: true } } } },
      subprocess: { select: { subprocess: true } },
      profile: true,
    },
  });
  if (!agente) return null;
  const idAgent = agente.id_agent;

  const hoy = diaColombia(new Date());
  const desde30 = sumarDias(hoy, -29);

  const [inv, asignaciones, metricas, ultimaMetrica, entradas, hallAbiertos, hallCerrados, resumenes, act30, actTodo] =
    await Promise.all([
      prisma.agentInventory.findFirst({
        where: { id_agent: idAgent },
        orderBy: { id: 'desc' },
        include: { mcps: { orderBy: { name: 'asc' } } },
      }),
      agente.id_subprocess
        ? prisma.subprocessUserCompany.findMany({
            where: { id_subprocess: agente.id_subprocess },
            select: {
              companyUser: {
                select: {
                  company: { select: { company: true } },
                  user: { select: { id: true, name: true, email: true, isActive: true } },
                },
              },
            },
          })
        : Promise.resolve([]),
      prisma.agentMetricsDaily.findMany({ where: { id_agent: idAgent }, orderBy: { day: 'asc' } }),
      prisma.agentMetricsDaily.findFirst({ orderBy: { computed_at: 'desc' }, select: { computed_at: true } }),
      prisma.agentCvEntry.findMany({
        where: { id_agent: idAgent },
        orderBy: [{ occurred_at: 'desc' }, { id: 'desc' }],
        take: 200,
      }),
      prisma.agentAuditFinding.findMany({
        where: { id_agent: idAgent, status: 'abierto' },
        orderBy: [{ first_seen_at: 'asc' }, { id: 'asc' }],
      }),
      prisma.agentAuditFinding.findMany({
        where: { id_agent: idAgent, status: 'resuelto' },
        orderBy: { resolved_at: 'desc' },
        take: 50,
      }),
      prisma.agentCvSummary.findMany({
        where: { id_agent: idAgent },
        orderBy: { week_start: 'desc' },
        take: 8,
      }),
      actividadPorUsuario(idAgent, inicioDiaColombia(desde30)),
      actividadPorUsuario(idAgent, null),
    ]);

  // Usuarios asignados: una fila por persona, con sus empresas.
  const usuarios = new Map<
    string,
    { id: string; nombre: string; email: string; activo: boolean; empresas: string[] }
  >();
  for (const a of asignaciones) {
    const u = a.companyUser.user;
    const r = usuarios.get(u.id) ?? {
      id: u.id,
      nombre: u.name?.trim() || u.email,
      email: u.email,
      activo: u.isActive,
      empresas: [],
    };
    const emp = a.companyUser.company.company.trim();
    if (!r.empresas.includes(emp)) r.empresas.push(emp);
    usuarios.set(u.id, r);
  }
  const actPorUsuario = new Map(actTodo.map((x) => [x.id_user, x]));
  const act30PorUsuario = new Map(act30.map((x) => [x.id_user, x]));
  // Quien le escribió sin tenerlo asignado hoy (permiso retirado, o en un grupo)
  // también se muestra: es justo lo que un auditor quiere ver.
  const sinAsignar = actTodo.filter((x) => !usuarios.has(x.id_user)).map((x) => x.id_user);
  const otros = sinAsignar.length
    ? await prisma.user.findMany({
        where: { id: { in: sinAsignar } },
        select: { id: true, name: true, email: true, isActive: true },
      })
    : [];

  const serie = new Map(metricas.map((m) => [m.day.toISOString().slice(0, 10), m]));
  const ultimos30 = metricas.filter((m) => m.day.toISOString().slice(0, 10) >= desde30);
  const dias: { dia: string; recibidos: number; enviados: number; tokens: number; usuarios: number }[] = [];
  for (let d = desde30; d <= hoy; d = sumarDias(d, 1)) {
    const m = serie.get(d);
    dias.push({
      dia: d,
      recibidos: m?.messages_received ?? 0,
      enviados: m?.messages_sent ?? 0,
      tokens: n(m?.total_tokens),
      usuarios: m?.active_users ?? 0,
    });
  }

  const invMap = inv ? mapearInventario(inv) : null;
  const hallazgo = (h: (typeof hallAbiertos)[number]) => ({
    id: h.id,
    ruleCode: h.rule_code,
    severity: h.severity,
    subject: h.subject,
    title: h.title,
    detail: h.detail,
    status: h.status,
    firstSeenAt: h.first_seen_at.toISOString(),
    lastSeenAt: h.last_seen_at.toISOString(),
    resolvedAt: h.resolved_at?.toISOString() ?? null,
  });

  return {
    agente: {
      idAgent,
      code: agente.code,
      displayName: agente.display_name.trim(),
      handle: agente.handle,
      description: agente.description,
      activo: agente.is_active,
      creadoEl: agente.created_at.toISOString(),
      permiso: agente.subprocess?.subprocess ?? null,
      empresas: agente.companies.map((c) => ({ nombre: c.company.company.trim(), principal: c.is_primary })),
      avatar: agente.avatar_updated_at
        ? `/api/chat/agents/${encodeURIComponent(agente.code)}/avatar?v=${agente.avatar_updated_at.getTime()}`
        : agente.avatar_url,
    },
    perfil: agente.profile
      ? {
          purpose: agente.profile.purpose,
          ownerName: agente.profile.owner_name,
          ownerEmail: agente.profile.owner_email,
          updatedBy: agente.profile.updated_by,
          updatedAt: agente.profile.updated_at.toISOString(),
        }
      : null,
    usuarios: [
      ...[...usuarios.values()].map((u) => ({
        ...u,
        asignado: true,
        mensajes: Number(actPorUsuario.get(u.id)?.mensajes ?? 0),
        mensajes30: Number(act30PorUsuario.get(u.id)?.mensajes ?? 0),
        ultimoMensaje: actPorUsuario.get(u.id)?.ultimo?.toISOString() ?? null,
      })),
      ...otros.map((u) => ({
        id: u.id,
        nombre: u.name?.trim() || u.email,
        email: u.email,
        activo: u.isActive,
        empresas: [] as string[],
        asignado: false,
        mensajes: Number(actPorUsuario.get(u.id)?.mensajes ?? 0),
        mensajes30: Number(act30PorUsuario.get(u.id)?.mensajes ?? 0),
        ultimoMensaje: actPorUsuario.get(u.id)?.ultimo?.toISOString() ?? null,
      })),
    ].sort((a, b) => b.mensajes - a.mensajes || a.nombre.localeCompare(b.nombre, 'es')),
    inventario: invMap,
    metricas: {
      calculadoEl: ultimaMetrica?.computed_at.toISOString() ?? null,
      desde30,
      hasta: hoy,
      ultimos30: { ...totales(ultimos30), usuariosActivos: act30.length },
      historico: {
        ...totales(metricas),
        usuariosActivos: actTodo.length,
        primerDia: metricas[0]?.day.toISOString().slice(0, 10) ?? null,
      },
      dias,
    },
    historial: entradas.map((e) => ({
      id: e.id,
      occurredAt: e.occurred_at.toISOString(),
      kind: e.kind,
      title: e.title,
      detail: e.detail,
      createdBy: e.created_by,
    })),
    hallazgos: {
      abiertos: hallAbiertos.map(hallazgo),
      cerrados: hallCerrados.map(hallazgo),
    },
    resumenes: resumenes.map((r) => ({
      semana: r.week_start.toISOString().slice(0, 10),
      texto: r.summary,
      modelo: r.model,
      generadoEl: r.generated_at.toISOString(),
    })),
  };
}

export type HojaDeVida = NonNullable<Awaited<ReturnType<typeof leerHojaDeVida>>>;

// ── Insumos del resumen semanal (SOLO datos estructurados) ──────────────────

/**
 * Lo único que ve la IA para redactar el resumen semanal de cada agente.
 *
 * NUNCA incluye el texto de las conversaciones, ni títulos de hilos, ni
 * nombres de adjuntos, ni nombres o correos de las personas: solo cifras,
 * nombres técnicos del inventario, hallazgos y el historial que arma esta
 * misma aplicación. Si se agrega un campo aquí, debe cumplir lo mismo.
 */
export async function insumosResumen(semana: string) {
  const lunes = lunesDe(semana);
  const domingo = sumarDias(lunes, 6);
  const lunesAnt = sumarDias(lunes, -7);
  const ini = inicioDiaColombia(lunes);
  const fin = inicioDiaColombia(sumarDias(lunes, 7));

  const agentes = await prisma.agent.findMany({
    where: { is_active: true },
    select: {
      id_agent: true,
      code: true,
      display_name: true,
      created_at: true,
      id_subprocess: true,
      companies: { select: { company: { select: { company: true } } } },
      profile: { select: { purpose: true, owner_name: true } },
    },
    orderBy: [{ sort_order: 'asc' }, { display_name: 'asc' }],
  });

  const metricas = await prisma.agentMetricsDaily.findMany({
    where: { day: { gte: new Date(`${lunesAnt}T00:00:00.000Z`), lte: new Date(`${domingo}T00:00:00.000Z`) } },
  });

  const usuariosSemana = await prisma.$queryRaw<{ id_agent: number; usuarios: number }[]>(Prisma.sql`
    WITH hilos AS (
      SELECT c.id AS id_conversation, c.id_agent FROM chat_conversation c WHERE c.kind = 'direct'
      UNION
      SELECT p.id_conversation, p.id_agent FROM chat_participant p
      JOIN chat_conversation c ON c.id = p.id_conversation
      WHERE c.kind = 'group' AND p.id_agent IS NOT NULL
    )
    SELECT h.id_agent, COUNT(DISTINCT COALESCE(m.id_user_author, c.id_user)) AS usuarios
    FROM chat_message m
    JOIN chat_conversation c ON c.id = m.id_conversation
    JOIN hilos h ON h.id_conversation = m.id_conversation
    WHERE m.role = 'user' AND m.event_type IS NULL AND m.created_at >= ${ini} AND m.created_at < ${fin}
    GROUP BY h.id_agent
  `);
  const usuariosPorAgente = new Map(usuariosSemana.map((u) => [u.id_agent, Number(u.usuarios)]));

  const asignados = await prisma.subprocessUserCompany.findMany({
    where: { id_subprocess: { in: agentes.map((a) => a.id_subprocess).filter((x): x is number => x !== null) } },
    select: { id_subprocess: true, companyUser: { select: { id_user: true } } },
  });
  const asignadosPorSub = new Map<number, Set<string>>();
  for (const a of asignados) {
    const s = asignadosPorSub.get(a.id_subprocess) ?? new Set<string>();
    s.add(a.companyUser.id_user);
    asignadosPorSub.set(a.id_subprocess, s);
  }

  const ultimos = await prisma.agentInventory.groupBy({ by: ['id_agent'], _max: { id: true } });
  const invs = await prisma.agentInventory.findMany({
    where: { id: { in: ultimos.map((u) => u._max.id).filter((x): x is number => typeof x === 'number') } },
    include: { mcps: true },
  });
  const invPorAgente = new Map(invs.map((i) => [i.id_agent, mapearInventario(i)]));

  const abiertos = await prisma.agentAuditFinding.findMany({
    where: { status: 'abierto' },
    select: { id_agent: true, severity: true },
  });
  const entradas = await prisma.agentCvEntry.findMany({
    where: { occurred_at: { gte: ini, lt: fin }, kind: { in: ['inventario', 'hallazgo_abierto', 'hallazgo_cerrado', 'perfil', 'alta'] } },
    orderBy: { occurred_at: 'asc' },
    select: { id_agent: true, occurred_at: true, kind: true, title: true, detail: true },
  });

  const sumar = (idAgent: number, de: string, a: string) => {
    const filas = metricas.filter((m) => {
      const d = m.day.toISOString().slice(0, 10);
      return m.id_agent === idAgent && d >= de && d <= a;
    });
    const t = totales(filas);
    return {
      mensajesRecibidos: t.mensajesRecibidos,
      mensajesEnviados: t.mensajesEnviados,
      turnos: t.turnos,
      tokensTotal: t.tokensTotal,
      diasActivos: t.diasActivos,
    };
  };

  return {
    semana: { desde: lunes, hasta: domingo },
    agentes: agentes.map((a) => {
      const inv = invPorAgente.get(a.id_agent);
      const sev = abiertos.filter((h) => h.id_agent === a.id_agent).map((h) => h.severity);
      return {
        code: a.code,
        nombre: a.display_name.trim(),
        empresas: a.companies.map((c) => c.company.company.trim()),
        enSynerLinkDesde: diaColombia(a.created_at),
        proposito: a.profile?.purpose ?? null,
        tieneDueno: Boolean(a.profile?.owner_name),
        usuariosAsignados: a.id_subprocess ? (asignadosPorSub.get(a.id_subprocess)?.size ?? 0) : 0,
        inventario: inv
          ? {
              tipo: inv.kind,
              equipo: inv.host,
              modelo: inv.model,
              servicio: inv.serviceStatus,
              comandosSinAprobacion: inv.execRequiresApproval === false,
              mcp: inv.mcps.length,
              mcpEscritura: inv.mcps.filter((m) => m.access === 'escritura').length,
              mcpSinAutenticacion: inv.mcps.filter((m) => m.auth === 'ninguna').length,
              skills: inv.skills.length,
              canales: inv.channels.map((c) => c.type),
            }
          : null,
        semanaActual: { ...sumar(a.id_agent, lunes, domingo), usuariosActivos: usuariosPorAgente.get(a.id_agent) ?? 0 },
        semanaAnterior: sumar(a.id_agent, lunesAnt, sumarDias(lunesAnt, 6)),
        hallazgosAbiertos: {
          critico: sev.filter((s) => s === 'critico').length,
          alto: sev.filter((s) => s === 'alto').length,
          medio: sev.filter((s) => s === 'medio').length,
          bajo: sev.filter((s) => s === 'bajo').length,
        },
        historialDeLaSemana: entradas
          .filter((e) => e.id_agent === a.id_agent)
          // El detalle de un cambio de perfil trae el nombre y el correo del dueño:
          // no se le pasa a la IA (no lo necesita para el resumen).
          .map((e) => ({
            dia: diaColombia(e.occurred_at),
            tipo: e.kind,
            titulo: e.title,
            detalle: e.kind === 'perfil' ? null : e.detail,
          })),
      };
    }),
  };
}

export async function guardarResumenes(
  semana: string,
  items: { code: string; summary: string; model: string | null; inputHash: string | null }[]
) {
  const lunes = lunesDe(semana);
  const week = new Date(`${lunes}T00:00:00.000Z`);
  const agentes = await prisma.agent.findMany({
    where: { code: { in: items.map((i) => i.code) } },
    select: { id_agent: true, code: true },
  });
  const idPorCodigo = new Map(agentes.map((a) => [a.code.toLowerCase(), a.id_agent]));
  const guardados: string[] = [];
  const ignorados: string[] = [];
  for (const it of items) {
    const idAgent = idPorCodigo.get(it.code.toLowerCase());
    if (!idAgent) {
      ignorados.push(it.code);
      continue;
    }
    const data = { summary: it.summary, model: it.model, input_hash: it.inputHash, generated_at: new Date() };
    await prisma.agentCvSummary.upsert({
      where: { id_agent_week_start: { id_agent: idAgent, week_start: week } },
      create: { id_agent: idAgent, week_start: week, ...data },
      update: data,
    });
    guardados.push(it.code);
  }
  return { semana: lunes, guardados, ignorados };
}
