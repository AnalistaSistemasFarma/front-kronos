/**
 * Contrato de la pantalla de CONFIGURACIÓN de «Proyectos» (2026-10-20) con su
 * API (/api/proyectos/configuracion). Solo tipos: seguro para el cliente.
 */

export interface EmpresaConfigurableDto {
  idCompany: number;
  companyName: string;
}

export interface AccesoConfigDto {
  /** Administración de SynerLink: todas las empresas sin el permiso propio. */
  admin: boolean;
  companies: EmpresaConfigurableDto[];
}

export interface AgenteConfigDto {
  idAgent: number;
  code: string;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  avatarVersion: number | null;
  /** Estado EFECTIVO hoy (tabla o .env, según quién mande en la empresa). */
  habilitado: boolean;
  perfiles: string[];
  /** Lo que dice CHAT_PROJECTS_AGENTS para este agente (referencia). */
  perfilesEnv: string[];
  /** Tiene llave de proyectos (puente de hilos). Sin puente = solo lectura. */
  puente: boolean;
  /** Tiene fila propia en la tabla. */
  configurado: boolean;
  ultimoCambio: { motivo: string | null; por: string | null; fecha: string } | null;
}

export interface RegistroCambioDto {
  id: number;
  agente: string;
  accion: 'cambio' | 'copia_env';
  habilitadoAntes: boolean | null;
  habilitadoDespues: boolean;
  perfilesAntes: string[];
  perfilesDespues: string[];
  motivo: string;
  por: string;
  fecha: string;
}

export interface ConfigEmpresaDto {
  idCompany: number;
  /** 'env' = la empresa aún no se ha configurado: manda CHAT_PROJECTS_AGENTS. */
  origen: 'tabla' | 'env';
  /** false = el DDL todavía no se ha corrido (solo lectura, todo desde el .env). */
  tablaLista: boolean;
  agentes: AgenteConfigDto[];
  registro: RegistroCambioDto[];
}
