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
  promedio4: number | null;
  pico4: number | null;
  semaforo: Semaforo;
  costoPorAgente: number | null;
  alertas: AlertaDto[];
}

export interface CostoEmpresaDto {
  idEmpresa: number;
  empresa: string;
  licencias: number;
  agentes: number;
  costoMensual: number;
  sinCosto: number;
}

export interface CostoDepartamentoDto {
  departamento: string;
  agentes: number;
  costoMensual: number;
}

export interface LicenciasDto {
  licencias: LicenciaDto[];
  sinLicencia: AgenteLicenciaDto[];
  porEmpresa: CostoEmpresaDto[];
  porDepartamento: CostoDepartamentoDto[];
  huellasPorRevocar: { huella: string; notas: string | null }[];
  empresas: { idEmpresa: number; empresa: string }[];
  resumen: {
    licencias: number;
    organizaciones: number;
    agentes: number;
    costoMensual: number;
    licenciasSinCosto: number;
    mezclanEmpresas: number;
    conUsoAdicional: number;
    noAsignarMas: number;
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
  base: Omit<LicenciaDto, 'usoActual' | 'promedio4' | 'pico4' | 'semaforo' | 'costoPorAgente' | 'alertas'>[],
  sinLicencia: AgenteLicenciaDto[],
  huellasPorRevocar: { huella: string; notas: string | null }[],
  empresas: { idEmpresa: number; empresa: string }[],
  ahora: Date = new Date(),
): LicenciasDto {
  const licencias: LicenciaDto[] = base.map((b) => {
    const actual = usoActual(b.agentes, ahora);
    const { promedio, pico } = promedioCuatroSemanas(b.semanas, actual);
    const costoPorAgente = b.costoMensual !== null && b.agentes.length ? round1(b.costoMensual / b.agentes.length) : null;
    const l = { ...b, usoActual: actual, promedio4: promedio, pico4: pico, semaforo: semaforoDe(promedio), costoPorAgente, alertas: [] as AlertaDto[] };
    l.alertas = alertasDe(l);
    return l;
  });

  const activas = licencias.filter((l) => l.activa);
  const emp = new Map<number, CostoEmpresaDto>();
  for (const l of activas) {
    const e = emp.get(l.idEmpresa) ?? { idEmpresa: l.idEmpresa, empresa: l.empresa, licencias: 0, agentes: 0, costoMensual: 0, sinCosto: 0 };
    e.licencias += 1;
    e.agentes += l.agentes.length;
    if (l.costoMensual === null) e.sinCosto += 1;
    else e.costoMensual += l.costoMensual;
    emp.set(l.idEmpresa, e);
  }
  const dep = new Map<string, CostoDepartamentoDto>();
  for (const l of activas) {
    for (const a of l.agentes) {
      const k = a.departamento ?? 'Sin departamento';
      const d = dep.get(k) ?? { departamento: k, agentes: 0, costoMensual: 0 };
      d.agentes += 1;
      d.costoMensual = round1(d.costoMensual + (l.costoPorAgente ?? 0));
      dep.set(k, d);
    }
  }

  return {
    licencias,
    sinLicencia,
    porEmpresa: [...emp.values()].sort((a, b) => b.costoMensual - a.costoMensual || a.empresa.localeCompare(b.empresa)),
    porDepartamento: [...dep.values()].sort((a, b) => b.costoMensual - a.costoMensual || b.agentes - a.agentes),
    huellasPorRevocar,
    empresas,
    resumen: {
      licencias: activas.length,
      organizaciones: new Set(activas.map((l) => l.organizacion ?? `#${l.idLicencia}`)).size,
      agentes: activas.reduce((s, l) => s + l.agentes.length, 0),
      costoMensual: round1(activas.reduce((s, l) => s + (l.costoMensual ?? 0), 0)),
      licenciasSinCosto: activas.filter((l) => l.costoMensual === null).length,
      mezclanEmpresas: activas.filter((l) => l.alertas.some((a) => a.texto.startsWith('Mezcla empresas'))).length,
      conUsoAdicional: activas.filter((l) => l.alertas.some((a) => a.texto.startsWith('Uso adicional'))).length,
      noAsignarMas: activas.filter((l) => l.promedio4 !== null && l.promedio4 > UMBRAL_NO_ASIGNAR).length,
    },
    generadoEn: ahora.toISOString(),
  };
}
