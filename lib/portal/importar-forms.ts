/**
 * FORMACIÓN — IMPORTAR UN FORMULARIO DE MICROSOFT FORMS (Cristian Baldión, 2026-10-09).
 *
 * El servicio `importador-forms` (repo conector-directorio-th) abre el ENLACE PÚBLICO de un Forms con un
 * navegador y devuelve sus preguntas en bruto. Este archivo es PURO (sin red ni base): valida el enlace
 * y NORMALIZA lo que devuelve el servicio —que es dato de un tercero— a algo seguro y acotado antes de
 * llevarlo al constructor. Lo usan las rutas del servidor y el navegador.
 *
 * Qué se importa: título, descripción y las preguntas de texto corto, texto largo, fecha y selección
 * única (radios o lista desplegable). NO se importa: selección múltiple, escalas, clasificaciones ni
 * preguntas con ramificación; se informan como advertencias. Forms NO publica las respuestas
 * correctas: una evaluación importada llega sin ellas (borrador) y se marcan en el constructor.
 */
import { MAX_OPCIONES, MAX_PREGUNTAS, MAX_TEXTO_OPCION, MAX_TEXTO_PREGUNTA } from './formulario';

export const HOSTS_FORMS = ['forms.cloud.microsoft', 'forms.office.com', 'forms.microsoft.com'] as const;
export const MENSAJE_ENLACE_FORMS =
  'Escriba el enlace del formulario de Microsoft Forms (forms.cloud.microsoft, forms.office.com o forms.microsoft.com), con https.';

/** El enlace debe ser https, de Microsoft Forms, sin usuario ni contraseña. Devuelve la URL normalizada. */
export function validarEnlaceForms(texto: unknown): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof texto !== 'string') return { ok: false, error: MENSAJE_ENLACE_FORMS };
  const t = texto.trim();
  if (!t || t.length > 2000) return { ok: false, error: MENSAJE_ENLACE_FORMS };
  try {
    const u = new URL(t);
    if (u.protocol !== 'https:' || u.username || u.password) return { ok: false, error: MENSAJE_ENLACE_FORMS };
    if (!(HOSTS_FORMS as readonly string[]).includes(u.hostname.toLowerCase())) return { ok: false, error: MENSAJE_ENLACE_FORMS };
    return { ok: true, url: u.toString() };
  } catch {
    return { ok: false, error: MENSAJE_ENLACE_FORMS };
  }
}

export type TipoPreguntaImportada = 'texto' | 'texto_largo' | 'fecha' | 'seleccion';

export interface PreguntaImportada {
  texto: string;
  obligatoria: boolean;
  tipo: TipoPreguntaImportada;
  /** Solo `seleccion`. */
  opciones: string[];
}

export interface ImportacionForms {
  titulo: string;
  descripcion: string;
  preguntas: PreguntaImportada[];
  advertencias: string[];
}

const NOMBRE_TIPO: Record<string, string> = {
  multiple: 'selección múltiple',
  lista: 'lista desplegable',
  otro: 'escala, clasificación u otro tipo',
};

/** Sin caracteres de control, espacios colapsados. */
const limpiar = (v: unknown, max: number): string => {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
};

/** Forms numera las preguntas y a veces el autor también: "3. 1. Según…" → "Según…". */
export const sinNumeracion = (t: string): string => t.replace(/^\d{1,3}\s*[.)]\s*/, '');
/** Algunas opciones traen la letra escrita a mano: "d. Solo está prohibido…". */
export const sinLetra = (t: string): string => t.replace(/^[a-hA-H]\s*[.)]\s+/, '');

const corto = (t: string) => (t.length > 50 ? `${t.slice(0, 50)}…` : t);

/**
 * Lo que devuelve el servicio (datos de un tercero) → importación segura y acotada. Nunca lanza: lo que
 * no se puede importar se omite y queda en `advertencias`.
 */
export function normalizarImportacion(crudo: unknown): ImportacionForms {
  const d = (crudo && typeof crudo === 'object' ? crudo : {}) as Record<string, unknown>;
  const advertencias: string[] = [];
  const preguntas: PreguntaImportada[] = [];
  const lista = Array.isArray(d.preguntas) ? d.preguntas : [];

  if (d.variasPaginas === true) {
    advertencias.push('El formulario tiene varias páginas o secciones: solo se importó la primera página.');
  }
  if (lista.length > MAX_PREGUNTAS) advertencias.push(`Solo se importaron las primeras ${MAX_PREGUNTAS} preguntas.`);

  lista.slice(0, MAX_PREGUNTAS).forEach((cruda, i) => {
    const n = i + 1;
    const q = (cruda && typeof cruda === 'object' ? cruda : {}) as Record<string, unknown>;
    const texto = sinNumeracion(limpiar(q.titulo, 2000));
    if (!texto) return void advertencias.push(`Pregunta ${n}: no tiene enunciado; no se importó.`);
    if (texto.length > MAX_TEXTO_PREGUNTA) advertencias.push(`Pregunta ${n}: el enunciado se recortó a ${MAX_TEXTO_PREGUNTA} caracteres.`);
    const enunciado = texto.slice(0, MAX_TEXTO_PREGUNTA);
    const tipo = typeof q.tipo === 'string' ? q.tipo : 'otro';

    if (tipo === 'texto' || tipo === 'texto_largo' || tipo === 'fecha') {
      preguntas.push({ texto: enunciado, obligatoria: q.obligatoria === true, tipo, opciones: [] });
      return;
    }
    if (tipo === 'seleccion') {
      const vistas = new Set<string>();
      const opciones: string[] = [];
      let recortada = false;
      for (const o of Array.isArray(q.opciones) ? q.opciones : []) {
        const bruta = sinLetra(limpiar(o, 2000));
        if (!bruta) continue;
        const op = bruta.slice(0, MAX_TEXTO_OPCION);
        if (op !== bruta) recortada = true;
        if (vistas.has(op)) continue;
        vistas.add(op);
        opciones.push(op);
      }
      if (opciones.length === 0) return void advertencias.push(`Pregunta ${n} «${corto(enunciado)}»: no tiene opciones; no se importó.`);
      if (opciones.length > MAX_OPCIONES) advertencias.push(`Pregunta ${n}: solo se importaron las primeras ${MAX_OPCIONES} opciones.`);
      if (recortada) advertencias.push(`Pregunta ${n}: alguna opción se recortó a ${MAX_TEXTO_OPCION} caracteres.`);
      preguntas.push({ texto: enunciado, obligatoria: q.obligatoria === true, tipo: 'seleccion', opciones: opciones.slice(0, MAX_OPCIONES) });
      return;
    }
    advertencias.push(`Pregunta ${n} «${corto(enunciado)}»: es de tipo ${NOMBRE_TIPO[tipo] ?? NOMBRE_TIPO.otro} y no se puede importar; agréguela a mano si la necesita.`);
  });

  return {
    titulo: limpiar(d.titulo, 255),
    descripcion: limpiar(d.descripcion, 4000),
    preguntas,
    advertencias,
  };
}

/** Respuesta del servicio de importación (por trabajo). */
export interface EstadoImportacion {
  estado: 'en_curso' | 'listo' | 'error';
  /** 0 a 100. */
  progreso: number;
  etapa: string;
  resultado?: ImportacionForms;
  error?: string;
}
