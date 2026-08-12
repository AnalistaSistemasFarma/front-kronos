// Helper PURO para armar el texto que se envía a la API de resumen local
// (Summarizer API / Gemini Nano on-device). Sin dependencias de React, DOM ni
// red: recibe los datos de la solicitud y devuelve un único bloque de texto en
// español, con secciones etiquetadas, listo para pasar a `summarize()`.
//
// Se extrae aparte del componente cliente para poder probarlo como unidad pura
// (ver __tests__/summaryInput.test.ts) sin necesitar jsdom ni el navegador.

/** Campos mínimos de la solicitud que interesan para el resumen. */
export interface SummaryRequestInput {
  id?: number;
  subject?: string | null;
  description?: string | null;
}

/** Campos mínimos de una nota/interacción. */
export interface SummaryNoteInput {
  note?: string | null;
  createdBy?: string | null;
}

/** Campos mínimos de una tarea/actividad del flujo. */
export interface SummaryTaskInput {
  task?: string | null;
  description?: string | null;
  status?: string | null;
}

function clean(value: string | null | undefined): string {
  return (value ?? '').toString().trim();
}

/**
 * Construye el texto a resumir concatenando asunto, descripción, notas y tareas
 * de la solicitud en secciones legibles. Ignora los campos vacíos para no
 * ensuciar el resumen. Devuelve cadena vacía si no hay nada aprovechable.
 */
export function buildSummaryInput(
  request: SummaryRequestInput | null | undefined,
  notes: SummaryNoteInput[] = [],
  tasks: SummaryTaskInput[] = [],
): string {
  const bloques: string[] = [];

  const asunto = clean(request?.subject);
  if (asunto) {
    bloques.push(`Asunto: ${asunto}`);
  }

  const descripcion = clean(request?.description);
  if (descripcion) {
    bloques.push(`Descripción:\n${descripcion}`);
  }

  const notasTexto = (notes ?? [])
    .map((n) => {
      const cuerpo = clean(n?.note);
      if (!cuerpo) return '';
      const autor = clean(n?.createdBy);
      return autor ? `- (${autor}) ${cuerpo}` : `- ${cuerpo}`;
    })
    .filter(Boolean);
  if (notasTexto.length > 0) {
    bloques.push(`Historial de interacciones:\n${notasTexto.join('\n')}`);
  }

  const tareasTexto = (tasks ?? [])
    .map((t) => {
      const titulo = clean(t?.task);
      const detalle = clean(t?.description);
      const estado = clean(t?.status);
      const partes = [titulo, detalle].filter(Boolean).join(' — ');
      if (!partes) return '';
      return estado ? `- ${partes} [${estado}]` : `- ${partes}`;
    })
    .filter(Boolean);
  if (tareasTexto.length > 0) {
    bloques.push(`Tareas del flujo:\n${tareasTexto.join('\n')}`);
  }

  return bloques.join('\n\n').trim();
}

// ---------------------------------------------------------------------------
// Prompts para la Prompt API (LanguageModel / Gemini Nano on-device).
//
// A diferencia de la Summarizer API (extractiva, repite el texto), la Prompt
// API acepta un prompt con tono, lo que permite un resumen más humano y
// cercano. Se extraen aquí como constante + builder puro para poder probarlos
// sin navegador.
// ---------------------------------------------------------------------------

/** Instrucción de sistema: fija el tono cálido/humano del resumen. */
export const SUMMARY_SYSTEM_PROMPT =
  'Eres un asistente que le resume solicitudes internas a un equipo ' +
  'administrativo. Resume en español, en 2 a 4 frases, con un tono cálido, ' +
  'cercano y humano, como si le contaras a un compañero de qué se trata la ' +
  'solicitud, qué necesita la persona y en qué va. Interpreta la intención y ' +
  'el estado; NO copies el texto literal, NO uses viñetas ni encabezados. Sé ' +
  'claro, natural y breve.';

/**
 * Arma el prompt de usuario para la Prompt API a partir del texto ya
 * consolidado de la solicitud (el mismo que produce `buildSummaryInput`).
 */
export function buildSummaryPrompt(text: string): string {
  return `Resume esta solicitud de forma humana y cercana:\n\n${text}`;
}
