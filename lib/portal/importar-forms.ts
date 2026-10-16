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

export type TipoPreguntaImportada = 'texto' | 'texto_largo' | 'fecha' | 'seleccion' | 'seleccion_multiple';

export interface PreguntaImportada {
  texto: string;
  obligatoria: boolean;
  tipo: TipoPreguntaImportada;
  /** Solo `seleccion` y `seleccion_multiple`. */
  opciones: string[];
  /** Solo `seleccion`: en Forms era una lista desplegable (se conserva como tal). */
  lista?: boolean;
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

/**
 * MARCADORES DE LISTA escritos a mano por el autor del Forms ("1. Según…", "a) Sí", "d. Solo…").
 *
 * Solo se quitan cuando es CLARO que son una lista: todos los textos los traen y van en secuencia
 * (1, 2, 3… o a, b, c…). Nunca se toca un decimal ("1.5 mg", "0.9 % NaCl") ni una abreviatura
 * ("E. coli", "B. Braun"): un texto de laboratorio mal recortado cambia el sentido de la pregunta.
 */
/** "1. ", "2) ", "7.¿…" — el punto NO puede ir seguido de un dígito (decimales). */
const MARCA_NUMERO = /^(\d{1,3})(?:\)\s*|\.(?!\d)\s*)(?=\S)/;
/** "a. ", "b) " — tras el punto exige espacio ("E.coli" no es marcador). */
const MARCA_LETRA = /^([a-zA-Z])(?:\)\s*|\.\s+)(?=\S)/;

const LETRAS = 'abcdefghijklmnopqrstuvwxyz';

/**
 * Opciones de UNA pregunta: quita la letra o el número de cada opción solo si TODAS lo traen y van en
 * secuencia desde el principio (a, b, c… en minúscula o en mayúscula, o 1, 2, 3…). Si no, las deja igual.
 */
export function sinMarcadoresDeOpciones(opciones: string[]): string[] {
  if (opciones.length < 2) return opciones;
  const letras = opciones.map((o) => MARCA_LETRA.exec(o));
  if (letras.every(Boolean)) {
    const ls = letras.map((m) => m![1]);
    const minus = ls.every((l) => l === l.toLowerCase());
    const mayus = ls.every((l) => l === l.toUpperCase());
    if ((minus || mayus) && ls.every((l, i) => l.toLowerCase() === LETRAS[i])) {
      return opciones.map((o, i) => o.slice(letras[i]![0].length));
    }
  }
  const numeros = opciones.map((o) => MARCA_NUMERO.exec(o));
  if (numeros.every(Boolean) && numeros.every((m, i) => Number(m![1]) === i + 1)) {
    return opciones.map((o, i) => o.slice(numeros[i]![0].length));
  }
  return opciones;
}

/**
 * Enunciados de TODO el formulario: quita la numeración del autor solo si las preguntas numeradas son al
 * menos dos y van 1, 2, 3… en orden (las que no traen número, como "Nombre Completo", no cuentan).
 */
export function sinNumeracionDePreguntas(titulos: string[]): string[] {
  const marcas = titulos.map((t) => MARCA_NUMERO.exec(t));
  const numeradas = marcas.filter(Boolean) as RegExpExecArray[];
  if (numeradas.length < 2 || !numeradas.every((m, i) => Number(m[1]) === i + 1)) return titulos;
  return titulos.map((t, i) => (marcas[i] ? t.slice(marcas[i]![0].length) : t));
}

/** ¿La opción i trae una letra que coincide con su posición ("d." en la cuarta) aunque las demás no? */
const pareceLetraSuelta = (o: string, i: number) => {
  const m = MARCA_LETRA.exec(o);
  return !!m && m[1].toLowerCase() === LETRAS[i];
};

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

  const crudas = lista.slice(0, MAX_PREGUNTAS).map((c) => (c && typeof c === 'object' ? c : {}) as Record<string, unknown>);
  const titulos = sinNumeracionDePreguntas(crudas.map((q) => limpiar(q.titulo, 2000)));

  crudas.forEach((q, i) => {
    const n = i + 1;
    const texto = titulos[i];
    if (!texto) return void advertencias.push(`Pregunta ${n}: no tiene enunciado; no se importó.`);
    if (texto.length > MAX_TEXTO_PREGUNTA) advertencias.push(`Pregunta ${n}: el enunciado se recortó a ${MAX_TEXTO_PREGUNTA} caracteres.`);
    const enunciado = texto.slice(0, MAX_TEXTO_PREGUNTA);
    const tipo = typeof q.tipo === 'string' ? q.tipo : 'otro';

    if (tipo === 'texto' || tipo === 'texto_largo' || tipo === 'fecha') {
      preguntas.push({ texto: enunciado, obligatoria: q.obligatoria === true, tipo, opciones: [] });
      return;
    }
    if (tipo === 'seleccion' || tipo === 'multiple') {
      const vistas = new Set<string>();
      const opciones: string[] = [];
      let recortada = false;
      const limpias = (Array.isArray(q.opciones) ? q.opciones : []).map((o) => limpiar(o, 2000)).filter(Boolean);
      const sinMarcas = sinMarcadoresDeOpciones(limpias);
      if (sinMarcas === limpias) {
        const suelta = limpias.find((o, k) => pareceLetraSuelta(o, k));
        if (suelta) {
          advertencias.push(
            `Pregunta ${n}: la opción «${corto(suelta)}» parece traer una letra escrita a mano; no se quitó porque las demás opciones no la traen. Revísela.`
          );
        }
      }
      for (const bruta of sinMarcas) {
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
      const multiple = tipo === 'multiple';
      preguntas.push({
        texto: enunciado,
        obligatoria: q.obligatoria === true,
        tipo: multiple ? 'seleccion_multiple' : 'seleccion',
        opciones: opciones.slice(0, MAX_OPCIONES),
        ...(!multiple && q.lista === true ? { lista: true } : {}),
      });
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
