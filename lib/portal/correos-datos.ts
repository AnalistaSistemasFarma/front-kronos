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

/**
 * Buzones que NO son una persona (soporte, notificaciones, áreas). El
 * conector de licencias solo descarta las cuentas de servicio; los buzones
 * compartidos con licencia llegan igual. Se reconocen por nombre exacto o por
 * la parte local del correo (antes de la @), sin tildes ni mayúsculas.
 *
 * Es una lista explícita a propósito: no hay forma segura de deducirlo por
 * forma (`director.tecnico@` y `subdireccion.reglamentaria@` son personas).
 * Cuando aparezca un buzón nuevo, se agrega aquí.
 */
const NOMBRES_BUZON = new Set([
  'admin',
  'administrador sistemas',
  'admin sistemas',
  'certificados',
  'comex',
  'comite convivencia',
  'devoluciones colombia',
  'farmacovigilancia',
  'noreply',
  'notificaciones',
  'notificaciones olp',
  'pedidos colombia',
  'pqr colombia',
  'servicio al cliente',
  'talento humano',
  'tecnovigilancia',
]);
const LOCALES_BUZON = new Set([
  'admin',
  'certificados',
  'comex',
  'comitedeconvivencia',
  'devolucionescolombia',
  'farmacovigilancia',
  'no-reply',
  'noreply',
  'notificaciones',
  'pedidoscolombia',
  'pqrcolombia',
  'servicioalcliente',
  'talento',
  'tecnovigilancia',
]);

/** true si el usuario es un buzón genérico y no una persona. */
export function esBuzonGenerico(u: { nombre: string; correo: string }): boolean {
  if (NOMBRES_BUZON.has(normalizarBusqueda(u.nombre))) return true;
  const local = u.correo.split('@')[0]?.trim().toLowerCase() ?? '';
  return LOCALES_BUZON.has(local);
}

/** Deja solo personas en cada grupo (conserva el estado y el orden). */
export function soloPersonas(grupos: GrupoCorreo[]): GrupoCorreo[] {
  return grupos.map((g) => ({ ...g, usuarios: g.usuarios.filter((u) => !esBuzonGenerico(u)) }));
}

/** Total de correos (usuarios) en una lista de grupos. */
export function contarCorreos(grupos: GrupoCorreo[]): number {
  return grupos.reduce((total, g) => total + g.usuarios.length, 0);
}
