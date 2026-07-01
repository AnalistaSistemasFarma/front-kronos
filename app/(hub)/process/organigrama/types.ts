/** Tipos compartidos del modulo Organigrama (cliente). */

/** Nodo plano de la jerarquia, tal como lo devuelve /api/organigrama/tree. */
export interface JerarquiaNode {
  idCargoJerarquia: number;
  idCargo: number;
  nombre: string;
  nivel: string | null;
  nivelClasico: string | null;
  idCargoPadre: number | null;
  aproximada: boolean;
}

/** Empresa accesible para el usuario. */
export interface CompanyAccess {
  idCompany: number;
  companyName: string;
  canAccess: boolean;
}

/** Color de badge por nivel estrategico/tactico/operativo. */
export const NIVEL_COLOR: Record<string, string> = {
  Estratégico: 'grape',
  Estrategico: 'grape',
  Táctico: 'blue',
  Tactico: 'blue',
  Operativo: 'teal',
};
