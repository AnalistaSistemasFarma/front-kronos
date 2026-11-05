/**
 * FORMACIÓN — preguntas y respuestas de un material (Nicolás Rivera, 2026-10-26).
 * Reglas puras: armado del hilo y validación del texto.
 */
export const MAX_TEXTO_PREGUNTA = 2000;

export interface PreguntaPlana {
  id: number;
  parent_id: number | null;
  email: string;
  nombre: string;
  texto: string;
  created_at: Date;
  eliminado_at: Date | null;
  likes: number;
  meGusta: boolean;
}

export interface PreguntaDto {
  id: number;
  nombre: string;
  esFormador: boolean;
  propia: boolean;
  texto: string;
  creadoEl: string;
  eliminada: boolean;
  likes: number;
  meGusta: boolean;
  respuestas: PreguntaDto[];
}

/** Valida y limpia el texto de una pregunta o respuesta. */
export function limpiarTexto(valor: unknown): { ok: true; texto: string } | { ok: false; error: string } {
  const texto = typeof valor === 'string' ? valor.replace(/\r\n/g, '\n').trim() : '';
  if (!texto) return { ok: false, error: 'Escriba su pregunta o comentario.' };
  if (texto.length > MAX_TEXTO_PREGUNTA) return { ok: false, error: `Máximo ${MAX_TEXTO_PREGUNTA} caracteres.` };
  return { ok: true, texto };
}

/**
 * Arma el hilo: preguntas de primer nivel (las más recientes primero) con sus
 * respuestas en orden cronológico. Una pregunta eliminada con respuestas se
 * conserva como «Comentario eliminado» para no romper la conversación.
 */
export function armarHilo(
  filas: PreguntaPlana[],
  correo: string,
  formadores: Set<string>
): PreguntaDto[] {
  const yo = correo.trim().toLowerCase();
  const dto = (f: PreguntaPlana): PreguntaDto => ({
    id: f.id,
    nombre: f.eliminado_at ? '' : f.nombre,
    esFormador: !f.eliminado_at && formadores.has(f.email.toLowerCase()),
    propia: f.email.toLowerCase() === yo,
    texto: f.eliminado_at ? 'Comentario eliminado' : f.texto,
    creadoEl: f.created_at.toISOString(),
    eliminada: Boolean(f.eliminado_at),
    likes: f.likes,
    meGusta: f.meGusta,
    respuestas: [],
  });
  const porId = new Map<number, PreguntaDto>();
  const raices: PreguntaDto[] = [];
  const ordenadas = [...filas].sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id - b.id);
  for (const f of ordenadas) porId.set(f.id, dto(f));
  for (const f of ordenadas) {
    const d = porId.get(f.id)!;
    if (f.parent_id && porId.has(f.parent_id)) porId.get(f.parent_id)!.respuestas.push(d);
    else if (!f.parent_id) raices.push(d);
  }
  // Las eliminadas sin respuestas vivas no se muestran.
  const vivas = (d: PreguntaDto): boolean => !d.eliminada || d.respuestas.some(vivas);
  return raices.filter(vivas).reverse();
}

/** «Hace 5 min», «Hace 3 días»… como en la referencia. */
export function haceCuanto(iso: string, ahora = Date.now()): string {
  const seg = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 1000));
  if (seg < 60) return 'Hace un momento';
  const min = Math.round(seg / 60);
  if (min < 60) return `Hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return h === 1 ? 'Hace 1 hora' : `Hace ${h} horas`;
  const d = Math.round(h / 24);
  if (d < 30) return d === 1 ? 'Hace 1 día' : `Hace ${d} días`;
  const m = Math.round(d / 30);
  if (m < 12) return m === 1 ? 'Hace 1 mes' : `Hace ${m} meses`;
  const a = Math.round(m / 12);
  return a === 1 ? 'Hace 1 año' : `Hace ${a} años`;
}
