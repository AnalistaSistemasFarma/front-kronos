import "server-only";
import { sql, withMssqlPool } from "../mssqlPool";
import { prisma } from "../prisma";
import { agentInScope, type AuditScope } from "../chat/audit-access";
import {
  normalizarTipo,
  type MapAgentDto,
  type MapLinkDto,
  type MapMemoryDto,
  type MemoriesPayload,
  type MemoryDetailDto,
  type MemoryMap,
  type MemoryMapDto,
} from "./memories";

/**
 * MEMORIAS DE LOS AGENTES — parte que toca la base. Tablas en
 * prisma/manual/2026-10-29-memorias-agentes-*.sql, sin modelo Prisma (mismo
 * patrón que chat_agent_context): el pase no exige `prisma generate` y, si las
 * tablas no existen, la lectura avisa «aún no habilitado» y el POST da 503.
 */

export class MemoriasNoDisponibles extends Error {
  constructor() {
    super(
      "Las memorias de los agentes aún no están habilitadas en este ambiente.",
    );
  }
}

function esTablaAusente(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { number?: number }).number === 208
  );
}

async function conTablas<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (esTablaAusente(error)) throw new MemoriasNoDisponibles();
    throw error;
  }
}

type Fila = Record<string, unknown>;
const iso = (v: unknown): string | null =>
  v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString() : null;
const normEmail = (e: string) => e.trim().toLowerCase();

interface Ajuste {
  department: string | null;
  owner: string | null;
}

async function leerAjustes(): Promise<Map<number, Ajuste>> {
  const r = await withMssqlPool((pool) =>
    pool
      .request()
      .query(
        `SELECT id_agent, department, private_owner_email FROM dbo.agent_memory_setting`,
      ),
  );
  const m = new Map<number, Ajuste>();
  for (const f of r.recordset as Fila[]) {
    m.set(Number(f.id_agent), {
      department: f.department ? String(f.department) : null,
      owner: f.private_owner_email
        ? normEmail(String(f.private_owner_email))
        : null,
    });
  }
  return m;
}

/** ¿Este correo tiene agentes personales? (para mostrar la pestaña). */
export async function tieneMapaPersonal(email: string): Promise<boolean> {
  return conTablas(async () => {
    const ajustes = await leerAjustes();
    const yo = normEmail(email);
    return [...ajustes.values()].some((a) => a.owner === yo);
  });
}

/**
 * Agentes que entran en un mapa para ese usuario.
 *   general  → activos, dentro del alcance de auditoría; los personales solo
 *              para su dueño.
 *   personal → los personales cuyo dueño es ese correo (sin mirar el alcance:
 *              son suyos y de nadie más).
 */
async function agentesDelMapa(
  mapa: MemoryMap,
  email: string,
  alcance: AuditScope | null,
  ajustes: Map<number, Ajuste>,
): Promise<MapAgentDto[]> {
  const yo = normEmail(email);
  const agentes = await prisma.agent.findMany({
    where: { is_active: true },
    select: {
      id_agent: true,
      code: true,
      display_name: true,
      companies: {
        select: {
          id_company: true,
          is_primary: true,
          company: { select: { company: true } },
        },
      },
    },
    orderBy: [{ sort_order: "asc" }, { display_name: "asc" }],
  });
  return agentes
    .filter((a) => {
      const owner = ajustes.get(a.id_agent)?.owner ?? null;
      if (mapa === "personal") return owner === yo;
      // General: todo lo del alcance. Los agentes personales solo para su
      // dueño (Nicolás, 2026-10-29: «el general debe mostrar todo de todos»).
      if (owner !== null) return owner === yo;
      return alcance !== null && agentInScope(alcance, a.id_agent);
    })
    .map((a) => {
      const principal =
        a.companies.find((c) => c.is_primary) ?? a.companies[0] ?? null;
      return {
        idAgent: a.id_agent,
        code: a.code,
        displayName: a.display_name,
        companyId: principal?.id_company ?? null,
        companyName: principal?.company.company.trim() ?? null,
        department: ajustes.get(a.id_agent)?.department ?? null,
      };
    });
}

export async function leerMapa(
  mapa: MemoryMap,
  email: string,
  alcance: AuditScope | null,
): Promise<MemoryMapDto> {
  return conTablas(async () => {
    const ajustes = await leerAjustes();
    const yo = normEmail(email);
    const tienePersonal = [...ajustes.values()].some((a) => a.owner === yo);
    const agentes = await agentesDelMapa(mapa, email, alcance, ajustes);
    const ids = JSON.stringify(agentes.map((a) => a.idAgent));

    const r = await withMssqlPool((pool) =>
      pool.request().input("ids", sql.NVarChar(sql.MAX), ids).query(`
        DECLARE @a TABLE (id_agent INT PRIMARY KEY);
        INSERT INTO @a SELECT DISTINCT CAST([value] AS INT) FROM OPENJSON(@ids);

        SELECT m.id_memory, m.id_agent, m.title, m.mem_type, m.topic, m.source_updated_at
        FROM dbo.agent_memory m JOIN @a a ON a.id_agent = m.id_agent
        WHERE m.deleted_at IS NULL;

        SELECT l.id_from, l.id_to, l.relation
        FROM dbo.agent_memory_link l
        JOIN dbo.agent_memory f ON f.id_memory = l.id_from AND f.deleted_at IS NULL
        JOIN dbo.agent_memory t ON t.id_memory = l.id_to AND t.deleted_at IS NULL
        WHERE f.id_agent IN (SELECT id_agent FROM @a) AND t.id_agent IN (SELECT id_agent FROM @a);

        SELECT ISNULL(SUM(m.secrets_hidden), 0) AS ocultos
        FROM dbo.agent_memory m JOIN @a a ON a.id_agent = m.id_agent WHERE m.deleted_at IS NULL;

        SELECT MAX(finished_at) AS ultima FROM dbo.agent_memory_run;
      `),
    );
    const sets = r.recordsets as unknown as Fila[][];
    const memorias: MapMemoryDto[] = (sets[0] ?? []).map((f) => ({
      id: Number(f.id_memory),
      idAgent: Number(f.id_agent),
      title: String(f.title ?? ""),
      type: normalizarTipo(f.mem_type),
      topic: f.topic ? String(f.topic) : null,
      updatedAt: iso(f.source_updated_at),
    }));
    const enlaces: MapLinkDto[] = (sets[1] ?? []).map((f) => ({
      from: Number(f.id_from),
      to: Number(f.id_to),
      relation: String(f.relation ?? "related"),
    }));
    return {
      mapa,
      agentes,
      memorias,
      enlaces,
      secretosOcultos: Number(sets[2]?.[0]?.ocultos ?? 0),
      ultimaRecoleccion: iso(sets[3]?.[0]?.ultima),
      tieneMapaPersonal: tienePersonal,
    };
  });
}

/**
 * Detalle de una memoria con su contenido. Devuelve null si no existe o si el
 * usuario no la puede ver (la ruta responde 404 en ambos casos, sin pistas).
 */
export async function leerDetalle(
  idMemory: number,
  email: string,
  alcance: AuditScope | null,
): Promise<MemoryDetailDto | null> {
  return conTablas(async () => {
    const r = await withMssqlPool((pool) =>
      pool.request().input("id", sql.BigInt, idMemory).query(`
        SELECT m.id_memory, m.id_agent, m.source, m.title, m.content, m.mem_type, m.topic,
               m.source_created_at, m.source_updated_at, m.secrets_hidden, s.private_owner_email
        FROM dbo.agent_memory m
        LEFT JOIN dbo.agent_memory_setting s ON s.id_agent = m.id_agent
        WHERE m.id_memory = @id AND m.deleted_at IS NULL;
      `),
    );
    const f = (r.recordset as Fila[])[0];
    if (!f) return null;
    const idAgent = Number(f.id_agent);
    const owner = f.private_owner_email
      ? normEmail(String(f.private_owner_email))
      : null;
    const permitido =
      owner !== null
        ? owner === normEmail(email)
        : alcance !== null && agentInScope(alcance, idAgent);
    if (!permitido) return null;
    return {
      id: Number(f.id_memory),
      idAgent,
      title: String(f.title ?? ""),
      type: normalizarTipo(f.mem_type),
      topic: f.topic ? String(f.topic) : null,
      updatedAt: iso(f.source_updated_at),
      createdAt: iso(f.source_created_at),
      content: f.content ? String(f.content) : null,
      source: String(f.source ?? ""),
      secretsHidden: Number(f.secrets_hidden ?? 0),
    };
  });
}

export interface ResultadoRecoleccion {
  agentes: number;
  memorias: number;
  enlaces: number;
  retiradas: number;
  desconocidos: string[];
}

/**
 * Guarda lo que publicó el recolector para un equipo. Por cada agente y origen:
 * inserta o actualiza sus memorias, marca como retiradas (deleted_at) las que ya
 * no vienen y reemplaza sus enlaces. Solo agentes ya registrados en SynerLink.
 */
export async function guardarMemorias(
  p: MemoriesPayload,
  ahora = new Date(),
): Promise<ResultadoRecoleccion> {
  return conTablas(async () => {
    const codigos = [...new Set(p.agents.map((a) => a.code))];
    const registrados = await prisma.agent.findMany({
      where: { code: { in: codigos } },
      select: { id_agent: true, code: true },
    });
    const idPorCodigo = new Map(
      registrados.map((a) => [a.code.toLowerCase(), a.id_agent]),
    );
    const res: ResultadoRecoleccion = {
      agentes: 0,
      memorias: 0,
      enlaces: 0,
      retiradas: 0,
      desconocidos: [],
    };
    let ocultos = 0;

    for (const a of p.agents) {
      const idAgent = idPorCodigo.get(a.code);
      if (idAgent === undefined) {
        res.desconocidos.push(a.code);
        continue;
      }
      const mems = JSON.stringify(
        a.memories.map((m) => ({
          k: m.sourceKey,
          t: m.title,
          c: m.content,
          y: m.type,
          p: m.topic,
          cr: m.createdAt?.toISOString() ?? null,
          up: m.updatedAt?.toISOString() ?? null,
          s: m.secretsHidden,
        })),
      );
      const links = JSON.stringify(
        a.links.map((l) => ({ f: l.from, t: l.to, r: l.relation })),
      );
      const r = await withMssqlPool((pool) =>
        pool
          .request()
          .input("id_agent", sql.Int, idAgent)
          .input("source", sql.NVarChar(20), a.source)
          .input("mems", sql.NVarChar(sql.MAX), mems)
          .input("links", sql.NVarChar(sql.MAX), links)
          .input("ahora", sql.DateTime2(0), ahora).query(`
            SET XACT_ABORT ON;
            BEGIN TRAN;
            DECLARE @m TABLE (k NVARCHAR(200) PRIMARY KEY, t NVARCHAR(400), c NVARCHAR(MAX), y NVARCHAR(40),
                              p NVARCHAR(200), cr DATETIME2(0), up DATETIME2(0), s INT);
            INSERT INTO @m
            SELECT k, t, c, y, p, CAST(cr AS DATETIME2(0)), CAST(up AS DATETIME2(0)), ISNULL(s, 0)
            FROM OPENJSON(@mems) WITH (k NVARCHAR(200) '$.k', t NVARCHAR(400) '$.t', c NVARCHAR(MAX) '$.c',
                 y NVARCHAR(40) '$.y', p NVARCHAR(200) '$.p', cr NVARCHAR(40) '$.cr', up NVARCHAR(40) '$.up', s INT '$.s');

            UPDATE d SET title = m.t, content = m.c, mem_type = m.y, topic = m.p, source_created_at = m.cr,
                   source_updated_at = m.up, secrets_hidden = m.s, collected_at = @ahora, deleted_at = NULL
            FROM dbo.agent_memory d JOIN @m m ON m.k = d.source_key
            WHERE d.id_agent = @id_agent AND d.source = @source;

            INSERT INTO dbo.agent_memory (id_agent, source, source_key, title, content, mem_type, topic,
                   source_created_at, source_updated_at, secrets_hidden, collected_at)
            SELECT @id_agent, @source, m.k, m.t, m.c, m.y, m.p, m.cr, m.up, m.s, @ahora
            FROM @m m
            WHERE NOT EXISTS (SELECT 1 FROM dbo.agent_memory d
                              WHERE d.id_agent = @id_agent AND d.source = @source AND d.source_key = m.k);

            UPDATE dbo.agent_memory SET deleted_at = @ahora
            WHERE id_agent = @id_agent AND source = @source AND deleted_at IS NULL
              AND source_key NOT IN (SELECT k FROM @m);
            DECLARE @retiradas INT = @@ROWCOUNT;

            DELETE l FROM dbo.agent_memory_link l
            JOIN dbo.agent_memory d ON d.id_memory = l.id_from
            WHERE d.id_agent = @id_agent AND d.source = @source;

            INSERT INTO dbo.agent_memory_link (id_from, id_to, relation, collected_at)
            SELECT DISTINCT f.id_memory, t.id_memory, j.r, @ahora
            FROM OPENJSON(@links) WITH (f NVARCHAR(200) '$.f', t NVARCHAR(200) '$.t', r NVARCHAR(40) '$.r') j
            JOIN dbo.agent_memory f ON f.id_agent = @id_agent AND f.source = @source AND f.source_key = j.f
            JOIN dbo.agent_memory t ON t.id_agent = @id_agent AND t.source = @source AND t.source_key = j.t
            WHERE f.id_memory <> t.id_memory;
            DECLARE @enlaces INT = @@ROWCOUNT;

            COMMIT TRAN;
            SELECT @retiradas AS retiradas, @enlaces AS enlaces;
          `),
      );
      const fila = (r.recordset as Fila[])[0] ?? {};
      res.agentes += 1;
      res.memorias += a.memories.length;
      res.enlaces += Number(fila.enlaces ?? 0);
      res.retiradas += Number(fila.retiradas ?? 0);
      ocultos += a.memories.reduce((s, m) => s + m.secretsHidden, 0);
    }

    const errores = [
      ...p.errors,
      ...res.desconocidos.map((c) => `Agente no registrado en SynerLink: ${c}`),
    ]
      .join(" · ")
      .slice(0, 2000);
    await withMssqlPool((pool) =>
      pool
        .request()
        .input("host", sql.NVarChar(120), p.host)
        .input("agents", sql.Int, res.agentes)
        .input("memories", sql.Int, res.memorias)
        .input("links", sql.Int, res.enlaces)
        .input("ocultos", sql.Int, ocultos)
        .input("errors", sql.NVarChar(2000), errores || null)
        .input("ver", sql.NVarChar(20), p.collectorVersion)
        .input("ahora", sql.DateTime2(0), ahora).query(`
          INSERT INTO dbo.agent_memory_run (host, agents, memories, links, secrets_hidden, errors, collector_version, finished_at)
          VALUES (@host, @agents, @memories, @links, @ocultos, @errors, @ver, @ahora);
        `),
    );
    return res;
  });
}
