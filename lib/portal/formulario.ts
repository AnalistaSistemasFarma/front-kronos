/**
 * PORTAL DE TALENTO HUMANO — FORMACIÓN — FORMULARIO PROPIO.
 *
 * Pedido de Cristian Baldión (2026-10-08): "toma todas las preguntas que
 * están ahí y créame el formulario en el curso, así como el enlace que te
 * pasé, pero que sea un formulario propio del curso". En vez de un enlace a
 * Microsoft Forms, un material de tipo `FORM` que la persona responde DENTRO
 * del portal; las respuestas se guardan en SynerLink y el material se marca
 * como completado AL ENVIAR (con validación exitosa).
 *
 * Este archivo es PURO (sin base ni red): lo usan las rutas del servidor y el
 * navegador, para que las dos validen con las mismas reglas. El servidor
 * SIEMPRE vuelve a validar; lo del navegador es solo para avisar antes.
 *
 * DEFINICIÓN (JSON versionado, `portal_formulario_version.definicion`):
 *
 *   {
 *     formato: 1,                       versión del ESQUEMA del JSON
 *     codigo: 'SST-01-FR-001',          código del formato (único)
 *     titulo, descripcion?,
 *     datosSensibles?: true,            Ley 1581: exige `autorizacion`
 *     autorizacion?: { version, titulo, texto: string[], casilla, pendienteValidacion? },
 *     preguntas: [{ id, texto, tipo, obligatoria, opciones?, permiteOtra?, prellenar?, ayuda? }]
 *   }
 *
 * El ORDEN de las preguntas es el del arreglo. `id` es estable entre
 * versiones (las respuestas se guardan por `id`, no por posición), así que
 * reordenar o cambiar un texto no rompe las respuestas ya enviadas.
 *
 * Tipos de pregunta: `texto`, `texto_largo`, `numero`, `fecha` (AAAA-MM-DD),
 * `seleccion` (única, con "Otra" si `permiteOtra`) y `si_no`.
 *
 * TIPOS DE FORMULARIO (Cristian, 2026-10-09): `tipo` = `encuesta` (por defecto;
 * como el SST-01-FR-001) o `evaluacion`. Una EVALUACIÓN agrega:
 *   - `notaMinima`   porcentaje para aprobar (1 a 100; por defecto 80);
 *   - `borrador`     true = todavía no se puede responder (faltan respuestas
 *                     correctas o puntos); se publica guardando sin `borrador`;
 *   - por pregunta: `puntos` (los de todas las calificadas suman EXACTAMENTE
 *     100) y `correcta` (posición, desde 0, de la opción correcta). Una
 *     calificada es siempre de selección única y obligatoria. Las preguntas
 *     SIN `puntos` (nombre, cédula…) son datos de la persona y no suman.
 *   `correcta` NUNCA sale hacia el estudiante: ver `definicionPublica`.
 */

export const TIPOS_PREGUNTA = ['texto', 'texto_largo', 'numero', 'fecha', 'seleccion', 'si_no'] as const;
export type TipoPregunta = (typeof TIPOS_PREGUNTA)[number];

/** Las dos opciones de `si_no`, tal como las muestra Microsoft Forms. */
export const OPCIONES_SI_NO = ['Sí', 'No'] as const;

export interface PreguntaFormulario {
  id: string;
  texto: string;
  tipo: TipoPregunta;
  obligatoria: boolean;
  /** Solo `seleccion`. */
  opciones?: string[];
  /** Solo `seleccion`: agrega "Otra respuesta" con texto libre. */
  permiteOtra?: boolean;
  /** Se prellena desde la sesión del portal. */
  prellenar?: 'correo' | 'nombre';
  ayuda?: string;
  /** Solo evaluaciones: puntos de la pregunta (las calificadas suman 100). */
  puntos?: number;
  /** Solo evaluaciones: posición (desde 0) de la opción correcta. Nunca se envía al estudiante. */
  correcta?: number;
}

export type TipoFormulario = 'encuesta' | 'evaluacion';
export const NOTA_MINIMA_POR_DEFECTO = 80;
export const PUNTOS_TOTAL = 100;

/** Redondeo a 2 decimales (puntos y porcentajes). */
export const redondear2 = (n: number): number => Math.round(n * 100) / 100;

export interface AutorizacionDatos {
  /** Se guarda con cada respuesta: prueba de QUÉ texto aceptó la persona. */
  version: string;
  titulo: string;
  texto: string[];
  casilla: string;
  /** Texto propuesto que todavía no aprueba Talento Humano/Jurídica. */
  pendienteValidacion?: boolean;
}

export interface DefinicionFormulario {
  formato: 1;
  codigo: string;
  titulo: string;
  descripcion?: string;
  datosSensibles?: boolean;
  autorizacion?: AutorizacionDatos;
  /** Ausente = encuesta. */
  tipo?: TipoFormulario;
  /** Solo evaluaciones: porcentaje mínimo para aprobar. */
  notaMinima?: number;
  /** Solo evaluaciones: todavía no se puede responder. */
  borrador?: boolean;
  preguntas: PreguntaFormulario[];
}

/** Respuesta a una pregunta: texto, o la opción "Otra" con su texto. */
export type ValorRespuesta = string | { otra: string };
export type Respuestas = Record<string, ValorRespuesta>;

export const MAX_PREGUNTAS = 200;
export const MAX_OPCIONES = 50;
export const MAX_TEXTO_PREGUNTA = 500;
/** Una opción puede ser un párrafo (p. ej. las evaluaciones con opciones largas). */
export const MAX_TEXTO_OPCION = 500;
export const MAX_TEXTO_RESPUESTA = 2000;
export const MAX_TEXTO_LARGO_RESPUESTA = 4000;
/** Tope de la definición serializada (NVARCHAR(MAX) aguanta más; esto es cordura). */
export const MAX_BYTES_DEFINICION = 256 * 1024;

export const MENSAJE_OBLIGATORIA = 'Esta pregunta es obligatoria.';
export const MENSAJE_FORMULARIO_SE_COMPLETA_AL_ENVIAR =
  'Este material es un formulario: se completa al enviar sus respuestas.';
export const MENSAJE_YA_ENVIADO =
  'Ya envió sus respuestas a este formulario. No se pueden modificar; si necesita corregir algo, pida a Talento Humano que lo reabra.';
export const MENSAJE_AUTORIZACION = 'Debe leer y aceptar la autorización de tratamiento de datos personales para enviar el formulario.';
export const MENSAJE_EVALUACION_EN_BORRADOR = 'Esta evaluación está en preparación. Estará disponible cuando Talento Humano la publique.';

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

const textoLimpio = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t && t.length <= max ? t : null;
};

/**
 * Valida una definición (la que importa el formador o la sembrada). Devuelve
 * la definición NORMALIZADA (solo los campos conocidos) o la lista de errores.
 */
export function validarDefinicion(
  crudo: unknown
): { ok: true; definicion: DefinicionFormulario } | { ok: false; errores: string[] } {
  const errores: string[] = [];
  const d = (crudo ?? {}) as Record<string, unknown>;
  if (typeof crudo !== 'object' || crudo === null || Array.isArray(crudo)) {
    return { ok: false, errores: ['La definición debe ser un objeto JSON.'] };
  }
  if (d.formato !== 1) errores.push('"formato" debe ser 1.');
  const codigo = textoLimpio(d.codigo, 60);
  if (!codigo) errores.push('Falta "codigo" (máximo 60 caracteres).');
  const titulo = textoLimpio(d.titulo, 255);
  if (!titulo) errores.push('Falta "titulo" (máximo 255 caracteres).');
  const descripcion = d.descripcion === undefined || d.descripcion === null ? undefined : textoLimpio(d.descripcion, 4000);
  if (descripcion === null) errores.push('"descripcion" no es válida.');
  const datosSensibles = d.datosSensibles === true;

  if (d.tipo !== undefined && d.tipo !== 'encuesta' && d.tipo !== 'evaluacion') errores.push('"tipo" debe ser "encuesta" o "evaluacion".');
  const tipoForm: TipoFormulario = d.tipo === 'evaluacion' ? 'evaluacion' : 'encuesta';
  const borrador = d.borrador === true;
  if (borrador && tipoForm !== 'evaluacion') errores.push('Solo una evaluación puede estar en borrador.');
  let notaMinima: number | undefined;
  if (tipoForm === 'evaluacion') {
    const n = d.notaMinima === undefined || d.notaMinima === null ? NOTA_MINIMA_POR_DEFECTO : d.notaMinima;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 1 || n > 100) errores.push('"notaMinima" debe ser un número entre 1 y 100.');
    else notaMinima = redondear2(n);
  } else if (d.notaMinima !== undefined && d.notaMinima !== null) {
    errores.push('"notaMinima" es solo para evaluaciones.');
  }

  let autorizacion: AutorizacionDatos | undefined;
  if (d.autorizacion !== undefined && d.autorizacion !== null) {
    const a = d.autorizacion as Record<string, unknown>;
    const version = textoLimpio(a.version, 60);
    const tituloA = textoLimpio(a.titulo, 255);
    const casilla = textoLimpio(a.casilla, 1000);
    const texto = Array.isArray(a.texto) ? a.texto.map((p) => textoLimpio(p, 4000)) : null;
    if (!version || !tituloA || !casilla || !texto || texto.length === 0 || texto.some((p) => p === null)) {
      errores.push('"autorizacion" debe traer version, titulo, texto (lista de párrafos) y casilla.');
    } else {
      autorizacion = { version, titulo: tituloA, texto: texto as string[], casilla };
      if (a.pendienteValidacion === true) autorizacion.pendienteValidacion = true;
    }
  }
  if (datosSensibles && !autorizacion && errores.length === 0) {
    errores.push('Un formulario con datos sensibles (Ley 1581 de 2012) debe traer "autorizacion".');
  }

  const preguntas: PreguntaFormulario[] = [];
  if (!Array.isArray(d.preguntas) || d.preguntas.length === 0) {
    errores.push('"preguntas" debe ser una lista con al menos una pregunta.');
  } else if (d.preguntas.length > MAX_PREGUNTAS) {
    errores.push(`Máximo ${MAX_PREGUNTAS} preguntas.`);
  } else {
    const ids = new Set<string>();
    const prellenados = new Set<string>();
    d.preguntas.forEach((crudaP, i) => {
      const n = i + 1;
      const p = (crudaP ?? {}) as Record<string, unknown>;
      const id = typeof p.id === 'string' && ID.test(p.id) ? p.id : null;
      if (!id) return void errores.push(`Pregunta ${n}: "id" no válido (letras, números, guion; empieza por letra).`);
      if (ids.has(id)) return void errores.push(`Pregunta ${n}: el id "${id}" está repetido.`);
      ids.add(id);
      const texto = textoLimpio(p.texto, MAX_TEXTO_PREGUNTA);
      if (!texto) return void errores.push(`Pregunta ${n}: falta "texto" (máximo ${MAX_TEXTO_PREGUNTA} caracteres).`);
      const tipo = TIPOS_PREGUNTA.includes(p.tipo as TipoPregunta) ? (p.tipo as TipoPregunta) : null;
      if (!tipo) return void errores.push(`Pregunta ${n}: "tipo" debe ser uno de ${TIPOS_PREGUNTA.join(', ')}.`);
      const pregunta: PreguntaFormulario = { id, texto, tipo, obligatoria: p.obligatoria === true };
      if (tipo === 'seleccion') {
        const opciones = Array.isArray(p.opciones) ? p.opciones.map((o) => textoLimpio(o, MAX_TEXTO_OPCION)) : null;
        if (!opciones || opciones.length === 0 || opciones.length > MAX_OPCIONES || opciones.some((o) => o === null)) {
          return void errores.push(`Pregunta ${n}: "opciones" debe ser una lista de 1 a ${MAX_OPCIONES} textos.`);
        }
        if (new Set(opciones).size !== opciones.length) return void errores.push(`Pregunta ${n}: hay opciones repetidas.`);
        pregunta.opciones = opciones as string[];
        if (p.permiteOtra === true) pregunta.permiteOtra = true;
      }
      const hayPuntos = p.puntos !== undefined && p.puntos !== null;
      const hayCorrecta = p.correcta !== undefined && p.correcta !== null;
      if (tipoForm !== 'evaluacion') {
        if (hayPuntos || hayCorrecta) return void errores.push(`Pregunta ${n}: "puntos" y "correcta" son solo para evaluaciones.`);
      } else {
        if (hayCorrecta && !hayPuntos) return void errores.push(`Pregunta ${n}: tiene "correcta" pero no "puntos".`);
        if (hayPuntos) {
          if (tipo !== 'seleccion' || p.permiteOtra === true) {
            return void errores.push(`Pregunta ${n}: una pregunta con puntos debe ser de selección única, sin "otra respuesta".`);
          }
          if (pregunta.opciones!.length < 2) return void errores.push(`Pregunta ${n}: necesita al menos 2 opciones.`);
          const pts = p.puntos;
          if (typeof pts !== 'number' || !Number.isFinite(pts) || pts <= 0 || pts > PUNTOS_TOTAL || redondear2(pts) !== pts) {
            return void errores.push(`Pregunta ${n}: "puntos" debe ser un número mayor que 0 y hasta ${PUNTOS_TOTAL}, con máximo 2 decimales.`);
          }
          pregunta.puntos = pts;
          pregunta.obligatoria = true;
          if (hayCorrecta) {
            const c = p.correcta;
            if (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c >= pregunta.opciones!.length) {
              return void errores.push(`Pregunta ${n}: "correcta" no corresponde a una de las opciones.`);
            }
            pregunta.correcta = c;
          } else if (!borrador) {
            return void errores.push(`Pregunta ${n}: marque cuál es la respuesta correcta.`);
          }
        }
      }
      if (p.prellenar === 'correo' || p.prellenar === 'nombre') {
        if (prellenados.has(p.prellenar)) return void errores.push(`Pregunta ${n}: ya hay otra pregunta que prellena "${p.prellenar}".`);
        prellenados.add(p.prellenar);
        pregunta.prellenar = p.prellenar;
      }
      const ayuda = p.ayuda === undefined ? undefined : textoLimpio(p.ayuda, 1000);
      if (ayuda) pregunta.ayuda = ayuda;
      preguntas.push(pregunta);
    });
  }

  if (tipoForm === 'evaluacion' && !borrador && errores.length === 0) {
    const calificadas = preguntas.filter((q) => q.puntos !== undefined);
    if (calificadas.length === 0) {
      errores.push('Una evaluación necesita al menos una pregunta con puntos.');
    } else {
      const suma = redondear2(calificadas.reduce((s, q) => s + (q.puntos ?? 0), 0));
      if (suma !== PUNTOS_TOTAL) errores.push(`Los puntos de las preguntas deben sumar exactamente ${PUNTOS_TOTAL} (hoy suman ${suma}).`);
    }
  }

  if (errores.length > 0) return { ok: false, errores };
  const definicion: DefinicionFormulario = { formato: 1, codigo: codigo!, titulo: titulo!, preguntas };
  if (tipoForm === 'evaluacion') {
    definicion.tipo = 'evaluacion';
    definicion.notaMinima = notaMinima!;
    if (borrador) definicion.borrador = true;
  }
  if (descripcion) definicion.descripcion = descripcion;
  if (datosSensibles) definicion.datosSensibles = true;
  if (autorizacion) definicion.autorizacion = autorizacion;
  return { ok: true, definicion };
}

function fechaValida(v: string): boolean {
  const m = FECHA.exec(v);
  if (!m) return false;
  const [a, me, di] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (a < 1900 || a > 2100) return false;
  const f = new Date(Date.UTC(a, me - 1, di));
  return f.getUTCFullYear() === a && f.getUTCMonth() === me - 1 && f.getUTCDate() === di;
}

/** Entero o decimal (con punto o coma), sin notación científica ni espacios. */
function esNumero(v: string): boolean {
  if (v.length > 30) return false;
  const t = v.replace(',', '.');
  if (!/^-?[0-9.]+$/.test(t) || t.split('.').length > 2 || t.startsWith('.') || t.endsWith('.') || t.startsWith('-.')) return false;
  return Number.isFinite(Number(t));
}

/** ¿La pregunta quedó sin responder? (lo usan el navegador y el servidor). */
export function estaVacia(valor: ValorRespuesta | undefined | null): boolean {
  if (valor === undefined || valor === null) return true;
  if (typeof valor === 'string') return valor.trim() === '';
  return typeof valor.otra !== 'string' || valor.otra.trim() === '';
}

/** Error de UNA pregunta, o null si está bien. */
export function validarPregunta(p: PreguntaFormulario, valor: ValorRespuesta | undefined | null): string | null {
  if (estaVacia(valor)) {
    if (valor && typeof valor === 'object') return 'Escriba su otra respuesta.';
    return p.obligatoria ? MENSAJE_OBLIGATORIA : null;
  }
  if (typeof valor === 'object') {
    if (p.tipo !== 'seleccion' || !p.permiteOtra) return 'Respuesta no válida.';
    return valor!.otra.trim().length > MAX_TEXTO_RESPUESTA ? `Máximo ${MAX_TEXTO_RESPUESTA} caracteres.` : null;
  }
  const v = (valor as string).trim();
  switch (p.tipo) {
    case 'texto':
      return v.length > MAX_TEXTO_RESPUESTA ? `Máximo ${MAX_TEXTO_RESPUESTA} caracteres.` : null;
    case 'texto_largo':
      return v.length > MAX_TEXTO_LARGO_RESPUESTA ? `Máximo ${MAX_TEXTO_LARGO_RESPUESTA} caracteres.` : null;
    case 'numero':
      return esNumero(v) ? null : 'Escriba un número.';
    case 'fecha':
      return fechaValida(v) ? null : 'Escriba una fecha válida.';
    case 'seleccion':
      return p.opciones?.includes(v) ? null : 'Elija una de las opciones.';
    case 'si_no':
      return (OPCIONES_SI_NO as readonly string[]).includes(v) ? null : 'Elija Sí o No.';
  }
}

/**
 * Valida TODAS las respuestas contra la definición. Devuelve las respuestas
 * NORMALIZADAS (recortadas, sin preguntas desconocidas ni opcionales vacías)
 * o los errores por pregunta, en el orden del formulario (el navegador lleva
 * a la persona a la PRIMERA que falte).
 */
export function validarRespuestas(
  definicion: DefinicionFormulario,
  crudo: unknown
): { ok: true; respuestas: Respuestas } | { ok: false; errores: { id: string; mensaje: string }[] } {
  const entrada = (crudo && typeof crudo === 'object' && !Array.isArray(crudo) ? crudo : {}) as Record<string, unknown>;
  const errores: { id: string; mensaje: string }[] = [];
  const respuestas: Respuestas = {};
  for (const p of definicion.preguntas) {
    const bruto = entrada[p.id];
    let valor: ValorRespuesta | null = null;
    if (typeof bruto === 'string') valor = bruto;
    else if (bruto && typeof bruto === 'object' && !Array.isArray(bruto) && typeof (bruto as { otra?: unknown }).otra === 'string') {
      valor = { otra: (bruto as { otra: string }).otra };
    } else if (bruto !== undefined && bruto !== null) {
      errores.push({ id: p.id, mensaje: 'Respuesta no válida.' });
      continue;
    }
    const error = validarPregunta(p, valor);
    if (error) {
      errores.push({ id: p.id, mensaje: error });
      continue;
    }
    if (estaVacia(valor)) continue;
    respuestas[p.id] = typeof valor === 'string' ? valor.trim() : { otra: valor!.otra.trim() };
  }
  return errores.length > 0 ? { ok: false, errores } : { ok: true, respuestas };
}

export const esEvaluacion = (d: DefinicionFormulario): boolean => d.tipo === 'evaluacion';

/** Suma de los puntos de las preguntas calificadas (100 en una evaluación completa). */
export function puntosTotales(d: DefinicionFormulario): number {
  return redondear2(d.preguntas.reduce((s, p) => s + (p.puntos ?? 0), 0));
}

/**
 * La definición que ve el ESTUDIANTE: igual, pero SIN `correcta`. Es la única
 * que sale por la ruta pública del material; las correctas solo viajan en las
 * rutas de formadores.
 */
export function definicionPublica(d: DefinicionFormulario): DefinicionFormulario {
  return { ...d, preguntas: d.preguntas.map(({ correcta: _correcta, ...resto }) => resto) };
}

export interface ResultadoEvaluacion {
  puntaje: number;
  puntajeMax: number;
  /** 0 a 100, 2 decimales. */
  porcentaje: number;
  notaMinima: number;
  aprobado: boolean;
  correctas: number;
  calificadas: number;
}

/**
 * Califica las respuestas YA validadas de una evaluación. Solo cuentan las
 * preguntas con puntos y respuesta correcta definidas.
 */
export function calificar(d: DefinicionFormulario, respuestas: Respuestas): ResultadoEvaluacion {
  let puntaje = 0;
  let puntajeMax = 0;
  let correctas = 0;
  let calificadas = 0;
  for (const p of d.preguntas) {
    if (p.puntos === undefined || p.correcta === undefined) continue;
    calificadas += 1;
    puntajeMax += p.puntos;
    const v = respuestas[p.id];
    if (typeof v === 'string' && p.opciones?.[p.correcta] === v) {
      puntaje += p.puntos;
      correctas += 1;
    }
  }
  const notaMinima = d.notaMinima ?? NOTA_MINIMA_POR_DEFECTO;
  const porcentaje = puntajeMax > 0 ? redondear2((puntaje / puntajeMax) * 100) : 0;
  return {
    puntaje: redondear2(puntaje),
    puntajeMax: redondear2(puntajeMax),
    porcentaje,
    notaMinima,
    aprobado: puntajeMax > 0 && porcentaje >= notaMinima,
    correctas,
    calificadas,
  };
}

/** Cómo se muestra una respuesta en la tabla y en el Excel. */
export function textoDeRespuesta(valor: ValorRespuesta | undefined): string {
  if (valor === undefined) return '';
  return typeof valor === 'string' ? valor : `Otra: ${valor.otra}`;
}

/** Valores iniciales: correo y nombre desde la sesión, el resto vacío. */
export function valoresIniciales(definicion: DefinicionFormulario, sesion: { correo: string; nombre: string }): Respuestas {
  const valores: Respuestas = {};
  for (const p of definicion.preguntas) {
    if (p.prellenar === 'correo') valores[p.id] = sesion.correo;
    if (p.prellenar === 'nombre') valores[p.id] = sesion.nombre;
  }
  return valores;
}

/** Una respuesta guardada, tal como la necesitan la tabla y el Excel. */
export interface RespuestaGuardada {
  id: number;
  correo: string;
  enviadaEl: Date | string;
  version: number;
  autorizacionVersion: string | null;
  autorizadoEl: Date | string | null;
  respuestas: Respuestas;
  /** Solo evaluaciones: nota (%) del intento aprobado y cuántos intentos hizo. */
  nota?: number | null;
  intentos?: number;
}

/**
 * Columnas de la tabla/Excel: las preguntas de la versión VIGENTE en su orden
 * y, al final, las que solo existen en versiones anteriores (para no perder
 * respuestas viejas si el formador quitó una pregunta).
 */
export function columnasDeRespuestas(
  vigente: DefinicionFormulario,
  anteriores: DefinicionFormulario[]
): { id: string; texto: string }[] {
  const columnas = vigente.preguntas.map((p) => ({ id: p.id, texto: p.texto }));
  const vistos = new Set(columnas.map((c) => c.id));
  for (const d of anteriores) {
    for (const p of d.preguntas) {
      if (vistos.has(p.id)) continue;
      vistos.add(p.id);
      columnas.push({ id: p.id, texto: `${p.texto} (versión anterior)` });
    }
  }
  return columnas;
}

/**
 * Celda de Excel sin riesgo de inyección de fórmulas (CSV/formula injection):
 * un texto que empieza por = + - @ (o tab/retorno) se antepone con un apóstrofo.
 * Las respuestas las escribe cualquier persona del portal.
 */
export function celdaSegura(texto: string): string {
  return /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto;
}
