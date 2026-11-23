/**
 * AUDITORÍA DE AGENTES → COSTOS Y LICENCIAS (Nicolás, 2026-11-17). Reglas puras
 * (sin base de datos) para el tablero: uso de cada licencia de Anthropic, semáforo,
 * alertas y reparto del costo. Lectura y escritura en ./licencias-db.ts.
 *
 * REGLA DE NEGOCIO (Nicolás, 2026-11-17): una licencia NUNCA se comparte entre
 * agentes de empresas distintas, porque cada empresa paga las suyas.
 */

/** Uso promedio de 4 semanas: verde por debajo de 60 %, amarillo de 60 a 80 %, rojo por encima. */
export const UMBRAL_AMARILLO = 60;
export const UMBRAL_ROJO = 80;
/** Con más de esto en promedio, la licencia no recibe agentes nuevos. */
export const UMBRAL_NO_ASIGNAR = 70;
/** Con menos de esto en promedio (y al menos 2 semanas medidas), se sugiere reasignar o cancelar. */
export const UMBRAL_OCIOSA = 5;
/** Una medición más vieja que esto ya no cuenta como uso actual. */
export const MAX_DIAS_MEDICION = 8;

/**
 * Precio de lista de la API de Anthropic (USD por millón de tokens) para el
 * VALOR DE REFERENCIA: cuánto costaría el mismo consumo pagando por API.
 * No es lo que se paga (las licencias son de cupo fijo). Fuente: tabla de precios
 * de Anthropic, 2026-11-17. Escritura en caché = 1,25 × entrada.
 */
export const PRECIOS_API: { patron: RegExp; entrada: number; cacheEscritura: number; cacheLectura: number; salida: number }[] = [
  { patron: /fable|mythos/, entrada: 10, cacheEscritura: 12.5, cacheLectura: 0.25, salida: 50 },
  { patron: /opus-5-5/, entrada: 4, cacheEscritura: 5, cacheLectura: 0.2, salida: 20 },
  { patron: /opus/, entrada: 5, cacheEscritura: 6.25, cacheLectura: 0.5, salida: 25 },
  { patron: /sonnet-4/, entrada: 3, cacheEscritura: 3.75, cacheLectura: 0.3, salida: 15 },
  { patron: /sonnet/, entrada: 2, cacheEscritura: 2.5, cacheLectura: 0.2, salida: 10 },
  { patron: /haiku-4/, entrada: 1, cacheEscritura: 1.25, cacheLectura: 0.1, salida: 5 },
  { patron: /haiku/, entrada: 0.1, cacheEscritura: 0.125, cacheLectura: 0.01, salida: 0.5 },
];

export interface TokensDto {
  entrada: number;
  cacheEscritura: number;
  cacheLectura: number;
  salida: number;
}

/**
 * Valor equivalente en API de un turno. Un turno puede usar varios modelos y el
 * registro no los separa: se toma el PRIMERO (el modelo principal del agente).
 * Modelos que no son de Anthropic → 0 (no se valoran).
 */
export function valorApi(modelos: string | null, t: TokensDto): number {
  const principal = (modelos ?? '').split(',').map((m) => m.trim().toLowerCase()).find((m) => m && !m.startsWith('<')) ?? '';
  if (!/claude|anthropic/.test(principal)) return 0;
  const p = PRECIOS_API.find((x) => x.patron.test(principal));
  if (!p) return 0;
  return (t.entrada * p.entrada + t.cacheEscritura * p.cacheEscritura + t.cacheLectura * p.cacheLectura + t.salida * p.salida) / 1_000_000;
}

export interface ConsumoDto {
  turnos: number;
  tokens: number;
  valorApi: number;
}
export const consumoVacio = (): ConsumoDto => ({ turnos: 0, tokens: 0, valorApi: 0 });
export function sumarConsumo(a: ConsumoDto, b: ConsumoDto): ConsumoDto {
  return { turnos: a.turnos + b.turnos, tokens: a.tokens + b.tokens, valorApi: a.valorApi + b.valorApi };
}

export interface TurnoRecienteDto {
  code: string;
  avatarUrl: string | null;
  avatarVersion: number | null;
  agente: string;
  empresa: string | null;
  licencia: string | null;
  modelos: string | null;
  tokens: number;
  valorApi: number;
  fin: string | null;
}

export type Semaforo = 'verde' | 'amarillo' | 'rojo' | 'gris';
export type NivelAlerta = 'rojo' | 'amarillo' | 'gris';

export interface AgenteLicenciaDto {
  idAgent: number;
  code: string;
  nombre: string;
  idEmpresa: number | null;
  empresa: string | null;
  departamento: string | null;
  uso7d: number | null;
  reinicio7d: string | null;
  uso5h: number | null;
  overage: string | null;
  medidoEn: string | null;
  /** Licencia asignada en el inventario. */
  idLicencia: number | null;
  /** Licencia que indica la huella del token que reporta el puente (si la manda). */
  idLicenciaPorHuella: number | null;
  huellaToken: string | null;
  /** Consumo declarado por el agente (hook de consumo por turno): mes y día en curso, hora de Colombia. */
  consumoMes: ConsumoDto;
  consumoHoy: ConsumoDto;
  ultimoTurno: string | null;
  /** Para pintar el ícono del agente (mismo criterio que el chat). */
  avatarUrl: string | null;
  avatarVersion: number | null;
  /**
   * Parte del uso de la licencia que le toca al agente en el mes (0–1): sus tokens
   * ÷ los de la licencia. Sin consumo registrado, se reparte por igual.
   */
  participacion: number | null;
  /** Costo mensual de la licencia × participación. */
  costoAsignado: number | null;
}

export interface SemanaUsoDto {
  reinicio: string;
  pico: number;
}

export interface AlertaDto {
  nivel: NivelAlerta;
  texto: string;
}

export interface LicenciaDto {
  idLicencia: number;
  codigo: string;
  nombre: string | null;
  idEmpresa: number;
  empresa: string;
  organizacion: string | null;
  plan: string | null;
  costoMensual: number | null;
  moneda: string;
  renovacion: string | null;
  responsable: string | null;
  notas: string | null;
  activa: boolean;
  huellas: { huella: string; estado: string }[];
  agentes: AgenteLicenciaDto[];
  semanas: SemanaUsoDto[];
  usoActual: number | null;
  /** Ventana de 5 horas (lo más «en tiempo real» que da Anthropic). */
  uso5h: number | null;
  promedio4: number | null;
  pico4: number | null;
  semaforo: Semaforo;
  costoPorAgente: number | null;
  /** Costo de la parte del cupo pagado que no se usa: costo × (1 − promedio de 4 semanas). */
  capacidadSinUsar: number | null;
  alertas: AlertaDto[];
  consumoMes: ConsumoDto;
  consumoHoy: ConsumoDto;
  /** Valor equivalente en API del mes ÷ costo mensual de la licencia (cuántas veces rinde). */
  rendimiento: number | null;
}

export interface CostoEmpresaDto {
  idEmpresa: number;
  empresa: string;
  licencias: number;
  agentes: number;
  costoMensual: number;
  sinCosto: number;
  capacidadSinUsar: number;
  consumoMes: ConsumoDto;
}

export interface CostoDepartamentoDto {
  departamento: string;
  agentes: number;
  costoMensual: number;
  consumoMes: ConsumoDto;
}

export interface LicenciasDto {
  licencias: LicenciaDto[];
  sinLicencia: AgenteLicenciaDto[];
  porEmpresa: CostoEmpresaDto[];
  porDepartamento: CostoDepartamentoDto[];
  huellasPorRevocar: { huella: string; notas: string | null }[];
  empresas: { idEmpresa: number; empresa: string }[];
  ultimosTurnos: TurnoRecienteDto[];
  resumen: {
    licencias: number;
    organizaciones: number;
    agentes: number;
    costoMensual: number;
    licenciasSinCosto: number;
    mezclanEmpresas: number;
    conUsoAdicional: number;
    noAsignarMas: number;
    /** Promedio del cupo usado (4 semanas), ponderado por costo si hay costos registrados. */
    aprovechamiento: number | null;
    capacidadSinUsar: number;
    consumoMes: ConsumoDto;
    consumoHoy: ConsumoDto;
    /** Agentes activos que reportan consumo por turno (el resto no tiene el hook). */
    agentesConConsumo: number;
    agentesActivos: number;
  };
  generadoEn: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Uso de la semana en curso: el mayor de las mediciones recientes de sus agentes (comparten cupo). */
export function usoActual(agentes: AgenteLicenciaDto[], ahora: Date = new Date()): number | null {
  const limite = ahora.getTime() - MAX_DIAS_MEDICION * 86_400_000;
  const usos = agentes
    .filter((a) => a.uso7d !== null && a.medidoEn && Date.parse(a.medidoEn) >= limite)
    .map((a) => a.uso7d as number);
  return usos.length ? Math.max(...usos) : null;
}

/** Promedio y pico de las últimas 4 semanas (pico de cada semana). Sin historial, usa el uso actual. */
export function promedioCuatroSemanas(semanas: SemanaUsoDto[], actual: number | null): { promedio: number | null; pico: number | null } {
  const ultimas = [...semanas].sort((a, b) => a.reinicio.localeCompare(b.reinicio)).slice(-4).map((s) => s.pico);
  if (!ultimas.length) return { promedio: actual, pico: actual };
  return { promedio: round1(ultimas.reduce((s, v) => s + v, 0) / ultimas.length), pico: Math.max(...ultimas) };
}

export function semaforoDe(pct: number | null): Semaforo {
  if (pct === null || !Number.isFinite(pct)) return 'gris';
  if (pct > UMBRAL_ROJO) return 'rojo';
  if (pct >= UMBRAL_AMARILLO) return 'amarillo';
  return 'verde';
}

/** Alertas de una licencia según las reglas de negocio. */
export function alertasDe(l: Pick<LicenciaDto, 'idEmpresa' | 'empresa' | 'costoMensual' | 'agentes' | 'semanas' | 'promedio4' | 'activa' | 'idLicencia'>): AlertaDto[] {
  const alertas: AlertaDto[] = [];
  const otras = l.agentes.filter((a) => a.idEmpresa !== null && a.idEmpresa !== l.idEmpresa);
  if (otras.length) {
    alertas.push({
      nivel: 'rojo',
      texto: `Mezcla empresas: ${otras.map((a) => `${a.nombre} (${a.empresa ?? 'sin empresa'})`).join(', ')} usa una licencia que paga ${l.empresa}.`,
    });
  }
  const huellaDistinta = l.agentes.filter((a) => a.idLicenciaPorHuella !== null && a.idLicenciaPorHuella !== l.idLicencia);
  if (huellaDistinta.length) {
    alertas.push({
      nivel: 'amarillo',
      texto: `El token que reporta ${huellaDistinta.map((a) => a.nombre).join(', ')} es de otra licencia: revisar la asignación.`,
    });
  }
  if (l.agentes.some((a) => a.overage === 'allowed')) {
    alertas.push({ nivel: 'amarillo', texto: 'Uso adicional pagado activo: si se acaba el cupo, sigue consumiendo con cobro aparte.' });
  }
  if (l.promedio4 !== null && l.promedio4 > UMBRAL_NO_ASIGNAR) {
    alertas.push({ nivel: 'rojo', texto: `Promedio de ${l.promedio4} %: no asignar más agentes a esta licencia.` });
  } else if (l.promedio4 !== null && l.promedio4 < UMBRAL_OCIOSA && l.semanas.length >= 2 && l.agentes.length > 0) {
    alertas.push({ nivel: 'gris', texto: 'Casi sin uso: puede recibir agentes de la misma empresa, o reasignarse o cancelarse.' });
  }
  if (l.activa && l.agentes.length === 0) alertas.push({ nivel: 'gris', texto: 'Licencia sin agentes asignados.' });
  if (l.costoMensual === null) alertas.push({ nivel: 'gris', texto: 'Falta registrar el plan y el costo.' });
  return alertas;
}

/** ¿Se puede asignar este agente a esta licencia? Regla: misma empresa. */
export function validarAsignacion(empresaAgente: number | null, empresaLicencia: number): string | null {
  if (empresaAgente === null) return 'El agente no tiene empresa principal: asígnela antes en el agente.';
  if (empresaAgente !== empresaLicencia) return 'Regla de negocio: una licencia no se comparte entre empresas. Elija una licencia de la empresa del agente.';
  return null;
}

/** Completa cada licencia (uso, semáforo, costo por agente, alertas) y arma los totales. */
export function armarTablero(
  base: Omit<LicenciaDto, 'usoActual' | 'uso5h' | 'promedio4' | 'pico4' | 'semaforo' | 'costoPorAgente' | 'capacidadSinUsar' | 'alertas' | 'consumoMes' | 'consumoHoy' | 'rendimiento'>[],
  sinLicencia: AgenteLicenciaDto[],
  huellasPorRevocar: { huella: string; notas: string | null }[],
  empresas: { idEmpresa: number; empresa: string }[],
  ahora: Date = new Date(),
  extra: { ultimosTurnos?: TurnoRecienteDto[]; agentesActivos?: AgenteLicenciaDto[] } = {},
): LicenciasDto {
  const licencias: LicenciaDto[] = base.map((b) => {
    const actual = usoActual(b.agentes, ahora);
    const { promedio, pico } = promedioCuatroSemanas(b.semanas, actual);
    const costoPorAgente = b.costoMensual !== null && b.agentes.length ? round1(b.costoMensual / b.agentes.length) : null;
    const consumoMes = b.agentes.reduce((s, a) => sumarConsumo(s, a.consumoMes), consumoVacio());
    // Reparto del costo: por la parte de los tokens del mes de cada agente; sin consumo, por igual.
    const agentes = b.agentes.map((a) => {
      const participacion = b.agentes.length
        ? consumoMes.tokens > 0
          ? a.consumoMes.tokens / consumoMes.tokens
          : 1 / b.agentes.length
        : null;
      return {
        ...a,
        participacion: participacion === null ? null : Math.round(participacion * 1000) / 1000,
        costoAsignado: participacion !== null && b.costoMensual !== null ? round1(b.costoMensual * participacion) : null,
      };
    });
    const recientes = agentes.filter((a) => a.medidoEn && ahora.getTime() - Date.parse(a.medidoEn) <= MAX_DIAS_MEDICION * 86_400_000);
    const usos5h = recientes.map((a) => a.uso5h).filter((v): v is number => v !== null);
    const uso5h = usos5h.length ? Math.max(...usos5h) : null;
    const consumoHoy = b.agentes.reduce((s, a) => sumarConsumo(s, a.consumoHoy), consumoVacio());
    const rendimiento = b.costoMensual ? round1(consumoMes.valorApi / b.costoMensual) : null;
    const capacidadSinUsar = b.costoMensual !== null && promedio !== null ? round1(b.costoMensual * Math.max(0, 1 - promedio / 100)) : null;
    const l = {
      ...b,
      agentes,
      usoActual: actual,
      uso5h,
      capacidadSinUsar,
      promedio4: promedio,
      pico4: pico,
      semaforo: semaforoDe(promedio),
      costoPorAgente,
      alertas: [] as AlertaDto[],
      consumoMes,
      consumoHoy,
      rendimiento,
    };
    l.alertas = alertasDe(l);
    return l;
  });

  const activas = licencias.filter((l) => l.activa);
  const emp = new Map<number, CostoEmpresaDto>();
  for (const l of activas) {
    const e = emp.get(l.idEmpresa) ?? { idEmpresa: l.idEmpresa, empresa: l.empresa, licencias: 0, agentes: 0, costoMensual: 0, sinCosto: 0, capacidadSinUsar: 0, consumoMes: consumoVacio() };
    e.licencias += 1;
    e.capacidadSinUsar = round1(e.capacidadSinUsar + (l.capacidadSinUsar ?? 0));
    e.consumoMes = sumarConsumo(e.consumoMes, l.consumoMes);
    e.agentes += l.agentes.length;
    if (l.costoMensual === null) e.sinCosto += 1;
    else e.costoMensual += l.costoMensual;
    emp.set(l.idEmpresa, e);
  }
  const dep = new Map<string, CostoDepartamentoDto>();
  for (const l of activas) {
    for (const a of l.agentes) {
      const k = a.departamento ?? 'Sin departamento';
      const d = dep.get(k) ?? { departamento: k, agentes: 0, costoMensual: 0, consumoMes: consumoVacio() };
      d.agentes += 1;
      d.consumoMes = sumarConsumo(d.consumoMes, a.consumoMes);
      d.costoMensual = round1(d.costoMensual + (a.costoAsignado ?? 0));
      dep.set(k, d);
    }
  }

  const conUso = activas.filter((l) => l.promedio4 !== null);
  const conCosto = conUso.filter((l) => l.costoMensual);
  const aprovechamiento = conCosto.length
    ? round1(conCosto.reduce((s, l) => s + (l.promedio4 as number) * (l.costoMensual as number), 0) / conCosto.reduce((s, l) => s + (l.costoMensual as number), 0))
    : conUso.length
      ? round1(conUso.reduce((s, l) => s + (l.promedio4 as number), 0) / conUso.length)
      : null;

  return {
    licencias,
    sinLicencia,
    porEmpresa: [...emp.values()].sort((a, b) => b.costoMensual - a.costoMensual || a.empresa.localeCompare(b.empresa)),
    porDepartamento: [...dep.values()].sort((a, b) => b.costoMensual - a.costoMensual || b.agentes - a.agentes),
    huellasPorRevocar,
    empresas,
    ultimosTurnos: extra.ultimosTurnos ?? [],
    resumen: {
      licencias: activas.length,
      organizaciones: new Set(activas.map((l) => l.organizacion ?? `#${l.idLicencia}`)).size,
      agentes: activas.reduce((s, l) => s + l.agentes.length, 0),
      costoMensual: round1(activas.reduce((s, l) => s + (l.costoMensual ?? 0), 0)),
      licenciasSinCosto: activas.filter((l) => l.costoMensual === null).length,
      mezclanEmpresas: activas.filter((l) => l.alertas.some((a) => a.texto.startsWith('Mezcla empresas'))).length,
      conUsoAdicional: activas.filter((l) => l.alertas.some((a) => a.texto.startsWith('Uso adicional'))).length,
      noAsignarMas: activas.filter((l) => l.promedio4 !== null && l.promedio4 > UMBRAL_NO_ASIGNAR).length,
      aprovechamiento,
      capacidadSinUsar: round1(activas.reduce((s, l) => s + (l.capacidadSinUsar ?? 0), 0)),
      // Todo el consumo de la flota, también el de agentes sin licencia registrada.
      consumoMes: (extra.agentesActivos ?? []).reduce((s, a) => sumarConsumo(s, a.consumoMes), consumoVacio()),
      consumoHoy: (extra.agentesActivos ?? []).reduce((s, a) => sumarConsumo(s, a.consumoHoy), consumoVacio()),
      agentesConConsumo: (extra.agentesActivos ?? []).filter((a) => a.ultimoTurno !== null).length,
      agentesActivos: (extra.agentesActivos ?? []).length,
    },
    generadoEn: ahora.toISOString(),
  };
}
