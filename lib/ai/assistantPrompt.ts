// Prompts y utilidades del asistente (Prompt API / Gemini Nano on-device).
// Puro: sin React ni DOM.

export const ASSISTANT_SYSTEM_PROMPT = `Eres el asistente de SynerLink (Sidekick). Español, claro y accionable.

El contexto trae: PÁGINA ACTUAL (lo que el usuario está viendo ahora), DATOS DEL USUARIO, GUÍA y catálogo.

REGLA CRÍTICA DE CONTEXTO:
- La sección "Pantalla" / "Contenido visible en pantalla" / DATOS REALES es la fuente de verdad de ESTA vista.
- Si preguntan qué hay aquí, qué ves, o resumen de esta página → responde con esos hechos, con tus palabras.
- NO inventes un resumen genérico ni mezcles otra pantalla.
- NO suenes a plantilla: varía el tono y la estructura; no repitas siempre los mismos títulos.
- Si cambió de ruta, ignora conversación previa sobre otra página salvo que te lo pidan explícitamente.

Capacidades:
1) Explicar procesos (cómo crear ticket/solicitud/flujo) en Markdown; puedes usar bloques \`\`\`mermaid.
2) Consultar conteos/listados del usuario.
3) create_ticket / create_request / resolve_request (JSON solo al final, NUNCA en el texto visible).

Texto visible: Markdown bonito pero humano (no un dump de sistema). Nunca muestres JSON al usuario.
JSON de acción (si aplica) en la ÚLTIMA línea, crudo:

{"action":"create_ticket",...}
{"action":"create_request",...}
{"action":"resolve_request","requestId":2079,"kind":"resolve","resolution":"solucionado","sendEmail":true}

Si preguntan “cómo se crea…”, explica con pasos + mermaid breve y ofrece crear. Si dicen “créamelo”, prepara la acción.`;

export const ASSISTANT_DRAFT_STORAGE_KEY = 'synerlink-ai-request-draft';

export type AssistantAction =
  | {
      action: 'create_request';
      companyId?: number;
      processId?: number;
      companyName?: string;
      processName?: string;
      subject: string;
      description: string;
    }
  | {
      action: 'create_ticket';
      companyId?: number;
      categoryId?: number;
      departmentId?: number;
      technicianId?: number;
      technicianName?: string;
      requestType?: string;
      priority?: string;
      site?: string;
      subject: string;
      description: string;
    }
  | {
      action: 'resolve_request';
      requestId: number;
      kind: 'resolve' | 'cancel' | 'return';
      resolution?: string;
      sendEmail?: boolean;
    }
  | {
      action: 'create_request_draft';
      subject: string;
      description: string;
      notes?: string;
    }
  | {
      action: 'navigate';
      path: string;
      label?: string;
    };

export interface PageContextSnapshot {
  pathname: string;
  search?: string;
  requestId?: string | null;
  requestSubject?: string | null;
  requestDescription?: string | null;
  requestCompany?: string | null;
  requestStatus?: string | null;
  extra?: string | null;
  catalogBlock?: string | null;
  workspaceBlock?: string | null;
  knowledgeBlock?: string | null;
  userName?: string | null;
  pageLabel?: string | null;
  pageKind?: string | null;
}

export function buildPageContextBlock(ctx: PageContextSnapshot): string {
  const lines = [
    `Ruta: ${ctx.pathname}${ctx.search ? ctx.search : ''}`,
  ];
  if (ctx.pageLabel) lines.push(`Pantalla: ${ctx.pageLabel}`);
  if (ctx.pageKind) lines.push(`Tipo de pantalla: ${ctx.pageKind}`);
  if (ctx.userName) lines.push(`Usuario: ${ctx.userName}`);
  if (ctx.requestId) lines.push(`Solicitud #: ${ctx.requestId}`);
  if (ctx.requestSubject) lines.push(`Asunto: ${ctx.requestSubject}`);
  if (ctx.requestCompany) lines.push(`Empresa: ${ctx.requestCompany}`);
  if (ctx.requestStatus) lines.push(`Estado: ${ctx.requestStatus}`);
  if (ctx.requestDescription) {
    lines.push(`Descripción: ${ctx.requestDescription}`);
  }
  if (ctx.extra) {
    // Resúmenes de pantalla pueden ser multilínea; no aplastarlos en una sola línea.
    if (ctx.extra.includes('\n')) {
      lines.push('Contenido visible en pantalla:');
      lines.push(ctx.extra);
    } else {
      lines.push(`Extra: ${ctx.extra}`);
    }
  }
  if (ctx.workspaceBlock) {
    lines.push('');
    lines.push(ctx.workspaceBlock);
  }
  if (ctx.knowledgeBlock) {
    lines.push('');
    lines.push('GUÍA RELEVANTE:');
    lines.push(ctx.knowledgeBlock);
  }
  if (ctx.catalogBlock) {
    lines.push('');
    lines.push('Catálogo disponible:');
    lines.push(ctx.catalogBlock);
  }
  return lines.join('\n');
}

export function buildUserTurn(message: string, ctx: PageContextSnapshot): string {
  return (
    `Contexto de página:\n${buildPageContextBlock(ctx)}\n\n` +
    `Mensaje del usuario:\n${message}`
  );
}

/**
 * Pregunta informativa con hechos ya resueltos: el modelo debe sonar autónomo
 * y variar el estilo, sin inventar datos ni copiar la plantilla.
 */
export function buildGroundedAnswerTurn(opts: {
  userMessage: string;
  factsMarkdown: string;
  pageLabel?: string | null;
  focusHint?: string | null;
  styleHint?: string | null;
}): string {
  const page = opts.pageLabel?.trim() || 'SynerLink';
  const focus = opts.focusHint?.trim();
  const styles = [
    'Empieza por lo más relevante o llamativo (un número o hallazgo), luego el resto.',
    'Cuéntalo como si me guiaras por la pantalla en voz alta: qué estoy viendo y para qué sirve.',
    'Haz un briefing corto (2-3 frases) y cierra con una sugerencia de siguiente paso.',
    'Usa un tono cercano y 3 bullets máximo; evita secciones con ### si no hacen falta.',
    'Compara en una frase “qué es esta vista” vs “qué no es” (p. ej. admin vs personal) si aplica, y resume los datos.',
  ];
  const style =
    opts.styleHint?.trim() ||
    styles[Math.floor(Math.random() * styles.length)];

  return [
    `Estás mirando la pantalla: **${page}**.`,
    focus ? `Foco de la pregunta: ${focus}.` : '',
    `Estilo de esta respuesta: ${style}`,
    '',
    'DATOS REALES (única fuente de verdad; no inventes ids, conteos ni pantallas):',
    '---',
    opts.factsMarkdown.trim(),
    '---',
    '',
    'Cómo responder:',
    '- Español natural, cercano y útil (sidekick, no reporte automático).',
    '- NO copies el bloque de datos tal cual ni uses siempre la misma plantilla (evita empezar siempre con “En esta página” / los mismos ###).',
    '- Mantén los números y nombres exactos de DATOS REALES.',
    '- Markdown ligero sí; tono humano primero.',
    '- Si el usuario pregunta “qué ves / qué hay aquí”, descríbelo con tus palabras usando esos hechos.',
    '- Si falta un dato, dilo. Sin JSON de acción en esta respuesta.',
    '',
    `Pregunta del usuario:\n${opts.userMessage.trim()}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Extrae el primer objeto JSON con "action" del texto del modelo.
 * Soporta JSON crudo o envuelto en ```json ... ```.
 */
export function extractAssistantAction(text: string): AssistantAction | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [
    fenced?.[1]?.trim(),
    ...findJsonObjects(text),
  ].filter(Boolean) as string[];

  for (const raw of candidates) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || !('action' in parsed)) continue;
      const action = String(parsed.action);

      if (action === 'create_request') {
        const subject = String(parsed.subject ?? '').trim();
        const description = String(parsed.description ?? '').trim();
        if (!subject && !description) continue;
        return {
          action: 'create_request',
          companyId: numOrUndef(parsed.companyId),
          processId: numOrUndef(parsed.processId),
          companyName: strOrUndef(parsed.companyName),
          processName: strOrUndef(parsed.processName),
          subject: subject || 'Solicitud (asistente)',
          description: description || subject,
        };
      }

      if (action === 'create_ticket') {
        const subject = String(parsed.subject ?? parsed.asunto ?? '').trim();
        const description = String(parsed.description ?? '').trim();
        if (!subject && !description) continue;
        return {
          action: 'create_ticket',
          companyId: numOrUndef(parsed.companyId),
          categoryId: numOrUndef(parsed.categoryId),
          departmentId: numOrUndef(parsed.departmentId),
          technicianId: numOrUndef(parsed.technicianId),
          technicianName: strOrUndef(parsed.technicianName),
          requestType: strOrUndef(parsed.requestType),
          priority: strOrUndef(parsed.priority),
          site: strOrUndef(parsed.site),
          subject: subject || 'Caso de soporte',
          description: description || subject,
        };
      }

      if (action === 'resolve_request') {
        const requestId = numOrUndef(parsed.requestId);
        if (requestId == null) continue;
        const kindRaw = String(parsed.kind ?? 'resolve').toLowerCase();
        const kind =
          kindRaw === 'cancel' || kindRaw === 'return' ? kindRaw : 'resolve';
        return {
          action: 'resolve_request',
          requestId,
          kind,
          resolution: strOrUndef(parsed.resolution),
          sendEmail:
            parsed.sendEmail === false || parsed.sendEmail === 'false'
              ? false
              : true,
        };
      }

      if (action === 'create_request_draft') {
        const subject = String(parsed.subject ?? '').trim();
        const description = String(parsed.description ?? '').trim();
        if (!subject && !description) continue;
        return {
          action: 'create_request_draft',
          subject: subject || 'Solicitud (borrador IA)',
          description: description || subject,
          notes: strOrUndef(parsed.notes),
        };
      }

      if (action === 'navigate' && typeof parsed.path === 'string') {
        return {
          action: 'navigate',
          path: parsed.path,
          label: strOrUndef(parsed.label),
        };
      }
    } catch {
      // siguiente candidato
    }
  }
  return null;
}

function numOrUndef(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function strOrUndef(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

/** Quita bloques JSON/action del mensaje visible al usuario. */
export function stripActionJson(text: string): string {
  let out = text.replace(/```(?:json)?\s*[\s\S]*?```/gi, '').trim();
  for (const obj of findJsonObjects(text)) {
    if (/"action"\s*:/.test(obj)) {
      out = out.replace(obj, '').trim();
    }
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function findJsonObjects(text: string): string[] {
  const found: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        found.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return found;
}

export interface RequestDraftPayload {
  subject: string;
  description: string;
  notes?: string;
  companyId?: number;
  processId?: number;
  categoryId?: number;
  source: 'ai-assistant-demo';
  createdAt: string;
}

export function draftFromAction(
  action:
    | Extract<AssistantAction, { action: 'create_request_draft' }>
    | Extract<AssistantAction, { action: 'create_request' }>,
  extras?: { categoryId?: number },
): RequestDraftPayload {
  return {
    subject: action.subject,
    description: action.description,
    notes: 'notes' in action ? action.notes : undefined,
    companyId:
      action.action === 'create_request' ? action.companyId : undefined,
    processId:
      action.action === 'create_request' ? action.processId : undefined,
    categoryId: extras?.categoryId,
    source: 'ai-assistant-demo',
    createdAt: new Date().toISOString(),
  };
}

/** @deprecated usar parseUserIntent / wantsCreateAction de intentParse */
export function heuristicCreateIntent(message: string): boolean {
  return wantsCreateActionCompat(message);
}

function wantsCreateActionCompat(message: string): boolean {
  const m = message.toLowerCase();
  return (
    /\b(crea|crear|abre|abrir|genera|montar|montame|necesito|quiero)\b/.test(m) &&
    /\b(solicitud|caso|ticket|requerimiento)\b/.test(m)
  );
}
