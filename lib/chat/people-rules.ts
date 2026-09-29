/**
 * MENSAJES ENTRE PERSONAS ("Personas") — reglas puras, sin base de datos.
 *
 * Pedido y aprobado por Nicolás Rivera el 2026-09-29 (plan en el vault:
 * research/2026-09-29-plan-mensajes-directos-zumbido-synerlink.md).
 *
 * Una conversación `kind = 'people'` es un hilo privado entre DOS personas,
 * sin agentes. Vive aquí aparte de lib/chat/people.ts (que sí toca la base)
 * para poder probar las reglas sin Prisma: son las que deciden quién puede
 * escribirle a quién, y una regla de acceso sin pruebas es un hueco esperando.
 *
 * Este archivo NO importa nada de servidor: también lo usa el navegador.
 */

/** Subproceso del PILOTO (decisión D2): quien lo tenga puede INICIAR hilos. */
export const CHAT_PEOPLE_URL = '/process/chat/personas';

/**
 * `code` del agente CENTINELA. `chat_conversation.id_agent` es NOT NULL (ver
 * la nota de prisma/migrations/20260908180000_add_chat_groups), así que un
 * hilo entre personas necesita un agente para llenar la columna. Este agente
 * está inactivo y sin subproceso: nadie lo ve, ninguna llave lo autentica y
 * no aparece en el organigrama ni en la auditoría (todos filtran por
 * `is_active`).
 */
export const PEOPLE_SENTINEL_AGENT_CODE = 'personas';

/** Rol de los proveedores externos: nunca entran al chat entre personas. */
export const SUPPLIER_ROLE_CHAT = 'supplier';

/** Mínimo de caracteres para buscar personas (evita listar el directorio). */
export const MIN_PEOPLE_SEARCH_CHARS = 2;

/** Tope de resultados del buscador de personas. */
export const MAX_PEOPLE_SEARCH_HITS = 20;

/** Tope de la columna `chat_conversation.dm_key` (NVARCHAR(120)). */
export const MAX_DM_KEY_CHARS = 120;

/**
 * Clave ÚNICA del par de personas. Con ella y un índice único filtrado en la
 * base, dos personas no pueden terminar con dos hilos: si las dos abren la
 * conversación al mismo tiempo, una de las dos inserciones choca y relee.
 *
 * El orden del par no importa (A→B y B→A dan la misma clave). Si los ids
 * fueran tan largos que la clave no cupiera en la columna, se usa un resumen
 * SHA-256 del par — igual de único a efectos prácticos y siempre de 64
 * caracteres —. `hash` se inyecta para que esta función siga siendo pura y se
 * pueda usar sin `crypto` del servidor.
 */
export function buildDmKey(
  idUserA: string,
  idUserB: string,
  hash: (texto: string) => string
): string {
  const a = idUserA.trim();
  const b = idUserB.trim();
  if (!a || !b) throw new Error('buildDmKey: faltan los dos ids.');
  if (a === b) throw new Error('buildDmKey: una persona no conversa consigo misma.');
  const [menor, mayor] = a < b ? [a, b] : [b, a];
  const clave = `${menor}:${mayor}`;
  if (clave.length <= MAX_DM_KEY_CHARS) return clave;
  return `h:${hash(clave)}`;
}

/** Lo que hace falta de una persona para decidir si puede conversar. */
export interface PersonaParaAcceso {
  id: string;
  isActive: boolean;
  role: string | null;
  /** Empresas donde tiene el módulo de Chat (`/process/chat`). */
  empresasChat: ReadonlySet<number>;
  /** Empresas donde tiene el piloto (`/process/chat/personas`). */
  empresasPersonas: ReadonlySet<number>;
}

/** Empresas donde LAS DOS personas tienen el módulo de Chat. */
export function empresasCompartidas(a: PersonaParaAcceso, b: PersonaParaAcceso): number[] {
  const comunes: number[] = [];
  for (const id of a.empresasChat) if (b.empresasChat.has(id)) comunes.push(id);
  return comunes.sort((x, y) => x - y);
}

function esElegible(p: PersonaParaAcceso): boolean {
  return p.isActive && (p.role ?? '').trim().toLowerCase() !== SUPPLIER_ROLE_CHAT;
}

/**
 * REGLA D1 — ¿pueden escribirse estas dos personas?
 *
 * Las dos activas, ninguna proveedor, y comparten AL MENOS una empresa donde
 * las dos tienen el módulo de Chat. Se evalúa en CADA llamada (no queda
 * guardada en el hilo): si a alguien le quitan el módulo o lo desactivan, el
 * hilo se cierra en la siguiente vuelta del sondeo, sin limpiar nada a mano.
 */
export function puedenEscribirse(a: PersonaParaAcceso, b: PersonaParaAcceso): boolean {
  if (a.id === b.id) return false;
  if (!esElegible(a) || !esElegible(b)) return false;
  return empresasCompartidas(a, b).length > 0;
}

/**
 * REGLA D2 — ¿puede `iniciador` ABRIR un hilo nuevo con `destino`?
 *
 * Además de la D1, quien inicia tiene que tener el piloto
 * (`/process/chat/personas`) en alguna de las empresas compartidas. Quien
 * RECIBE no necesita el piloto: le basta el módulo de Chat para leer y
 * contestar lo que le escribieron.
 */
export function puedeIniciar(iniciador: PersonaParaAcceso, destino: PersonaParaAcceso): boolean {
  if (!puedenEscribirse(iniciador, destino)) return false;
  return empresasCompartidas(iniciador, destino).some((id) => iniciador.empresasPersonas.has(id));
}

/** Empresas donde `persona` puede iniciar hilos: tiene Chat Y el piloto. */
export function empresasParaIniciar(persona: PersonaParaAcceso): number[] {
  if (!esElegible(persona)) return [];
  return [...persona.empresasPersonas].filter((id) => persona.empresasChat.has(id)).sort((x, y) => x - y);
}

/* ==================================================================== */
/* ZUMBIDO (fase 2) — decisiones D4, D5 y D6 de Nicolás, 2026-09-29      */
/* ==================================================================== */

/** Marca de evento del mensaje de sistema que ES un zumbido. */
export const NUDGE_EVENT_TYPE = 'nudge';

/** D4: uno cada 30 s por conversación y remitente. */
export const NUDGE_COOLDOWN_MS = 30_000;

/** D4: y como mucho diez cada diez minutos por remitente, en total. */
export const NUDGE_WINDOW_MS = 10 * 60_000;
export const NUDGE_MAX_PER_WINDOW = 10;

/** Patrón de vibración del zumbido (Android; iOS no vibra desde la web). */
export const NUDGE_VIBRATE_PATTERN = [200, 100, 200, 100, 400];

/** Texto del mensaje de sistema que deja el zumbido en el hilo. */
export function textoDeZumbido(nombreRemitente: string): string {
  const nombre = nombreRemitente.trim() || 'Alguien';
  return `📳 ${nombre} envió un zumbido.`;
}

/**
 * Segundos que faltan para poder volver a zumbar en ESTE hilo, a partir del
 * último zumbido propio. 0 = ya se puede. Redondea hacia arriba: decir "0 s"
 * cuando faltan 300 ms haría que el reintento vuelva a chocar.
 */
export function segundosParaReintentar(
  ultimoZumbido: Date | null,
  ahora: Date,
  espera: number = NUDGE_COOLDOWN_MS
): number {
  if (!ultimoZumbido) return 0;
  const falta = ultimoZumbido.getTime() + espera - ahora.getTime();
  return falta > 0 ? Math.ceil(falta / 1000) : 0;
}

/**
 * Tope global por remitente: con los zumbidos que envió en la ventana (los
 * más viejos primero), ¿cuántos segundos faltan para poder mandar otro? 0 = ya
 * se puede.
 */
export function segundosPorTopeDeVentana(
  enviadosEnVentana: Date[],
  ahora: Date,
  maximo: number = NUDGE_MAX_PER_WINDOW,
  ventana: number = NUDGE_WINDOW_MS
): number {
  const desde = ahora.getTime() - ventana;
  const vigentes = enviadosEnVentana
    .map((d) => d.getTime())
    .filter((t) => t > desde)
    .sort((a, b) => a - b);
  if (vigentes.length < maximo) return 0;
  // Se libera un cupo cuando el más viejo de los que cuentan sale de la ventana.
  const libera = vigentes[vigentes.length - maximo] + ventana;
  return Math.max(1, Math.ceil((libera - ahora.getTime()) / 1000));
}

/* ==================================================================== */
/* PULSO GLOBAL (decisión D9: long-poll respaldado en SQL, sin SSE)      */
/* ==================================================================== */

/** Segundos que el servidor sostiene cada vuelta del pulso. */
export const PULSE_WAIT_SECONDS = 20;
/** Cada cuánto revisa la base el pulso mientras espera. */
export const PULSE_TICK_MS = 1_000;
/** Tope de eventos por vuelta. */
export const PULSE_MAX_EVENTS = 20;
/**
 * Un zumbido más viejo que esto ya no sacude ni suena: llega en la bandeja,
 * pero hacer ruido por algo de hace diez minutos (p. ej. al volver a la
 * pestaña) confunde más de lo que avisa.
 */
export const NUDGE_FRESH_MS = 2 * 60_000;

/** Un evento del pulso: algo nuevo en un hilo entre personas. */
export interface ChatPulseEvent {
  type: 'message' | 'nudge';
  idConversation: number;
  idMessage: number;
  /** Quién lo escribió o zumbó. */
  authorName: string;
  createdAt: string;
  /** Solo en 'nudge': yo silencié los zumbidos de ese hilo. */
  muted: boolean;
}
