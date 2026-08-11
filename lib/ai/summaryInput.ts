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
