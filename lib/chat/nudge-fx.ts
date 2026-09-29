/**
 * EFECTOS del zumbido 📳 en el navegador: sonido, vibración, sacudida, título
 * parpadeante y la coordinación entre el hilo abierto y el pulso global.
 *
 * Solo navegador (no importa nada de servidor). Estado a nivel de MÓDULO a
 * propósito: el hilo (ChatThread) y el pulso (ChatPulse, en la cabecera) son
 * dos árboles de React distintos, y lo que comparten —"este zumbido ya se
 * mostró", "este hilo está a la vista"— no amerita un contexto ni re-renders.
 */
import { NUDGE_FRESH_MS, NUDGE_VIBRATE_PATTERN } from './people-rules';

/* ───────────────────────── Zumbidos ya mostrados ─────────────────────── */

/**
 * Ids de mensaje de zumbido que ya hicieron su efecto en esta pestaña. Evita
 * el doble aviso cuando el mismo zumbido llega por el sondeo del hilo Y por el
 * pulso. Se recorta para no crecer sin límite en una pestaña que vive días.
 */
const mostrados = new Set<number>();

/** Marca el zumbido como mostrado. Devuelve false si YA lo estaba. */
export function marcarZumbidoMostrado(idMessage: number): boolean {
  if (mostrados.has(idMessage)) return false;
  mostrados.add(idMessage);
  if (mostrados.size > 200) {
    const primero = mostrados.values().next().value;
    if (primero !== undefined) mostrados.delete(primero);
  }
  return true;
}

/** ¿Es lo bastante reciente para hacer ruido? (ver NUDGE_FRESH_MS) */
export function zumbidoFresco(createdAt: string, ahora: number = Date.now()): boolean {
  const t = Date.parse(createdAt);
  return !Number.isNaN(t) && ahora - t < NUDGE_FRESH_MS;
}

/* ─────────────────────── Hilo a la vista ahora mismo ─────────────────── */

let hiloVisible: number | null = null;

/** Lo llama ChatThread al abrir/cerrar un hilo entre personas. */
export function registrarHiloVisible(idConversation: number | null): void {
  hiloVisible = idConversation;
}

/**
 * ¿Esta conversación está abierta Y la pestaña a la vista? Si sí, el hilo se
 * encarga del efecto (sacudida) y el pulso no pone el aviso flotante encima.
 */
export function hiloEstaALaVista(idConversation: number): boolean {
  return (
    hiloVisible === idConversation &&
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible'
  );
}

/* ──────────────────────────── Preferencia ───────────────────────────── */

const SONIDO_KEY = 'chat-zumbido-sonido';

/** Sonido de los zumbidos EN ESTE EQUIPO (D5). Activado salvo que lo apaguen. */
export function sonidoZumbidoActivado(): boolean {
  try {
    return localStorage.getItem(SONIDO_KEY) !== '0';
  } catch {
    return true;
  }
}

export function guardarSonidoZumbido(activado: boolean): void {
  try {
    localStorage.setItem(SONIDO_KEY, activado ? '1' : '0');
  } catch {
    /* modo privado: la preferencia dura lo que dura la pestaña */
  }
}

/* ────────────────────────────── Sonido ──────────────────────────────── */

/*
 * Sonido SINTETIZADO con Web Audio: no hay archivo que descargar ni que
 * cachear. Los navegadores bloquean el audio hasta que la persona interactúa
 * con la página, así que el contexto se crea (y se "desbloquea") en el primer
 * `pointerdown` o tecla; antes de eso el zumbido llega sin sonido, con la
 * sacudida y el aviso igual.
 */
let audio: AudioContext | null = null;
let desbloqueoInstalado = false;

function crearAudio(): AudioContext | null {
  if (audio) return audio;
  const Ctor =
    typeof window !== 'undefined'
      ? window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
  if (!Ctor) return null;
  try {
    audio = new Ctor();
  } catch {
    audio = null;
  }
  return audio;
}

/** Instala (una sola vez) el desbloqueo del audio con el primer gesto. */
export function prepararAudioZumbido(): void {
  if (desbloqueoInstalado || typeof window === 'undefined') return;
  desbloqueoInstalado = true;
  const desbloquear = () => {
    const ctx = crearAudio();
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    window.removeEventListener('pointerdown', desbloquear);
    window.removeEventListener('keydown', desbloquear);
  };
  window.addEventListener('pointerdown', desbloquear, { passive: true });
  window.addEventListener('keydown', desbloquear);
}

function sonar(): void {
  if (!sonidoZumbidoActivado()) return;
  const ctx = audio;
  if (!ctx || ctx.state !== 'running') return;
  try {
    // Tres golpes graves y cortos: "brr-brr-brr", no una alarma.
    const inicio = ctx.currentTime + 0.01;
    for (let i = 0; i < 3; i += 1) {
      const t = inicio + i * 0.14;
      const osc = ctx.createOscillator();
      const gan = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(150, t);
      gan.gain.setValueAtTime(0.0001, t);
      gan.gain.exponentialRampToValueAtTime(0.08, t + 0.01);
      gan.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      osc.connect(gan).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.11);
    }
  } catch {
    /* el sonido es un adorno: si falla, el zumbido igual se ve */
  }
}

function vibrar(): void {
  try {
    // Android sí; iOS/Safari no expone la vibración a la web.
    navigator.vibrate?.(NUDGE_VIBRATE_PATTERN);
  } catch {
    /* sin vibración */
  }
}

/* ───────────────────────────── Sacudida ─────────────────────────────── */

function prefiereMenosMovimiento(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Sacude el contenedor del hilo 500 ms. Se hace con una CLASE sobre el nodo,
 * sin estado de React: el hilo no se re-renderiza y las burbujas en `memo`
 * (PR #439) ni se enteran. La animación es solo `transform` (GPU, sin
 * reflow). Con "reducir movimiento" no se sacude: se resalta el borde.
 */
export function sacudirHilo(nodo: HTMLElement | null): void {
  if (!nodo) return;
  const clase = prefiereMenosMovimiento() ? 'chat-thread--zumbido-resalte' : 'chat-thread--zumbido';
  nodo.classList.remove('chat-thread--zumbido', 'chat-thread--zumbido-resalte');
  // Forzar un cuadro para que la animación vuelva a arrancar si llega otro
  // zumbido mientras la anterior termina.
  void nodo.offsetWidth;
  nodo.classList.add(clase);
  window.setTimeout(() => nodo.classList.remove(clase), clase === 'chat-thread--zumbido' ? 520 : 1200);
}

/** Sonido + vibración: lo común a los dos caminos (hilo y pulso). */
export function efectoZumbido(): void {
  sonar();
  vibrar();
}

/* ──────────────────────── Título parpadeante ────────────────────────── */

let parpadeo: number | null = null;
let tituloOriginal: string | null = null;

function pararParpadeo(): void {
  if (parpadeo !== null) {
    window.clearInterval(parpadeo);
    parpadeo = null;
  }
  if (tituloOriginal !== null) {
    document.title = tituloOriginal;
    tituloOriginal = null;
  }
  window.removeEventListener('focus', pararParpadeo);
}

/**
 * Hace parpadear el título de la pestaña SOLO si la ventana no tiene el foco
 * (otra aplicación encima, otra ventana del navegador): si la persona la está
 * usando, ya vio el aviso. Se detiene al volver a la ventana o a los 15 s, y
 * devuelve el título que había.
 */
export function parpadearTitulo(texto: string): void {
  if (typeof document === 'undefined' || document.hasFocus()) return;
  pararParpadeo();
  tituloOriginal = document.title;
  let alterna = false;
  const inicio = Date.now();
  parpadeo = window.setInterval(() => {
    if (Date.now() - inicio > 15_000) {
      pararParpadeo();
      return;
    }
    alterna = !alterna;
    document.title = alterna ? texto : (tituloOriginal ?? document.title);
  }, 1000);
  window.addEventListener('focus', pararParpadeo);
}
