import { prisma } from '../prisma';

/**
 * Logica de servidor del organigrama: lectura del arbol por empresa y
 * validaciones de escritura (anti-ciclo). Todo opera sobre los modelos locales
 * Cargo y CargoJerarquia; no toca SAP.
 */

/** Un cargo dentro de la jerarquia de una empresa (forma plana para el cliente). */
export interface JerarquiaNode {
  idCargoJerarquia: number;
  idCargo: number;
  nombre: string;
  nivel: string | null;
  nivelClasico: string | null;
  idCargoPadre: number | null;
  aproximada: boolean;
}

/** Un cargo del catalogo (para selectores de "jefe"). */
export interface CargoOption {
  idCargo: number;
  nombre: string;
  nivel: string | null;
}

/**
 * Devuelve la jerarquia plana de una empresa: una fila por cargo asignado en
 * cargo_jerarquia, con el nombre y nivel del cargo resueltos. El cliente arma
 * el arbol a partir de idCargo / idCargoPadre.
 */
export async function getJerarquia(companyId: number): Promise<JerarquiaNode[]> {
  const rows = await prisma.cargoJerarquia.findMany({
    where: { id_company: companyId },
    include: { cargo: true },
  });

  return rows
    .map((r) => ({
      idCargoJerarquia: r.id_cargo_jerarquia,
      idCargo: r.id_cargo,
      nombre: r.cargo.nombre_normalizado,
      nivel: r.cargo.nivel,
      nivelClasico: r.cargo.nivel_clasico,
      idCargoPadre: r.id_cargo_padre,
      aproximada: r.aproximada,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/** Catalogo de cargos activos, para poblar selectores de "jefe". */
export async function getCargos(): Promise<CargoOption[]> {
  const rows = await prisma.cargo.findMany({
    where: { is_active: true },
    orderBy: { nombre_normalizado: 'asc' },
  });
  return rows.map((r) => ({
    idCargo: r.id_cargo,
    nombre: r.nombre_normalizado,
    nivel: r.nivel,
  }));
}

/**
 * Determina si asignar `nuevoPadre` como padre de `idCargo` (dentro de
 * `companyId`) crearia un ciclo. Recorre la cadena de ancestros del candidato a
 * padre subiendo por id_cargo_padre; si llega a `idCargo`, hay ciclo.
 *
 * @returns true si la reasignacion es SEGURA (no crea ciclo).
 */
export async function isReparentSafe(
  companyId: number,
  idCargo: number,
  nuevoPadre: number | null
): Promise<boolean> {
  if (nuevoPadre == null) return true; // pasar a raiz nunca crea ciclo
  if (nuevoPadre === idCargo) return false; // no puede ser su propio jefe

  // Mapa idCargo -> idCargoPadre de la empresa, para subir la cadena.
  const rows = await prisma.cargoJerarquia.findMany({
    where: { id_company: companyId },
    select: { id_cargo: true, id_cargo_padre: true },
  });
  const padreDe = new Map<number, number | null>();
  for (const r of rows) padreDe.set(r.id_cargo, r.id_cargo_padre);

  // Subimos desde nuevoPadre hacia la raiz. Si encontramos idCargo, seria ciclo.
  let actual: number | null = nuevoPadre;
  const visitados = new Set<number>();
  while (actual != null) {
    if (actual === idCargo) return false;
    if (visitados.has(actual)) break; // proteccion contra datos ya corruptos
    visitados.add(actual);
    actual = padreDe.get(actual) ?? null;
  }
  return true;
}
