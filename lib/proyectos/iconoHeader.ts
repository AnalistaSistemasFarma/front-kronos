import { PROJECTS_MODULE_URL } from '../chat/projects-rules';
import { etiquetaNoLeidos } from '../correo/iconoHeader';

/**
 * Icono «Proyectos» en la cabecera, junto al del Correo y la campana (2026-10-19,
 * Nicolás Rivera: «quiero que en el header también tenga su iconito y si alguien
 * escribe en alguno de los chats se pueda ver»). Lógica PURA (sin React ni red),
 * con el mismo patrón de lib/correo/iconoHeader.ts.
 *
 * Regla de visibilidad: el icono solo aparece si /api/proyectos/no-leidos
 * respondió 200, es decir, el servidor confirmó sesión + permiso del módulo
 * (subproceso «/process/proyectos» en alguna empresa). Sin sesión (401), sin
 * permiso (403), con error o sin respuesta aún: NO se muestra.
 *
 * Actualización: el PULSO del chat (/api/chat/pulse, components/chat/ChatPulse.tsx)
 * avisa con EVENTO_ACTIVIDAD_PROYECTOS cuando entra un mensaje en una conversación
 * de proyecto; abrir una conversación avisa con EVENTO_PROYECTO_LEIDO. Fuera de
 * eso, una consulta liviana cada TTL con la pestaña visible (como el Correo).
 */

export { etiquetaNoLeidos };

export const PROYECTOS_HREF = PROJECTS_MODULE_URL;
/** Cuánto vale en el navegador la respuesta (permiso + contador) sin aviso del pulso. */
export const ICONO_PROYECTOS_TTL_MS = 3 * 60_000;
/** Sin el módulo: cada cuánto se vuelve a confirmar (si se lo asignan, aparece al recargar). */
export const ICONO_PROYECTOS_SIN_MODULO_TTL_MS = 30 * 60_000;
/** Espera antes de la primera consulta: no compite con la carga de la página. */
export const ICONO_PROYECTOS_RETRASO_MS = 1_500;
/** Varios avisos seguidos del pulso se juntan en una sola consulta. */
export const ICONO_PROYECTOS_ANTIRREBOTE_MS = 800;
const CLAVE_STORAGE = 'synerlink:proyectos-icono:v1';

/** Entró un mensaje en una conversación de proyecto (lo emite ChatPulse). */
export const EVENTO_ACTIVIDAD_PROYECTOS = 'proyectos:actividad';
/** La persona leyó una conversación de proyecto (lo emite useChatConversation). */
export const EVENTO_PROYECTO_LEIDO = 'proyectos:leido';

export interface EstadoIconoProyectos {
  /** Correo de la sesión al que pertenece (al cambiar de usuario no se reutiliza). */
  email: string;
  visible: boolean;
  /** Conversaciones con mensajes nuevos. */
  noLeidos: number | null;
  /** Mensajes nuevos en total. */
  mensajes: number | null;
  /** Epoch ms de la consulta. */
  en: number;
}

/** Fila del panel desplegable (lo que devuelve GET /api/proyectos/no-leidos?detalle=1). */
export interface ItemNoLeidoDto {
  idProject: number;
  projectName: string;
  idConversation: number;
  conversationTitle: string;
  agent: { code: string; displayName: string };
  noLeidos: number;
  ultimo: { idMessage: number; autor: string; autorTipo: 'persona' | 'agente'; fragmento: string; createdAt: string } | null;
}

function entero(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/** Traduce la respuesta del API al estado del icono. */
export function estadoDesdeRespuesta(email: string, status: number, body: unknown, ahora: number): EstadoIconoProyectos {
  // Sin el módulo el servidor responde 200 `{ habilitado: false }` (antes 403).
  const habilitado = !(body && typeof body === 'object' && (body as { habilitado?: unknown }).habilitado === false);
  const visible = status === 200 && habilitado;
  const b = visible && body && typeof body === 'object' ? (body as { noLeidos?: unknown; mensajes?: unknown }) : null;
  return { email, visible, noLeidos: b ? entero(b.noLeidos) : null, mensajes: b ? entero(b.mensajes) : null, en: ahora };
}

/** ¿Se pinta el icono? Solo con sesión y un estado confirmado por el servidor para ESA sesión. */
export function debeMostrarIconoProyectos(sesionEmail: string | null | undefined, estado: EstadoIconoProyectos | null): boolean {
  if (!sesionEmail || !estado) return false;
  return estado.email.toLowerCase() === sesionEmail.toLowerCase() && estado.visible;
}

/** ¿Hay que volver a consultar? */
export function estadoVencido(estado: EstadoIconoProyectos | null, sesionEmail: string, ahora: number, ttl = ICONO_PROYECTOS_TTL_MS): boolean {
  if (!estado || estado.email.toLowerCase() !== sesionEmail.toLowerCase()) return true;
  // Sin el módulo casi siempre la respuesta sigue igual: se vuelve a preguntar con menos frecuencia.
  const vigencia = estado.visible ? ttl : Math.max(ttl, ICONO_PROYECTOS_SIN_MODULO_TTL_MS);
  return ahora - estado.en >= vigencia || ahora < estado.en;
}

/** Etiqueta accesible del botón. */
export function ariaIconoProyectos(n: number | null): string {
  if (n == null || n <= 0) return 'Proyectos';
  return n === 1 ? 'Proyectos: 1 conversación con mensajes nuevos' : `Proyectos: ${n} conversaciones con mensajes nuevos`;
}

/** Enlace que abre ESA conversación dentro de su proyecto. */
export function urlConversacion(idProject: number, idConversation: number): string {
  return `${PROYECTOS_HREF}/${idProject}?conversacion=${idConversation}`;
}

/**
 * Al abrir una conversación desde el panel: se quita su fila y se descuenta del
 * número al instante (optimista); la siguiente consulta trae la verdad.
 */
export function sinConversacion(
  estado: EstadoIconoProyectos | null,
  items: ItemNoLeidoDto[],
  idConversation: number
): { estado: EstadoIconoProyectos | null; items: ItemNoLeidoDto[] } {
  const fila = items.find((i) => i.idConversation === idConversation);
  if (!fila) return { estado, items };
  const resto = items.filter((i) => i.idConversation !== idConversation);
  if (!estado) return { estado, items: resto };
  return {
    estado: {
      ...estado,
      noLeidos: estado.noLeidos == null ? null : Math.max(0, estado.noLeidos - 1),
      mensajes: estado.mensajes == null ? null : Math.max(0, estado.mensajes - fila.noLeidos),
    },
    items: resto,
  };
}

/** Hora corta del último mensaje: «Ahora», «Hace 5 min», «Hace 3 h», «Ayer 14:20» o la fecha. */
export function horaCorta(iso: string, ahora = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const min = Math.floor((ahora - t) / 60_000);
  if (min < 1) return 'Ahora';
  if (min < 60) return `Hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Hace ${h} h`;
  const d = new Date(t);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (h < 48) return `Ayer ${hhmm}`;
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
}

/* ───────────────────────────── Eventos del navegador ───────────────────────────── */

function emitir(nombre: string, detail: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(nombre, { detail }));
  } catch {
    /* navegador sin CustomEvent: el icono se entera en la próxima consulta */
  }
}

export function avisarActividadProyectos(idsConversacion: number[]): void {
  if (idsConversacion.length > 0) emitir(EVENTO_ACTIVIDAD_PROYECTOS, { idsConversacion });
}

export function avisarProyectoLeido(idConversation: number): void {
  emitir(EVENTO_PROYECTO_LEIDO, { idConversation });
}

/* ───────────────────────────── Caché de la pestaña ───────────────────────────── */

/** Lee el estado guardado en la pestaña (sessionStorage); nunca lanza. */
export function leerEstadoGuardado(storage: Pick<Storage, 'getItem'> | null | undefined): EstadoIconoProyectos | null {
  try {
    const raw = storage?.getItem(CLAVE_STORAGE);
    if (!raw) return null;
    const e = JSON.parse(raw) as Partial<EstadoIconoProyectos>;
    if (typeof e.email !== 'string' || typeof e.visible !== 'boolean' || typeof e.en !== 'number') return null;
    return { email: e.email, visible: e.visible, noLeidos: entero(e.noLeidos), mensajes: entero(e.mensajes), en: e.en };
  } catch {
    return null;
  }
}

export function guardarEstado(storage: Pick<Storage, 'setItem'> | null | undefined, e: EstadoIconoProyectos): void {
  try {
    storage?.setItem(CLAVE_STORAGE, JSON.stringify(e));
  } catch {
    /* almacenamiento bloqueado: solo se pierde la caché */
  }
}

export function borrarEstado(storage: Pick<Storage, 'removeItem'> | null | undefined): void {
  try {
    storage?.removeItem(CLAVE_STORAGE);
  } catch {
    /* nada */
  }
}
