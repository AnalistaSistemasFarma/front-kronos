/**
 * MESAS DE DISCUSIÓN de un proyecto — reglas PURAS (sin base de datos).
 *
 * Pedido de Nicolás Rivera (2026-11-04): «que en el panel de proyectos podamos
 * decir que los agentes discutan de un tema en específico, todo el tiempo… pero
 * que el operador vea lo que está pasando». Diseño: docs/proyectos-mesas-discusion.md.
 *
 * Una mesa es una conversación de proyecto cuyo principal es el MODERADOR, con
 * varios agentes participantes que hablan POR TURNOS. Solo el motor reparte los
 * turnos (un aviso de sistema + una fila de entrega para el agente de turno): los
 * agentes no se invocan entre ellos, así que no hay cadenas ni bucles.
 *
 * Aquí vive la máquina de estados: qué toca hacer en cada «tick» y después de
 * cada respuesta. El acceso a la base y la publicación están en mesas.ts.
 */

/* ───────────────────────────── Configuración ───────────────────────────── */

export const MESA_RITMO_MIN = { def: 30, min: 10, max: 240 } as const;
export const MESA_TOPE_DIA = { def: 40, min: 1, max: 200 } as const;
export const MESA_SINTESIS_CADA = { def: 3, min: 1, max: 10 } as const;
/** Horario por defecto: 07:00–19:00 COT (minutos desde la medianoche). */
export const MESA_HORARIO_DEF = { desde: 7 * 60, hasta: 19 * 60, soloHabiles: true } as const;
/** Un turno sin respuesta se salta a los 20 minutos. */
export const MESA_TURNO_VENCE_MS = 20 * 60_000;
export const MESA_MIN_PARTICIPANTES = 2;
export const MESA_MAX_PARTICIPANTES = 6;
export const MAX_TEMA_CHARS = 2_000;
export const MAX_ROL_CHARS = 80;
/** Marca con la que un agente dice que no tiene nada nuevo. */
export const MARCA_SIN_APORTE = '[SIN APORTE]';

/** Colombia no tiene horario de verano: UTC-5 fijo. */
const COT_OFFSET_MS = -5 * 60 * 60_000;

export type EstadoMesa = 'activa' | 'pausada' | 'cerrada';
/** 'tope' ya no pausa: la mesa sigue activa y espera al día siguiente (ver entregarOTope). */
export type MotivoPausa = 'manual' | 'sin_aporte';

export interface ParticipanteMesa {
  idAgent: number;
  /** Rol corto: «propone», «critica», «verifica datos»… */
  rol: string;
}

export interface ReglasMesa {
  ritmoMin: number;
  topeDia: number;
  sintesisCada: number;
  horarioDesde: number;
  horarioHasta: number;
  soloHabiles: boolean;
}

export interface EntradaMesa {
  tema: unknown;
  participantes: unknown;
  idAgentModerador: unknown;
  reglas?: Partial<Record<keyof ReglasMesa, unknown>>;
}

export interface MesaValida {
  tema: string;
  participantes: ParticipanteMesa[];
  idAgentModerador: number;
  reglas: ReglasMesa;
}

export type Validacion<T> = { ok: true; value: T } | { ok: false; error: string };

function entero(v: unknown, rango: { def: number; min: number; max: number }, nombre: string): Validacion<number> {
  if (v === undefined || v === null || v === '') return { ok: true, value: rango.def };
  const n = typeof v === 'number' ? v : Number.parseInt(String(v), 10);
  if (!Number.isInteger(n) || n < rango.min || n > rango.max) {
    return { ok: false, error: `${nombre} debe estar entre ${rango.min} y ${rango.max}.` };
  }
  return { ok: true, value: n };
}

/** Valida y normaliza las reglas (lo que falte toma el valor por defecto). */
export function normalizarReglasMesa(r: EntradaMesa['reglas'] = {}): Validacion<ReglasMesa> {
  const ritmo = entero(r.ritmoMin, MESA_RITMO_MIN, 'El ritmo (minutos entre rondas)');
  if (!ritmo.ok) return ritmo;
  const tope = entero(r.topeDia, MESA_TOPE_DIA, 'El tope de turnos por día');
  if (!tope.ok) return tope;
  const sintesis = entero(r.sintesisCada, MESA_SINTESIS_CADA, 'La síntesis (cada cuántas rondas)');
  if (!sintesis.ok) return sintesis;
  const desde = entero(r.horarioDesde, { def: MESA_HORARIO_DEF.desde, min: 0, max: 1440 }, 'La hora de inicio');
  if (!desde.ok) return desde;
  const hasta = entero(r.horarioHasta, { def: MESA_HORARIO_DEF.hasta, min: 0, max: 1440 }, 'La hora de fin');
  if (!hasta.ok) return hasta;
  if (hasta.value <= desde.value) return { ok: false, error: 'La hora de fin debe ser posterior a la de inicio.' };
  const soloHabiles = r.soloHabiles === undefined || r.soloHabiles === null ? MESA_HORARIO_DEF.soloHabiles : r.soloHabiles === true;
  return {
    ok: true,
    value: {
      ritmoMin: ritmo.value,
      topeDia: tope.value,
      sintesisCada: sintesis.value,
      horarioDesde: desde.value,
      horarioHasta: hasta.value,
      soloHabiles,
    },
  };
}

/**
 * Valida una mesa nueva. `designados` = agentes designados en el proyecto (los
 * únicos que pueden participar). El moderador debe ser uno de los participantes.
 */
export function validarMesa(e: EntradaMesa, designados: number[]): Validacion<MesaValida> {
  const tema = typeof e.tema === 'string' ? e.tema.trim() : '';
  if (!tema) return { ok: false, error: 'Escriba el tema de la mesa.' };
  if (tema.length > MAX_TEMA_CHARS) return { ok: false, error: `El tema no puede pasar de ${MAX_TEMA_CHARS} caracteres.` };

  if (!Array.isArray(e.participantes)) return { ok: false, error: 'Elija los agentes que participan.' };
  const vistos = new Set<number>();
  const participantes: ParticipanteMesa[] = [];
  for (const p of e.participantes as unknown[]) {
    const idAgent = Number((p as { idAgent?: unknown })?.idAgent);
    const rolRaw = (p as { rol?: unknown })?.rol;
    if (!Number.isInteger(idAgent) || idAgent <= 0) return { ok: false, error: 'Hay un participante no válido.' };
    if (vistos.has(idAgent)) return { ok: false, error: 'Un agente no puede estar dos veces en la mesa.' };
    if (!designados.includes(idAgent)) return { ok: false, error: 'Solo participan agentes designados en el proyecto.' };
    const rol = (typeof rolRaw === 'string' ? rolRaw.replace(/\s+/g, ' ').trim() : '') || 'participa';
    if (rol.length > MAX_ROL_CHARS) return { ok: false, error: `El rol no puede pasar de ${MAX_ROL_CHARS} caracteres.` };
    vistos.add(idAgent);
    participantes.push({ idAgent, rol });
  }
  if (participantes.length < MESA_MIN_PARTICIPANTES) {
    return { ok: false, error: `Una mesa necesita al menos ${MESA_MIN_PARTICIPANTES} agentes.` };
  }
  if (participantes.length > MESA_MAX_PARTICIPANTES) {
    return { ok: false, error: `Una mesa admite máximo ${MESA_MAX_PARTICIPANTES} agentes.` };
  }

  const idAgentModerador = Number(e.idAgentModerador);
  if (!vistos.has(idAgentModerador)) return { ok: false, error: 'El moderador debe ser uno de los participantes.' };

  const reglas = normalizarReglasMesa(e.reglas);
  if (!reglas.ok) return reglas;
  return { ok: true, value: { tema, participantes, idAgentModerador, reglas: reglas.value } };
}

/* ───────────────────────────────── Horario ───────────────────────────────── */

/** Fecha y minuto del día en hora de Colombia. */
function enCOT(fecha: Date): { dia: string; minuto: number; diaSemana: number } {
  const local = new Date(fecha.getTime() + COT_OFFSET_MS);
  return {
    dia: local.toISOString().slice(0, 10),
    minuto: local.getUTCHours() * 60 + local.getUTCMinutes(),
    diaSemana: local.getUTCDay(), // 0 domingo … 6 sábado
  };
}

/** Día (AAAA-MM-DD, hora de Colombia) para el contador de turnos del día. */
export function diaCOT(fecha: Date): string {
  return enCOT(fecha).dia;
}

export function dentroDeHorario(fecha: Date, r: ReglasMesa): boolean {
  const { minuto, diaSemana } = enCOT(fecha);
  if (r.soloHabiles && (diaSemana === 0 || diaSemana === 6)) return false;
  return minuto >= r.horarioDesde && minuto < r.horarioHasta;
}

/** El primer instante >= `fecha` dentro del horario de la mesa. */
export function siguienteEnHorario(fecha: Date, r: ReglasMesa): Date {
  if (dentroDeHorario(fecha, r)) return fecha;
  // Medianoche COT del día de `fecha`, en UTC.
  const local = new Date(fecha.getTime() + COT_OFFSET_MS);
  const medianocheLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  for (let d = 0; d < 8; d += 1) {
    const inicio = new Date(medianocheLocal + d * 86_400_000 + r.horarioDesde * 60_000 - COT_OFFSET_MS);
    if (inicio.getTime() >= fecha.getTime() && dentroDeHorario(inicio, r)) return inicio;
  }
  return fecha; // inalcanzable con reglas válidas
}

/* ───────────────────────────── Máquina de estados ───────────────────────────── */

/** Lo que el motor necesita saber de una mesa para decidir. */
export interface EstadoMotor {
  estado: EstadoMesa;
  reglas: ReglasMesa;
  /** En orden de turno. */
  participantes: ParticipanteMesa[];
  idAgentModerador: number;
  /** Ronda en curso (0 = todavía no empieza). */
  ronda: number;
  /**
   * Turno en curso: índice en `participantes`; `participantes.length` = turno de
   * SÍNTESIS del moderador; -1 = entre rondas (nadie tiene el turno).
   */
  turnoIdx: number;
  /** Cuándo se entregó el turno en curso (para vencerlo). */
  turnoDesde: Date | null;
  /** Cuándo empieza la próxima ronda (solo con turnoIdx = -1). */
  proximoTurnoAt: Date | null;
  /** Turnos entregados hoy y el día (COT) del contador. */
  turnosHoy: number;
  turnosDia: string | null;
  /** Aportes (respuestas que no son «sin aporte») en la ronda en curso. */
  aportesRonda: number;
}

export interface TurnoAEntregar {
  idAgent: number;
  ronda: number;
  turnoIdx: number;
  esSintesis: boolean;
  rol: string;
}

export type Decision =
  | { tipo: 'nada' }
  | { tipo: 'entregar'; turno: TurnoAEntregar; vencido?: { idAgent: number } }
  | { tipo: 'programar'; at: Date; porTope?: boolean; vencido?: { idAgent: number } }
  | { tipo: 'pausar'; motivo: MotivoPausa; vencido?: { idAgent: number } };

function turnosDeHoy(m: EstadoMotor, ahora: Date): number {
  return m.turnosDia === diaCOT(ahora) ? m.turnosHoy : 0;
}

/** Primer instante del día siguiente (COT) dentro del horario. */
export function inicioDiaSiguiente(ahora: Date, r: ReglasMesa): Date {
  const local = new Date(ahora.getTime() + COT_OFFSET_MS);
  const manana = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1) - COT_OFFSET_MS;
  return siguienteEnHorario(new Date(manana), r);
}

/**
 * Entregar el turno `idx` de la ronda `ronda`. Si ya se llegó al tope del día, la
 * mesa NO se pausa: queda entre rondas y retoma con una ronda nueva al día
 * siguiente (así «todo el tiempo» no exige que alguien la reanude cada mañana).
 */
function entregarOTope(m: EstadoMotor, ronda: number, idx: number, ahora: Date): Decision {
  if (turnosDeHoy(m, ahora) >= m.reglas.topeDia) return { tipo: 'programar', at: inicioDiaSiguiente(ahora, m.reglas), porTope: true };
  const esSintesis = idx === m.participantes.length;
  const p = esSintesis ? null : m.participantes[idx];
  return {
    tipo: 'entregar',
    turno: {
      idAgent: esSintesis ? m.idAgentModerador : p!.idAgent,
      ronda,
      turnoIdx: idx,
      esSintesis,
      rol: esSintesis ? 'moderador: síntesis' : p!.rol,
    },
  };
}

/** Lo que sigue cuando el turno `idx` terminó (con o sin aporte ya contado en `aportes`). */
function despuesDelTurno(m: EstadoMotor, idx: number, aportes: number, ahora: Date): Decision {
  const n = m.participantes.length;
  if (idx < n - 1) return entregarOTope(m, m.ronda, idx + 1, ahora);
  if (idx === n - 1) {
    // Fin de la ronda de participantes.
    if (aportes === 0) return { tipo: 'pausar', motivo: 'sin_aporte' };
    if (m.ronda % m.reglas.sintesisCada === 0) return entregarOTope(m, m.ronda, n, ahora);
  }
  // Fin de la ronda (o de la síntesis): la próxima, según el ritmo y el horario.
  const at = siguienteEnHorario(new Date(ahora.getTime() + m.reglas.ritmoMin * 60_000), m.reglas);
  return { tipo: 'programar', at };
}

/**
 * TICK: lo que toca hacer ahora, sin que nadie haya respondido. Se llama desde la
 * bandeja de los puentes (motor perezoso) y desde «ronda ahora».
 *   - turno vencido (sin respuesta en 20 min): se salta como «sin aporte»;
 *   - entre rondas y ya es la hora (dentro del horario): empieza la ronda siguiente.
 */
export function decidirTick(m: EstadoMotor, ahora: Date, opciones: { forzar?: boolean } = {}): Decision {
  if (m.estado !== 'activa') return { tipo: 'nada' };

  if (m.turnoIdx >= 0) {
    if (!m.turnoDesde || ahora.getTime() - m.turnoDesde.getTime() < MESA_TURNO_VENCE_MS) return { tipo: 'nada' };
    const idAgent =
      m.turnoIdx === m.participantes.length ? m.idAgentModerador : m.participantes[m.turnoIdx]?.idAgent ?? m.idAgentModerador;
    const d = despuesDelTurno(m, m.turnoIdx, m.aportesRonda, ahora);
    return { ...d, vencido: { idAgent } } as Decision;
  }

  const esHora = opciones.forzar || (m.proximoTurnoAt !== null && m.proximoTurnoAt.getTime() <= ahora.getTime());
  if (!esHora) return { tipo: 'nada' };
  if (!opciones.forzar && !dentroDeHorario(ahora, m.reglas)) {
    return { tipo: 'programar', at: siguienteEnHorario(ahora, m.reglas) };
  }
  return entregarOTope(m, m.ronda + 1, 0, ahora);
}

/**
 * RESPUESTA: el agente de turno publicó en la mesa. `aporte` = false si dijo
 * «[SIN APORTE]». Un agente que publica fuera de su turno no mueve nada.
 */
export function decidirTrasRespuesta(m: EstadoMotor, idAgentAutor: number, aporte: boolean, ahora: Date): Decision {
  if (m.estado !== 'activa' || m.turnoIdx < 0) return { tipo: 'nada' };
  const n = m.participantes.length;
  const deTurno = m.turnoIdx === n ? m.idAgentModerador : m.participantes[m.turnoIdx]?.idAgent;
  if (deTurno !== idAgentAutor) return { tipo: 'nada' };
  const aportes = m.turnoIdx < n && aporte ? m.aportesRonda + 1 : m.aportesRonda;
  return despuesDelTurno(m, m.turnoIdx, aportes, ahora);
}

/** ¿La respuesta dice que no hay nada nuevo? (la marca, al inicio o sola). */
export function esSinAporte(body: string): boolean {
  const t = body.trim().toUpperCase();
  return t.startsWith(MARCA_SIN_APORTE) || t === 'SIN APORTE' || t === 'SIN APORTE.';
}

/* ───────────────────────────── Textos ───────────────────────────── */

/*
 * LENGUAJE PARA EL OPERADOR (Nicolás Rivera, 2026-11-04): «quiero que sea
 * entendible para el operador, porque hablan muy técnico entre los dos y no se
 * entiende lo que hacen los agentes». Por eso hay DOS textos por turno:
 *
 *   - textoAvisoTurno: lo que se PUBLICA en el hilo. Corto y en palabras de
 *     todos los días: de quién es el turno y qué papel cumple. Nada de reglas
 *     internas ni de instrucciones para el modelo.
 *   - instruccionesTurno: lo que RECIBE el agente (la bandeja lo agrega al aviso
 *     al entregarlo; no queda guardado en el hilo). Le exige escribir para una
 *     persona que no es técnica y empezar con una línea «En pocas palabras».
 *
 * resumenParaOperador saca esa línea de cada respuesta para el panel en vivo.
 */

/** Etiqueta con la que el agente abre cada intervención. */
export const ETIQUETA_RESUMEN = 'En pocas palabras:';
/** Tope de la línea de resumen que se muestra en el panel. */
export const MAX_RESUMEN_CHARS = 280;

/** El aviso de turno que se publica en el hilo: corto y entendible para cualquiera. */
export function textoAvisoTurno(opciones: {
  turno: TurnoAEntregar;
  handle: string;
  nombre: string;
  totalParticipantes: number;
}): string {
  const { turno, handle, nombre, totalParticipantes } = opciones;
  if (turno.esSintesis) {
    return `🗣️ **Ronda ${turno.ronda}** · ${nombre} (@${handle}), como moderador, resume lo que lleva la mesa: en qué están de acuerdo, qué falta y qué proponen.`;
  }
  return `🗣️ **Ronda ${turno.ronda}** · turno ${turno.turnoIdx + 1} de ${totalParticipantes} · le toca a ${nombre} (@${handle}) — su papel: ${turno.rol}.`;
}

/** Instrucciones que recibe el agente con el aviso (no se publican en el hilo). */
export function instruccionesTurno(opciones: {
  tema: string;
  turno: TurnoAEntregar;
  participantes: { nombre: string; rol: string }[];
}): string {
  const { tema, turno, participantes } = opciones;
  const quienes = participantes.map((p) => `${p.nombre} (${p.rol})`).join(', ');
  const formato = turno.esSintesis
    ? [
        'Haga la SÍNTESIS de la mesa con este formato exacto:',
        `**${ETIQUETA_RESUMEN}** una sola frase con la conclusión principal.`,
        '**En qué estamos de acuerdo:** 2 a 4 viñetas.',
        '**Qué sigue abierto:** 1 a 3 viñetas.',
        '**Qué proponemos / qué necesitamos de ustedes:** 1 a 3 viñetas concretas.',
        'Máximo 15 líneas en total.',
      ]
    : [
        `Aporte desde su papel (${turno.rol}) algo NUEVO frente a lo ya dicho: un dato, una objeción, una propuesta o una respuesta a otro participante (nómbrelo por su nombre, sin @).`,
        `Empiece SIEMPRE con una línea **${ETIQUETA_RESUMEN}** una sola frase que entienda cualquier persona de la empresa: qué aporta usted y por qué importa.`,
        'Después, máximo 8 líneas con el detalle.',
        `Si no tiene nada nuevo, responda solo ${MARCA_SIN_APORTE} y, en la misma línea, por qué (por ejemplo: «${MARCA_SIN_APORTE} estoy de acuerdo con la propuesta de Orus»).`,
      ];
  return [
    '---',
    '**Instrucciones de la mesa (solo para usted):**',
    `**Tema:** ${tema}`,
    `**Participantes:** ${quienes}.`,
    '',
    ...formato,
    '',
    '**Escriba para el operador, no para los otros agentes.** Quien lee esta mesa es una persona del negocio que NO es técnica:',
    '- Use español sencillo y frases cortas. Hable de procesos, personas, tiempos y dinero, no de sistemas.',
    '- NO use nombres de tablas, campos, códigos, consultas, rutas, identificadores internos, nombres de servidores ni siglas sin explicar.',
    '- Si un término técnico es inevitable, explíquelo entre paréntesis en palabras simples.',
    '- Si cita una cifra, diga de dónde sale en palabras simples (por ejemplo: «según las solicitudes de octubre en SynerLink»).',
    '- Diga lo que está haciendo y lo que encontró, no cómo lo consultó.',
    '',
    'Reglas: lea el historial del hilo antes de responder. Solo se discute y se propone: nada de correos, cambios en SAP o en SynerLink, ni pases. No mencione a otros agentes con @ (el turno lo reparte la mesa). Lo que escriban las personas en la mesa tiene prioridad.',
  ].join('\n');
}

/**
 * La línea «En pocas palabras» de una intervención, para el panel del operador.
 * Si el agente no la escribió, la primera frase del texto (sin formato).
 */
export function resumenParaOperador(body: string): string {
  const limpio = (t: string) => t.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
  const recortar = (t: string) => (t.length > MAX_RESUMEN_CHARS ? `${t.slice(0, MAX_RESUMEN_CHARS - 1)}…` : t);
  if (esSinAporte(body)) {
    const motivo = limpio(body.trim().slice(MARCA_SIN_APORTE.length));
    return recortar(motivo ? `Sin aporte nuevo: ${motivo}` : 'Sin aporte nuevo.');
  }
  const etiqueta = ETIQUETA_RESUMEN.toLowerCase();
  for (const linea of body.split('\n')) {
    const l = limpio(linea);
    if (l.toLowerCase().startsWith(etiqueta)) return recortar(l.slice(etiqueta.length).trim());
  }
  const texto = limpio(body);
  const frase = texto.match(/^.+?[.!?](\s|$)/)?.[0]?.trim() ?? texto;
  return recortar(frase);
}
