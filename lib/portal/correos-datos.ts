import { normalizarBusqueda } from './extensiones-datos';

/**
 * Correos Corporativos del Portal TH — lógica pura del filtro (sin red), para
 * poder probarla sin conectores.
 *
 * Pedido de Cristian Baldión (2026-10-08): "que deje filtrar por empresa". Se
 * suma un buscador por nombre o correo, igual al de Extensiones.
 */

/** Un correo con licencia activa de M365, agrupado por empresa. */
export interface GrupoCorreo {
  empresa: string;
  dominio: string;
  /** 'sin_acceso' = todavía no hay conector configurado para ese tenant. */
  estado: 'ok' | 'sin_acceso';
  usuarios: { nombre: string; correo: string }[];
}

/** Valor del selector de empresa que muestra todas las secciones. */
export const TODAS_LAS_EMPRESAS = 'todas';

/** "Todas" + una opción por empresa presente en los datos (valor = dominio). */
export function opcionesEmpresa(grupos: GrupoCorreo[]): { value: string; label: string }[] {
  return [
    { value: TODAS_LAS_EMPRESAS, label: 'Todas las empresas' },
    ...grupos.map((g) => ({ value: g.dominio, label: g.empresa })),
  ];
}

/**
 * Deja solo la empresa elegida y, dentro de cada una, los usuarios cuyo
 * nombre o correo contiene TODAS las palabras buscadas (sin tildes ni
 * mayúsculas). Con búsqueda, las empresas sin coincidencias se ocultan.
 */
export function filtrarGruposCorreo(
  grupos: GrupoCorreo[],
  empresa: string,
  consulta: string
): GrupoCorreo[] {
  const deEmpresa =
    empresa === TODAS_LAS_EMPRESAS ? grupos : grupos.filter((g) => g.dominio === empresa);
  const palabras = normalizarBusqueda(consulta).split(' ').filter(Boolean);
  if (palabras.length === 0) return deEmpresa;
  return deEmpresa
    .map((g) => ({
      ...g,
      usuarios: g.usuarios.filter((u) => {
        const texto = `${normalizarBusqueda(u.nombre)} ${normalizarBusqueda(u.correo)}`;
        return palabras.every((p) => texto.includes(p));
      }),
    }))
    .filter((g) => g.usuarios.length > 0);
}

/** Total de correos (usuarios) en una lista de grupos. */
export function contarCorreos(grupos: GrupoCorreo[]): number {
  return grupos.reduce((total, g) => total + g.usuarios.length, 0);
}
