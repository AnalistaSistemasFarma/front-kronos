/**
 * SONIDO DE MENSAJE NUEVO en el chat, con la aplicación abierta.
 *
 * Las notificaciones push de la web no permiten un sonido propio; esto es solo
 * dentro de la aplicación. Suena cuando llega un mensaje de OTRA persona o de
 * un agente y la persona no lo está viendo: está en otra conversación, en otra
 * pantalla de SynerLink, o la ventana no tiene el foco.
 *
 * Solo navegador. Estado a nivel de MÓDULO, igual que lib/chat/nudge-fx.ts: el
 * hilo abierto, la bandeja (useChatOverview, montada dos veces) y el pulso son
 * árboles distintos, y lo que comparten no amerita un contexto ni re-renders.
 *
 * Los tonos se SINTETIZAN con Web Audio (mismo contexto que el zumbido): no hay
 * archivos que descargar, cachear ni licenciar. Si el navegador todavía no
 * habilitó el audio (antes del primer toque), no suena y no pasa nada.
 */
import { contextoAudio, momentoUltimoZumbido, prepararAudioZumbido } from './nudge-fx';

/* ──────────────────────────────── Tonos ─────────────────────────────── */

export type TonoMensaje = 'campanita' | 'gota' | 'burbuja' | 'doble' | 'silencio';

export const TONOS_MENSAJE: { id: TonoMensaje; label: string }[] = [
  { id: 'campanita', label: 'Campanita' },
  { id: 'gota', label: 'Gota' },
  { id: 'burbuja', label: 'Burbuja' },
  { id: 'doble', label: 'Doble toque' },
  { id: 'silencio', label: 'Silencio' },
];

const TONO_POR_DEFECTO: TonoMensaje = 'campanita';
const TONO_KEY = 'chat-sonido-mensaje';

function esTono(valor: unknown): valor is TonoMensaje {
  return TONOS_MENSAJE.some((t) => t.id === valor);
}

/** Tono elegido EN ESTE EQUIPO (localStorage). */
export function tonoMensaje(): TonoMensaje {
  try {
    const guardado = localStorage.getItem(TONO_KEY);
    return esTono(guardado) ? guardado : TONO_POR_DEFECTO;
  } catch {
    return TONO_POR_DEFECTO;
  }
}

export function guardarTonoMensaje(tono: TonoMensaje): void {
  try {
    localStorage.setItem(TONO_KEY, tono);
  } catch {
    /* modo privado: la preferencia dura lo que dura la pestaña */
  }
}

/** Una nota corta con ataque rápido y caída exponencial. */
function nota(
  ctx: AudioContext,
  t: number,
  frecuencia: number,
  duracion: number,
  volumen: number,
  tipo: OscillatorType = 'sine',
  hasta?: number
): void {
  const osc = ctx.createOscillator();
  const gan = ctx.createGain();
  osc.type = tipo;
  osc.frequency.setValueAtTime(frecuencia, t);
  if (hasta) osc.frequency.exponentialRampToValueAtTime(hasta, t + duracion * 0.6);
  gan.gain.setValueAtTime(0.0001, t);
  gan.gain.exponentialRampToValueAtTime(volumen, t + 0.008);
  gan.gain.exponentialRampToValueAtTime(0.0001, t + duracion);
  osc.connect(gan).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duracion + 0.02);
}

/** Volumen moderado: ningún tono pasa de ~0,12 de ganancia. */
function tocar(ctx: AudioContext, tono: TonoMensaje): void {
  const t = ctx.currentTime + 0.01;
  switch (tono) {
    case 'campanita':
      // Do6 → Mi6, con un armónico suave: "ding-ding" de mensajería.
      nota(ctx, t, 1046.5, 0.35, 0.1);
      nota(ctx, t, 2093, 0.2, 0.025);
      nota(ctx, t + 0.12, 1318.5, 0.45, 0.1);
      nota(ctx, t + 0.12, 2637, 0.25, 0.025);
      break;
    case 'gota':
      // Barrido corto hacia arriba: "plip".
      nota(ctx, t, 750, 0.18, 0.12, 'sine', 1500);
      break;
    case 'burbuja':
      // Dos "pop" graves y rápidos.
      nota(ctx, t, 380, 0.09, 0.12, 'sine', 820);
      nota(ctx, t + 0.09, 520, 0.11, 0.1, 'sine', 1100);
      break;
    case 'doble':
      // Dos toques iguales, tipo marimba.
      nota(ctx, t, 880, 0.14, 0.09, 'triangle');
      nota(ctx, t + 0.15, 880, 0.18, 0.09, 'triangle');
      break;
    case 'silencio':
      break;
  }
}

/**
 * Vista previa al elegir un tono. Se llama DENTRO del gesto (clic en el menú),
 * así que puede crear y habilitar el contexto aunque fuera el primer toque.
 */
export function previsualizarTono(tono: TonoMensaje): void {
  if (tono === 'silencio') return;
  prepararAudioZumbido();
  const ctx = contextoAudio(true);
  if (!ctx) return;
  const sonarYa = () => {
    try {
      tocar(ctx, tono);
    } catch {
      /* adorno: si falla, no pasa nada */
    }
  };
  if (ctx.state === 'running') sonarYa();
  else void ctx.resume().then(sonarYa, () => undefined);
}

/* ───────────────────────── Qué está viendo ahora ────────────────────── */

let hiloAbierto: number | null = null;

/**
 * Lo llama ChatThread con el id del hilo que está a la vista (cualquier clase:
 * agente, grupo o persona), y null al cerrarlo.
 */
export function registrarHiloAbierto(idConversation: number | null): void {
  hiloAbierto = idConversation;
}

/** Cierra el registro solo si sigue siendo ese hilo (otro ya pudo abrirse). */
export function soltarHiloAbierto(idConversation: number): void {
  if (hiloAbierto === idConversation) hiloAbierto = null;
}

/** ¿La persona tiene ESE hilo delante, con la pestaña visible y con foco? */
function loEstaViendo(idConversation: number): boolean {
  if (typeof document === 'undefined') return false;
  if (hiloAbierto !== idConversation) return false;
  if (document.visibilityState !== 'visible') return false;
  try {
    return document.hasFocus();
  } catch {
    return true;
  }
}

/* ─────────────────────────────── Aviso ──────────────────────────────── */

/** Varios mensajes seguidos suenan como mucho una vez cada 4 s. */
export const SONIDO_ANTIRREBOTE_MS = 4_000;
/** Un mensaje más viejo que esto ya no hace ruido (volver tras un rato). */
export const SONIDO_FRESCO_MS = 2 * 60_000;

let ultimoSonidoAt = 0;

/** ¿Es lo bastante reciente para sonar? */
export function mensajeFresco(createdAt: string | null | undefined, ahora = Date.now()): boolean {
  if (!createdAt) return false;
  const t = Date.parse(createdAt);
  return !Number.isNaN(t) && ahora - t < SONIDO_FRESCO_MS;
}

/**
 * Llegó un mensaje nuevo de otra persona o de un agente en esa conversación.
 * Decide si suena: no si lo está viendo, no en silencio, no si acaba de sonar
 * (este u otro mensaje, o un zumbido).
 */
export function avisarMensajeEntrante(idConversation: number): void {
  if (typeof window === 'undefined') return;
  if (loEstaViendo(idConversation)) return;
  const tono = tonoMensaje();
  if (tono === 'silencio') return;
  const ahora = Date.now();
  if (ahora - ultimoSonidoAt < SONIDO_ANTIRREBOTE_MS) return;
  if (ahora - momentoUltimoZumbido() < SONIDO_ANTIRREBOTE_MS) return;
  const ctx = contextoAudio(false);
  // Sin gesto previo el navegador no deja sonar: se falla en silencio.
  if (!ctx || ctx.state !== 'running') return;
  ultimoSonidoAt = ahora;
  try {
    tocar(ctx, tono);
  } catch {
    /* adorno */
  }
}

/* ───────────────────── No leídos de la bandeja ──────────────────────── */

/*
 * La bandeja (useChatOverview) se sondea cada 30 s y al instante con el pulso
 * de personas. Un no leído que SUBE es un mensaje entrante en un hilo que no
 * está abierto (o sí, pero sin foco). La línea base es por usuario y a nivel de
 * módulo: la bandeja se monta dos veces (cabecera y página del chat) y la
 * primera respuesta solo fija la base — el historial no suena.
 */
let base: { email: string; noLeidos: Map<number, number> } | null = null;

export function revisarNoLeidos(
  email: string | null | undefined,
  conversaciones: {
    id: number;
    unreadCount: number;
    lastMessage?: { createdAt: string } | null;
  }[]
): void {
  if (!email) return;
  const actual = new Map<number, number>();
  for (const c of conversaciones) actual.set(c.id, c.unreadCount);
  if (!base || base.email !== email) {
    base = { email, noLeidos: actual };
    return;
  }
  const previo = base.noLeidos;
  base.noLeidos = actual;
  for (const c of conversaciones) {
    const antes = previo.get(c.id) ?? 0;
    if (c.unreadCount > antes && mensajeFresco(c.lastMessage?.createdAt)) {
      // El antirrebote deja sonar solo al primero que no se esté viendo.
      avisarMensajeEntrante(c.id);
    }
  }
}

/** Al cerrar la sesión: la siguiente persona arranca con base nueva. */
export function olvidarNoLeidos(): void {
  base = null;
}
