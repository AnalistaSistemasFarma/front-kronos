/**
 * FORMACIÓN — CONSTRUCTOR MANUAL DE FORMULARIOS: lógica pura (sin React).
 *
 * El estado del editor visual (`Estado`) y su conversión a la definición JSON
 * que guarda el servidor (`DefinicionFormulario`). Vive aparte del componente
 * para probarla sin navegador. Ver `components/portal/ConstructorFormulario.tsx`.
 */
import type { ImportacionForms } from './importar-forms';
import {
  NOTA_MINIMA_POR_DEFECTO,
  PUNTOS_TOTAL,
  redondear2,
  validarDefinicion,
  type AutorizacionDatos,
  type DefinicionFormulario,
  type PreguntaFormulario,
  type TipoFormulario,
  type TipoPregunta,
} from './formulario';

export const DATOS = {
  nombre: { id: 'dato_nombre', texto: 'Nombre completo', prellenar: 'nombre' as const },
  correo: { id: 'dato_correo', texto: 'Correo electrónico', prellenar: 'correo' as const },
  cedula: { id: 'dato_cedula', texto: 'Número de cédula', prellenar: undefined },
};
export type DatoClave = keyof typeof DATOS;

/** Texto propuesto (Ley 1581 de 2012). Queda marcado como pendiente de validar por Talento Humano o Jurídica. */
export const AUTORIZACION_ESTANDAR: AutorizacionDatos = {
  version: 'AUT-DATOS-FORMULARIOS-2026-10-09-BORRADOR',
  pendienteValidacion: true,
  titulo: 'Aviso de privacidad y autorización de tratamiento de datos personales',
  texto: [
    'En cumplimiento de la Ley 1581 de 2012 y del Decreto 1377 de 2013 (compilado en el Decreto 1074 de 2015), le informamos que la empresa del grupo Group Shared Services Latinoamérica con la que usted tiene vínculo laboral, como responsable del tratamiento, recolectará, almacenará, usará y conservará los datos que registre en este formulario (nombre, correo y número de documento) con la finalidad de gestionar su formación, dejar constancia de su participación y de su resultado y cumplir las obligaciones legales en seguridad y salud en el trabajo.',
    'Sus respuestas solo las consultan las personas autorizadas de Talento Humano y del SG-SST, no se publican y se conservan durante el tiempo que exija la normativa aplicable.',
    'Como titular, usted tiene derecho a conocer, actualizar y rectificar sus datos, solicitar prueba de esta autorización, ser informado(a) sobre su uso, revocar la autorización o pedir la supresión cuando proceda y presentar quejas ante la Superintendencia de Industria y Comercio. Puede ejercerlos a través del área de Talento Humano, conforme a la política de tratamiento de datos personales de la empresa.',
  ],
  casilla: 'He leído el aviso y autorizo de manera previa, expresa e informada el tratamiento de mis datos personales para las finalidades descritas.',
};

export interface PreguntaEditable {
  id: string;
  texto: string;
  tipo: TipoPregunta;
  obligatoria: boolean;
  opciones: string[];
  permiteOtra: boolean;
  ayuda: string;
  puntos: number | '';
  correcta: number | null;
  /** Se conserva al editar; este editor no lo cambia. */
  prellenar?: 'correo' | 'nombre';
}

export interface Estado {
  tipo: TipoFormulario;
  /** Evaluación: los 100 puntos se reparten por igual entre las preguntas calificadas (Cristian, 2026-10-09). */
  puntosAuto: boolean;
  codigo: string;
  titulo: string;
  descripcion: string;
  notaMinima: number | '';
  borrador: boolean;
  datos: Record<DatoClave, boolean>;
  preguntas: PreguntaEditable[];
  datosSensibles: boolean;
  autorizacion?: AutorizacionDatos;
}

const dosDigitos = (n: number) => String(n).padStart(2, '0');
function codigoNuevo(tipo: TipoFormulario): string {
  const d = new Date();
  const sello = `${d.getFullYear()}${dosDigitos(d.getMonth() + 1)}${dosDigitos(d.getDate())}-${dosDigitos(d.getHours())}${dosDigitos(d.getMinutes())}${dosDigitos(d.getSeconds())}`;
  return `${tipo === 'evaluacion' ? 'EVA' : 'ENC'}-${sello}`;
}

const idNuevo = (preguntas: PreguntaEditable[]): string => {
  const usados = new Set(preguntas.map((p) => p.id));
  for (let n = preguntas.length + 1; ; n++) if (!usados.has(`q${n}`)) return `q${n}`;
};

export const preguntaVacia = (tipo: TipoFormulario, preguntas: PreguntaEditable[]): PreguntaEditable => ({
  id: idNuevo(preguntas),
  texto: '',
  tipo: tipo === 'evaluacion' ? 'seleccion' : 'texto',
  obligatoria: true,
  opciones: tipo === 'evaluacion' ? ['', ''] : [],
  permiteOtra: false,
  ayuda: '',
  puntos: '',
  correcta: null,
});

export function estadoInicial(tipo: TipoFormulario, definicion?: DefinicionFormulario): Estado {
  if (!definicion) {
    return conReparto({
      puntosAuto: true,
      tipo,
      codigo: codigoNuevo(tipo),
      titulo: '',
      descripcion: '',
      notaMinima: NOTA_MINIMA_POR_DEFECTO,
      borrador: false,
      datos: { nombre: tipo === 'evaluacion', correo: false, cedula: tipo === 'evaluacion' },
      preguntas: [preguntaVacia(tipo, [])],
      datosSensibles: false,
    });
  }
  const datos: Record<DatoClave, boolean> = { nombre: false, correo: false, cedula: false };
  const preguntas: PreguntaEditable[] = [];
  for (const p of definicion.preguntas) {
    const clave = (Object.keys(DATOS) as DatoClave[]).find((k) => DATOS[k].id === p.id);
    if (clave) {
      datos[clave] = true;
      continue;
    }
    preguntas.push({
      id: p.id,
      texto: p.texto,
      tipo: p.tipo,
      obligatoria: p.obligatoria,
      opciones: p.opciones ? [...p.opciones] : [],
      permiteOtra: p.permiteOtra === true,
      ayuda: p.ayuda ?? '',
      puntos: p.puntos ?? '',
      correcta: p.correcta ?? null,
      prellenar: p.prellenar,
    });
  }
  const base: Estado = {
    puntosAuto: false,
    tipo: definicion.tipo === 'evaluacion' ? 'evaluacion' : 'encuesta',
    codigo: definicion.codigo,
    titulo: definicion.titulo,
    descripcion: definicion.descripcion ?? '',
    notaMinima: definicion.notaMinima ?? NOTA_MINIMA_POR_DEFECTO,
    borrador: definicion.borrador === true,
    datos,
    preguntas,
    datosSensibles: definicion.datosSensibles === true,
    autorizacion: definicion.autorizacion,
  };
  // Al editar: el reparto automático se enciende solo si los puntos ya están repartidos por igual.
  const calificadas = base.preguntas.filter((p) => esCalificada(base, p));
  const igual = puntosPorIgual(calificadas.length);
  const yaPorIgual = calificadas.length > 0 && calificadas.every((p, i) => p.puntos === igual[i]);
  return { ...base, puntosAuto: base.tipo === 'evaluacion' && yaPorIgual };
}

export const esCalificada = (e: Estado, p: PreguntaEditable) => e.tipo === 'evaluacion' && p.tipo === 'seleccion';

/**
 * Reparto automático: 100 ÷ número de preguntas calificadas. Si no divide exacto
 * (p. ej. 3 preguntas), la última se lleva el resto para que sumen EXACTAMENTE
 * 100 (33,33 + 33,33 + 33,34).
 */
export function puntosPorIgual(n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor((PUNTOS_TOTAL / n) * 100) / 100;
  const resto = redondear2(PUNTOS_TOTAL - base * (n - 1));
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? resto : base));
}

/** Aplica el reparto automático a las preguntas calificadas. */
export function repartirPuntos(e: Estado): Estado {
  const idx = e.preguntas.map((p, i) => (esCalificada(e, p) ? i : -1)).filter((i) => i >= 0);
  const pts = puntosPorIgual(idx.length);
  return { ...e, preguntas: e.preguntas.map((p, i) => (idx.includes(i) ? { ...p, puntos: pts[idx.indexOf(i)] } : p)) };
}

/** Si el estado tiene el reparto automático encendido, lo vuelve a calcular. */
export const conReparto = (e: Estado): Estado => (e.tipo === 'evaluacion' && e.puntosAuto ? repartirPuntos(e) : e);

/** Estado del editor → definición lista para validar y guardar, más los avisos con la numeración que ve la persona. */
export function construirDefinicion(entrada: Estado): { definicion: DefinicionFormulario | null; errores: string[] } {
  const e = conReparto(entrada);
  const errores: string[] = [];
  if (!e.titulo.trim()) errores.push('Escriba el título del formulario.');
  if (!e.codigo.trim()) errores.push('Falta el código del formulario.');
  if (e.preguntas.length === 0) errores.push('Agregue al menos una pregunta.');

  const evaluacion = e.tipo === 'evaluacion';
  if (evaluacion && (e.notaMinima === '' || Number(e.notaMinima) < 1 || Number(e.notaMinima) > 100)) {
    errores.push('La nota mínima para aprobar debe estar entre 1 y 100.');
  }

  const preguntas: PreguntaFormulario[] = [];
  const clavesDatos = (Object.keys(DATOS) as DatoClave[]).filter((k) => e.datos[k]);
  for (const k of clavesDatos) {
    const d = DATOS[k];
    const q: PreguntaFormulario = { id: d.id, texto: d.texto, tipo: 'texto', obligatoria: true };
    if (d.prellenar) q.prellenar = d.prellenar;
    preguntas.push(q);
  }

  let suma = 0;
  e.preguntas.forEach((p, i) => {
    const n = i + 1;
    if (!p.texto.trim()) errores.push(`Pregunta ${n}: escriba el enunciado.`);
    const q: PreguntaFormulario = { id: p.id, texto: p.texto.trim(), tipo: p.tipo, obligatoria: esCalificada(e, p) ? true : p.obligatoria };
    if (p.prellenar) q.prellenar = p.prellenar;
    if (p.ayuda.trim()) q.ayuda = p.ayuda.trim();
    if (p.tipo === 'seleccion') {
      // Las opciones vacías se descartan; la correcta se reubica entre las que quedan.
      const limpias: string[] = [];
      let correcta: number | undefined;
      p.opciones.forEach((o, j) => {
        if (!o.trim()) return;
        if (p.correcta === j) correcta = limpias.length;
        limpias.push(o.trim());
      });
      if (limpias.length < (evaluacion ? 2 : 1)) errores.push(`Pregunta ${n}: agregue al menos ${evaluacion ? 'dos opciones' : 'una opción'}.`);
      if (new Set(limpias).size !== limpias.length) errores.push(`Pregunta ${n}: hay opciones repetidas.`);
      q.opciones = limpias;
      if (p.permiteOtra && !evaluacion) q.permiteOtra = true;
      if (evaluacion) {
        const pts = p.puntos === '' ? NaN : Number(p.puntos);
        if (!Number.isFinite(pts) || pts <= 0) errores.push(`Pregunta ${n}: asigne los puntos (mayor que 0).`);
        else {
          q.puntos = redondear2(pts);
          suma += q.puntos;
        }
        if (correcta === undefined && !e.borrador) errores.push(`Pregunta ${n}: marque cuál es la respuesta correcta.`);
        else if (correcta !== undefined) q.correcta = correcta;
      }
    }
    preguntas.push(q);
  });

  if (evaluacion && !e.borrador) {
    const calificadas = e.preguntas.filter((p) => esCalificada(e, p)).length;
    if (calificadas === 0) errores.push('Una evaluación necesita al menos una pregunta de selección con puntos.');
    else if (redondear2(suma) !== PUNTOS_TOTAL) errores.push(`Los puntos deben sumar exactamente ${PUNTOS_TOTAL}: hoy suman ${redondear2(suma)}.`);
  }

  const pideCedula = e.datos.cedula;
  const crudo: Record<string, unknown> = { formato: 1, codigo: e.codigo.trim(), titulo: e.titulo.trim(), preguntas };
  if (e.descripcion.trim()) crudo.descripcion = e.descripcion.trim();
  if (e.datosSensibles || pideCedula) crudo.datosSensibles = true;
  const autorizacion = e.autorizacion ?? (pideCedula ? AUTORIZACION_ESTANDAR : undefined);
  if (autorizacion) crudo.autorizacion = autorizacion;
  if (evaluacion) {
    crudo.tipo = 'evaluacion';
    crudo.notaMinima = e.notaMinima === '' ? NOTA_MINIMA_POR_DEFECTO : Number(e.notaMinima);
    if (e.borrador) crudo.borrador = true;
  }

  if (errores.length > 0) return { definicion: null, errores };
  // Red de seguridad: las mismas reglas que aplica el servidor.
  const r = validarDefinicion(crudo);
  return r.ok ? { definicion: r.definicion, errores: [] } : { definicion: null, errores: r.errores };
}


/** Quita tildes y signos para reconocer los datos de la persona por su enunciado. */
const normalizar = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * ¿Esta pregunta de texto es un dato de la persona que el constructor ya sabe pedir? Así "Nombre
 * Completo" y "Número de cédula" de un Forms importado quedan en "Datos que se piden" (con el nombre
 * prellenado desde la sesión y el aviso de la Ley 1581 para la cédula), no como preguntas sueltas.
 */
const NOMBRES_DE_PERSONA = new Set([
  'nombre',
  'nombres',
  'nombre completo',
  'nombres completos',
  'nombres y apellidos',
  'nombre y apellidos',
  'nombre y apellido',
  'apellidos y nombres',
]);

export function claveDeDato(texto: string): DatoClave | null {
  const t = normalizar(texto);
  if (t.length > 40) return null;
  if (NOMBRES_DE_PERSONA.has(t)) return 'nombre';
  if (/^(correo|e ?mail)( electronico| corporativo| institucional)?$/.test(t)) return 'correo';
  if (/(cedula|numero de documento|documento de identidad|n documento)/.test(t)) return 'cedula';
  return null;
}

/**
 * Lo importado de Microsoft Forms → estado del constructor (para revisarlo, editarlo y guardarlo).
 * Evaluación: Forms no publica las respuestas correctas, así que llega como BORRADOR sin correctas; los
 * puntos se reparten solos (100 ÷ preguntas) y quien crea el curso marca la correcta de cada pregunta.
 */
export function estadoDesdeImportacion(tipo: TipoFormulario, imp: ImportacionForms): Estado {
  const base = estadoInicial(tipo);
  const datos: Record<DatoClave, boolean> = { nombre: false, correo: false, cedula: false };
  const preguntas: PreguntaEditable[] = [];
  for (const p of imp.preguntas) {
    const clave = p.tipo === 'texto' ? claveDeDato(p.texto) : null;
    if (clave && !datos[clave]) {
      datos[clave] = true;
      continue;
    }
    preguntas.push({
      id: `q${preguntas.length + 1}`,
      texto: p.texto,
      tipo: p.tipo,
      obligatoria: p.obligatoria,
      opciones: p.tipo === 'seleccion' ? [...p.opciones] : [],
      permiteOtra: false,
      ayuda: '',
      puntos: '',
      correcta: null,
    });
  }
  const hayCalificables = preguntas.some((p) => p.tipo === 'seleccion');
  return conReparto({
    ...base,
    puntosAuto: true,
    titulo: imp.titulo,
    descripcion: imp.descripcion,
    datos,
    preguntas,
    borrador: tipo === 'evaluacion' && hayCalificables,
  });
}
