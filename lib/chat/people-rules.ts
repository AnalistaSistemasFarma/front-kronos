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
