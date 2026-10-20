/**
 * CATÁLOGO CERRADO de emojis para reaccionar (2026-10-20).
 *
 * Lo comparten el navegador (selector) y el servidor (validación): una
 * reacción solo se guarda si su emoji está AQUÍ, tal cual (con el selector de
 * variación U+FE0F incluido cuando lo lleva). Así nadie puede colar texto
 * arbitrario como «reacción», y el selector completo pesa unos pocos KB —sin
 * librería de emojis, que pesan cientos de KB (la misma razón por la que se
 * quitó el panel de emojis del compositor el 2026-09-09)—.
 *
 * Los nombres van en español y en minúsculas: son lo que busca el buscador
 * del selector («pulgar», «gracias», «fiesta»…).
 *
 * ⚠️ Solo AGREGAR. Quitar un emoji de aquí deja de aceptar NUEVAS reacciones
 * con él, pero las ya guardadas se siguen mostrando.
 */

export interface EmojiEntrada {
  /** El emoji, exactamente como se guarda. */
  e: string;
  /** Palabras de búsqueda en español. */
  n: string;
}

export interface EmojiCategoria {
  id: string;
  nombre: string;
  emojis: EmojiEntrada[];
}

/** El set RÁPIDO que pidió Nicolás, en este orden. */
export const REACCIONES_RAPIDAS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '✅'] as const;

const e = (emoji: string, nombre: string): EmojiEntrada => ({ e: emoji, n: nombre });

export const CATEGORIAS_EMOJI: EmojiCategoria[] = [
  {
    id: 'frecuentes',
    nombre: 'Frecuentes',
    emojis: [
      e('👍', 'pulgar arriba me gusta de acuerdo'),
      e('❤️', 'corazón rojo amor'),
      e('😂', 'risa lágrimas carcajada'),
      e('😮', 'sorpresa asombro boca abierta'),
      e('😢', 'triste lágrima llorar'),
      e('🙏', 'gracias por favor manos juntas'),
      e('✅', 'listo hecho chulo check'),
      e('👏', 'aplausos felicitaciones'),
      e('🎉', 'fiesta celebración'),
      e('🔥', 'fuego excelente'),
      e('💯', 'cien perfecto'),
      e('👀', 'ojos mirando revisando'),
    ],
  },
  {
    id: 'caras',
    nombre: 'Caras',
    emojis: [
      e('😀', 'sonrisa feliz'),
      e('😃', 'sonrisa grande'),
      e('😄', 'sonrisa ojos felices'),
      e('😁', 'sonrisa dientes'),
      e('😅', 'risa nerviosa sudor'),
      e('🤣', 'revolcarse de risa'),
      e('🙂', 'sonrisa leve'),
      e('😉', 'guiño'),
      e('😊', 'sonrisa sonrojada'),
      e('😇', 'ángel inocente'),
      e('🥰', 'enamorado corazones'),
      e('😍', 'ojos de corazón'),
      e('🤩', 'estrellas deslumbrado'),
      e('😘', 'beso'),
      e('😋', 'delicioso rico'),
      e('😎', 'gafas de sol genial'),
      e('🤓', 'nerd gafas'),
      e('🧐', 'monóculo analizando'),
      e('🤔', 'pensando duda'),
      e('🤨', 'ceja levantada sospecha'),
      e('😐', 'neutral serio'),
      e('😑', 'inexpresivo'),
      e('😶', 'sin palabras'),
      e('🙄', 'ojos en blanco'),
      e('😏', 'sonrisa pícara'),
      e('😬', 'mueca incómodo'),
      e('😌', 'aliviado tranquilo'),
      e('😔', 'pensativo decaído'),
      e('😪', 'sueño cansado'),
      e('😴', 'dormido'),
      e('🤒', 'enfermo termómetro'),
      e('🤧', 'estornudo gripa'),
      e('🥵', 'calor'),
      e('🥶', 'frío'),
      e('🤯', 'cabeza explota impresionado'),
      e('🥳', 'fiesta cumpleaños celebrar'),
      e('😕', 'confundido'),
      e('😟', 'preocupado'),
      e('🙁', 'ceño fruncido'),
      e('😯', 'silencio sorpresa'),
      e('😲', 'asombrado'),
      e('🥺', 'suplicante ojos tiernos'),
      e('😥', 'decepcionado aliviado'),
      e('😭', 'llorando a mares'),
      e('😱', 'grito miedo'),
      e('😖', 'frustrado'),
      e('😩', 'agotado'),
      e('😤', 'resoplando'),
      e('😠', 'enojado'),
      e('🤐', 'boca cerrada secreto'),
      e('🤫', 'silencio shh'),
      e('🤭', 'risita mano en la boca'),
      e('🤗', 'abrazo'),
      e('🫡', 'saludo militar entendido'),
    ],
  },
  {
    id: 'gestos',
    nombre: 'Gestos',
    emojis: [
      e('👎', 'pulgar abajo no me gusta'),
      e('👌', 'ok perfecto'),
      e('✌️', 'paz victoria'),
      e('🤞', 'dedos cruzados suerte'),
      e('🤝', 'apretón de manos acuerdo trato'),
      e('🙌', 'manos arriba celebración'),
      e('👋', 'hola adiós saludo mano'),
      e('✋', 'alto mano'),
      e('👊', 'puño choque'),
      e('💪', 'fuerza ánimo bíceps'),
      e('👉', 'señalar derecha'),
      e('👈', 'señalar izquierda'),
      e('👆', 'señalar arriba'),
      e('👇', 'señalar abajo'),
      e('☝️', 'índice arriba un momento'),
      e('🫶', 'manos corazón cariño'),
      e('🤙', 'llámame'),
      e('✍️', 'escribiendo'),
      e('🧠', 'cerebro idea inteligente'),
    ],
  },
  {
    id: 'corazones',
    nombre: 'Corazones',
    emojis: [
      e('🧡', 'corazón naranja'),
      e('💛', 'corazón amarillo'),
      e('💚', 'corazón verde'),
      e('💙', 'corazón azul'),
      e('💜', 'corazón morado'),
      e('🖤', 'corazón negro'),
      e('🤍', 'corazón blanco'),
      e('💖', 'corazón brillante'),
      e('💕', 'dos corazones'),
      e('💔', 'corazón roto'),
      e('❣️', 'corazón exclamación'),
    ],
  },
  {
    id: 'trabajo',
    nombre: 'Trabajo',
    emojis: [
      e('💼', 'maletín trabajo'),
      e('📊', 'gráfico barras informe'),
      e('📈', 'gráfico subiendo crecimiento'),
      e('📉', 'gráfico bajando'),
      e('📋', 'portapapeles lista'),
      e('📌', 'chincheta fijar importante'),
      e('📎', 'clip adjunto'),
      e('📝', 'nota escribir acta'),
      e('📅', 'calendario fecha'),
      e('📆', 'calendario agenda'),
      e('⏰', 'alarma reloj'),
      e('⏳', 'reloj de arena esperando'),
      e('⌛', 'tiempo terminado'),
      e('📧', 'correo email'),
      e('📞', 'teléfono llamada'),
      e('💻', 'computador portátil'),
      e('🖥️', 'computador escritorio'),
      e('📱', 'celular'),
      e('🖨️', 'impresora'),
      e('🔍', 'lupa buscar'),
      e('🔒', 'candado seguro'),
      e('🔑', 'llave acceso'),
      e('⚙️', 'engranaje configuración'),
      e('🛠️', 'herramientas arreglo'),
      e('🧾', 'factura recibo'),
      e('💰', 'dinero bolsa'),
      e('💵', 'billete dólar pago'),
      e('🏦', 'banco'),
      e('📦', 'paquete caja despacho'),
      e('🚚', 'camión envío entrega'),
      e('🏭', 'fábrica planta'),
      e('🧪', 'tubo de ensayo laboratorio'),
      e('💊', 'pastilla medicamento'),
      e('🩺', 'estetoscopio salud'),
      e('🎯', 'diana objetivo meta'),
      e('🚀', 'cohete lanzamiento'),
      e('💡', 'bombillo idea'),
      e('☕', 'café tinto'),
      e('🍕', 'pizza'),
      e('🎂', 'pastel torta cumpleaños'),
      e('🎁', 'regalo'),
      e('🏆', 'trofeo ganador'),
      e('🥇', 'medalla oro primero'),
      e('⭐', 'estrella'),
      e('🌟', 'estrella brillante'),
      e('✨', 'brillos'),
      e('🎈', 'globo'),
      e('🇨🇴', 'bandera colombia'),
    ],
  },
  {
    id: 'simbolos',
    nombre: 'Símbolos',
    emojis: [
      e('✔️', 'chulo marca'),
      e('☑️', 'casilla marcada'),
      e('❌', 'equis no error'),
      e('❎', 'equis cuadro'),
      e('⚠️', 'advertencia cuidado'),
      e('❗', 'exclamación importante'),
      e('❓', 'pregunta interrogación'),
      e('‼️', 'doble exclamación'),
      e('⛔', 'prohibido'),
      e('🚫', 'no permitido'),
      e('🔴', 'círculo rojo'),
      e('🟠', 'círculo naranja'),
      e('🟡', 'círculo amarillo'),
      e('🟢', 'círculo verde'),
      e('🔵', 'círculo azul'),
      e('➕', 'más sumar'),
      e('➖', 'menos restar'),
      e('🔁', 'repetir'),
      e('🔄', 'actualizar recargar'),
      e('🆗', 'ok botón'),
      e('🆕', 'nuevo'),
      e('🔝', 'top arriba'),
      e('💤', 'dormir zzz'),
      e('💬', 'globo de diálogo comentario'),
      e('👁️', 'ojo visto'),
    ],
  },
];

/** Todos los emojis aceptados, para validar en O(1). */
const PERMITIDOS: ReadonlySet<string> = new Set(
  CATEGORIAS_EMOJI.flatMap((c) => c.emojis.map((x) => x.e))
);

/** ¿Este texto es un emoji del catálogo, tal cual? */
export function esReaccionPermitida(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.length > 0 && valor.length <= 32 && PERMITIDOS.has(valor);
}

/** Cuántos emojis DISTINTOS puede poner una persona en un mismo mensaje. */
export const MAX_REACCIONES_POR_PERSONA = 10;

/** Quita tildes y pasa a minúsculas, para buscar «corazon» y encontrar «corazón». */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Busca en el catálogo por nombre. Sin texto devuelve []: el selector muestra
 * entonces las categorías.
 */
export function buscarEmojis(consulta: string): EmojiEntrada[] {
  const q = normalizar(consulta);
  if (!q) return [];
  const vistos = new Set<string>();
  const salida: EmojiEntrada[] = [];
  for (const c of CATEGORIAS_EMOJI) {
    for (const x of c.emojis) {
      if (vistos.has(x.e)) continue;
      if (normalizar(x.n).includes(q)) {
        vistos.add(x.e);
        salida.push(x);
      }
    }
  }
  return salida;
}
