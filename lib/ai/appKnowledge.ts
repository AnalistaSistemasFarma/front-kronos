/**
 * Conocimiento curado de SynerLink + índice dinámico de procesos.
 * El modelo local NO puede “tragarse” todo el repo: usamos un mapa + guías
 * y recuperamos solo el trozo relevante por pregunta.
 */

export interface KnowledgeArticle {
  id: string;
  title: string;
  keywords: string[];
  /** Texto markdown (puede incluir mermaid). */
  body: string;
  /** Rutas relacionadas para navegar. */
  paths?: string[];
  /** Si aplica, sugiere acción ejecutable. */
  suggestAction?: 'create_ticket' | 'create_request' | 'resolve_request' | 'navigate';
}

/** Guías fijas: cómo funciona el producto (siempre disponibles). */
export const SYNERLINK_KNOWLEDGE: KnowledgeArticle[] = [
  {
    id: 'overview',
    title: 'Mapa de SynerLink',
    keywords: ['synerlink', 'mapa', 'que es', 'modulos', 'resumen', 'ayuda'],
    body: `## SynerLink — módulos principales

| Módulo | Para qué sirve |
| --- | --- |
| **Procesos** | Hub de subprocesos asignados a tu usuario |
| **Solicitudes generales** | Crear y seguir solicitudes (pago, legalización, etc.) |
| **Help Desk** | Casos / tickets de soporte |
| **Flujos / workflows** | Diseñar y ejecutar flujos por categoría-proceso |
| **Actividades / tareas** | Tareas dentro de una solicitud |
| **Dashboard personal** | Lo que te llega a gestionar |
| **Dashboard solicitudes** | Lo que tú pediste |

Puedes pedirme: *“¿cómo creo un ticket?”*, *“créame un caso…”*, *“¿cuántas solicitudes tengo?”*.`,
    paths: ['/process'],
  },
  {
    id: 'create-ticket',
    title: 'Cómo crear un caso / ticket (Help Desk)',
    keywords: [
      'ticket',
      'caso',
      'help desk',
      'mesa de ayuda',
      'como creo',
      'cómo creo',
      'crear ticket',
      'crear caso',
      'ven como',
    ],
    suggestAction: 'create_ticket',
    paths: ['/process/help-desk/create-ticket', '/process/help-desk/my-tickets'],
    body: `## Crear un caso (Help Desk)

Un **caso/ticket** es soporte (TI, chatbot, acceso, incidente). No confundir con una *solicitud* de procesos (pago, tesorería…).

### Pasos en la app
1. Entra a **Procesos → Help Desk → Crear ticket** (o *Mis tickets*).
2. Elige **empresa**, **categoría**, **subcategoría** y **actividad**.
3. Completa **asunto**, **descripción**, prioridad y técnico si aplica.
4. Guarda: se crea el caso y queda en seguimiento.

### Flujo

\`\`\`mermaid
flowchart LR
  A[Usuario] --> B[Crear ticket]
  B --> C[Categoría / subcategoría]
  C --> D[Asignar técnico]
  D --> E[Caso abierto]
  E --> F[Resolver / cerrar]
\`\`\`

### Con el asistente
Dime *“crea un caso: ayuda para mi chatbot, asígnalo a Juan”* y te armo el formulario para confirmar.`,
  },
  {
    id: 'create-request',
    title: 'Cómo crear una solicitud general',
    keywords: [
      'solicitud',
      'solicitudes',
      'pago',
      'tesoreria',
      'tesorería',
      'como creo solicitud',
      'crear solicitud',
      'procesos',
    ],
    suggestAction: 'create_request',
    paths: [
      '/process/request-general/create-request',
      '/process/request-general/general-requests',
    ],
    body: `## Crear una solicitud general

Las **solicitudes** viven en *Request General* (pagos, legalizaciones, compras internas, etc.).

### Pasos
1. **Procesos → Solicitudes generales → Crear / panel**.
2. Elige **empresa** y **proceso** (categoría-proceso).
3. Asunto + descripción (≥ 10 caracteres).
4. Adjunta archivos si el proceso los exige.
5. Enviar: queda en estado **Abierto** y notifica a responsables.

### Flujo

\`\`\`mermaid
flowchart TD
  A[Crear solicitud] --> B[Empresa + proceso]
  B --> C[Asunto y descripción]
  C --> D[Adjuntos / campos]
  D --> E[Solicitud abierta]
  E --> F[Gestión / tareas]
  F --> G[Resuelta o cancelada]
\`\`\`

### Con el asistente
*“crear solicitud de pago de tarjeta…”* → te preparo la solicitud para confirmar.`,
  },
  {
    id: 'workflows',
    title: 'Flujos / workflows y contratos',
    keywords: [
      'flujo',
      'flujos',
      'workflow',
      'workflows',
      'contrato',
      'contratos',
      'autorizacion',
      'autorización',
    ],
    paths: [
      '/process/request-general/workflows',
      '/process/request-general/view-workflows',
      '/process/request-general/admin-workflow',
      '/process/authorization',
    ],
    body: `## Flujos (workflows)

En SynerLink un **workflow** define el camino de un proceso: categorías, responsables, pasos y a veces formularios (p. ej. datos para contratos o autorizaciones).

### Dónde está
- **Workflows** / **Ver workflows**: listar y abrir un flujo.
- **Admin workflow**: administración de categorías y procesos del flujo.
- **Autorización**: aprobar / rechazar según el tipo de autorización.

### Cómo se usa (visión general)

\`\`\`mermaid
flowchart LR
  A[Definir categoría-proceso] --> B[Asignar responsables]
  B --> C[Solicitud entra al flujo]
  C --> D[Tareas / autorizaciones]
  D --> E[Cierre]
\`\`\`

Si me dices el **proceso concreto** (ej. contrato, legalización), te indico la ruta y, si aplica, te ayudo a **crear la solicitud** asociada.`,
  },
  {
    id: 'activities',
    title: 'Actividades y tareas',
    keywords: ['actividad', 'actividades', 'tarea', 'tareas', 'asignadas'],
    paths: [
      '/process/request-general/view-activities',
      '/process/request-general/assigned-activities',
    ],
    body: `## Actividades / tareas

Cada solicitud puede tener **tareas** (actividades) asignadas a personas.

- **Actividades asignadas**: lo que te toca ejecutar.
- Dentro de **ver solicitud**: panel de tareas, estados (sin empezar → abierto → resuelto).

Puedes preguntarme *“¿cuántas actividades tengo?”* en el dashboard personal, o abrir una solicitud por #id.`,
  },
  {
    id: 'dashboards',
    title: 'Dashboards',
    keywords: ['dashboard', 'tablero', 'personal', 'analitico', 'analítico'],
    paths: [
      '/process/request-general/dashboard-solicitado',
      '/process/request-general/dashboard-solicitante',
      '/dashboard/solicitudes',
    ],
    body: `## Dashboards

- **Dashboard personal (solicitado)**: lo que gestionas.
- **Dashboard solicitudes (solicitante)**: lo que pediste.
- **Dashboard Admin**: analítica global (requiere rol admin / subproceso de administración).

Pregúntame *“qué hay en mi dashboard personal”* y te resumo números reales.`,
  },
  {
    id: 'resolve',
    title: 'Cerrar / resolver una solicitud',
    keywords: ['resolver', 'resuelto', 'cerrar', 'cancelar', 'devolver'],
    suggestAction: 'resolve_request',
    paths: ['/process/request-general/view-request'],
    body: `## Resolver o cancelar

En la ficha de la solicitud (o con el asistente):

1. Indica el **#id**.
2. Estado: resuelto, cancelado o devolución.
3. Texto de resolución.
4. Opcional: correo al solicitante.

Ejemplo: *“pon la #2079 en resuelto y diga solucionado”*.`,
  },
];

export interface ProcessIndexEntry {
  process: string;
  subprocess: string;
  url?: string;
}

export function formatProcessIndex(entries: ProcessIndexEntry[], limit = 40): string {
  if (!entries.length) return '(Sin procesos cargados para tu usuario)';
  const lines = entries.slice(0, limit).map((e) => {
    const url = e.url ? ` → \`${e.url}\`` : '';
    return `- **${e.process}** / ${e.subprocess}${url}`;
  });
  if (entries.length > limit) {
    lines.push(`_…y ${entries.length - limit} más_`);
  }
  return ['## Procesos disponibles para ti', ...lines].join('\n');
}

/** Score simple por keywords en el mensaje. */
export function scoreArticle(article: KnowledgeArticle, query: string): number {
  const q = query
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  let score = 0;
  for (const kw of article.keywords) {
    const k = kw
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '');
    if (q.includes(k)) score += k.length > 4 ? 3 : 2;
  }
  if (q.includes(article.id.replace(/-/g, ' '))) score += 2;
  return score;
}

export function retrieveKnowledge(
  query: string,
  opts?: { processIndex?: ProcessIndexEntry[]; limit?: number },
): { articles: KnowledgeArticle[]; markdown: string } {
  const limit = opts?.limit ?? 2;
  const ranked = [...SYNERLINK_KNOWLEDGE]
    .map((a) => ({ a, s: scoreArticle(a, query) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s);

  let articles = ranked.slice(0, limit).map((x) => x.a);
  if (articles.length === 0) {
    articles = [SYNERLINK_KNOWLEDGE[0]!];
  }

  const parts = articles.map((a) => `### ${a.title}\n\n${a.body}`);
  if (opts?.processIndex?.length) {
    const wantsProcess =
      /\b(proceso|procesos|flujo|modulo|módulo|donde|ruta)\b/i.test(query) ||
      articles.some((a) => a.id === 'overview' || a.id === 'workflows');
    if (wantsProcess) {
      parts.push(formatProcessIndex(opts.processIndex, 25));
    }
  }

  return { articles, markdown: parts.join('\n\n---\n\n') };
}

/**
 * Construye índice desde la respuesta de /api/processes (misma forma que ProcessDataContext).
 */
export function buildProcessIndexFromApi(data: unknown): ProcessIndexEntry[] {
  if (!Array.isArray(data)) return [];
  const out: ProcessIndexEntry[] = [];
  for (const proc of data) {
    const p = proc as {
      process?: string;
      subprocesses?: Array<{ subprocess?: string; subprocess_url?: string }>;
    };
    const name = p.process || 'Proceso';
    for (const sub of p.subprocesses ?? []) {
      out.push({
        process: name,
        subprocess: sub.subprocess || 'Subproceso',
        url: sub.subprocess_url,
      });
    }
  }
  return out;
}
