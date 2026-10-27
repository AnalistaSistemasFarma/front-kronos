/**
 * MÓDULO FORMACIÓN — reglas puras (sin base de datos), 2026-10-26.
 *
 * Pedido de Nicolás Rivera (proyecto «Portal de capacitaciones»):
 *  - Formación es un módulo propio de /process con permiso por usuario y empresa.
 *  - Quien tiene el permiso en una empresa administra los cursos de esa empresa;
 *    los cursos «de todas las empresas» (sin empresa dueña) los administra quien
 *    tenga el permiso en GSS.
 *  - Los cursos van por empresa y departamento (departamentos de SynerLink) y se
 *    activan o desactivan por empresa y departamento.
 *
 * Aquí viven las decisiones, para probarlas sin base de datos.
 */

export const SUBPROCESO_FORMACION = '/process/formacion';
export const FORMACION_HREF = '/process/formacion';

/** Nombre de la empresa cuyo permiso administra los cursos de todas las empresas. */
export const EMPRESA_GLOBAL = 'GSS';

export interface ContextoAdmin {
  /** Empresas donde la persona tiene el permiso de Formación. */
  empresas: number[];
  /** Tiene el permiso en GSS: administra los cursos de todas las empresas. */
  esGlobal: boolean;
}

export function esAdministrador(ctx: ContextoAdmin | null | undefined): boolean {
  return Boolean(ctx && (ctx.esGlobal || ctx.empresas.length > 0));
}

/** ¿Puede configurar un curso cuya empresa dueña es `idCompanyOwner` (null = todas)? */
export function puedeAdministrarCurso(ctx: ContextoAdmin | null | undefined, idCompanyOwner: number | null): boolean {
  if (!ctx) return false;
  if (ctx.esGlobal) return true;
  return idCompanyOwner !== null && ctx.empresas.includes(idCompanyOwner);
}

/** ¿Puede tocar el alcance de la empresa `idCompany` (activar/desactivar por departamento)? */
export function puedeAdministrarEmpresa(ctx: ContextoAdmin | null | undefined, idCompany: number): boolean {
  if (!ctx) return false;
  return ctx.esGlobal || ctx.empresas.includes(idCompany);
}

export interface Alcance {
  id_company: number;
  id_department: number | null;
  activo: boolean;
}

export interface PerfilColaborador {
  empresas: Set<number>;
  departamentos: Set<number>;
  /** Pares empresa-departamento conocidos con certeza (carga de Talento Humano). */
  pares: Set<string>;
}

export const par = (idCompany: number, idDepartment: number) => `${idCompany}:${idDepartment}`;

/**
 * ¿Ve el colaborador un curso con estos alcances?
 *  - Sin filas de alcance: el curso es para todas las empresas y departamentos.
 *  - Con filas: basta una ACTIVA que coincida con su empresa y (todos los
 *    departamentos o el suyo). Una fila inactiva no da acceso.
 */
export function cursoVisiblePara(alcances: Alcance[], perfil: PerfilColaborador): boolean {
  if (alcances.length === 0) return true;
  return alcances.some((a) => {
    if (!a.activo || !perfil.empresas.has(a.id_company)) return false;
    if (a.id_department === null) return true;
    return perfil.pares.has(par(a.id_company, a.id_department)) || perfil.departamentos.has(a.id_department);
  });
}

/** Normaliza un correo para comparar. */
export function normalizarCorreo(correo: string): string {
  return correo.trim().toLowerCase();
}

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function esCorreo(valor: string): boolean {
  return CORREO.test(valor.trim());
}

/** Etiqueta del contador del ícono del header (como el Correo: «99+»). */
export function etiquetaPendientes(n: number | null | undefined): string | null {
  if (!n || n <= 0) return null;
  return n > 99 ? '99+' : String(n);
}

export function ariaPendientes(n: number | null | undefined): string {
  if (!n || n <= 0) return 'Formación: sin cursos ni videos pendientes';
  return n === 1 ? 'Formación: 1 curso o video pendiente por ver' : `Formación: ${n} cursos o videos pendientes por ver`;
}
