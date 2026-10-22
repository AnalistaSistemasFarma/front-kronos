/**
 * AUDITORÍA DE INICIOS DE SESIÓN — constantes PURAS (sin BD ni `server-only`).
 *
 * Pedido de Nicolás Rivera (2026-10-16): «un módulo para los administradores,
 * desde Usuarios, donde podamos ver los logins que van haciendo los usuarios,
 * de qué IP y país, por auditoría de seguridad».
 *
 * Lo usan el registro (servidor), la API, la pantalla (cliente) y las pruebas.
 */

/**
 * Subproceso-permiso APARTE para ver la pestaña «Inicios de sesión» en
 * Administración → Usuarios. Es un marcador, no una página: no se lista en el
 * hub (lib/request-general/dashboardRoutes.ts). Lo ven además, sin marcador,
 * los usuarios con rol admin / super_user.
 */
export const LOGIN_AUDIT_MARKER_URL = '/process/administration/users/inicios-sesion';
export const LOGIN_AUDIT_MARKER_NAME = 'Usuarios · Inicios de sesión';

/** ¿Es el marcador del permiso de inicios de sesión? (para ocultarlo del hub). */
export function isLoginAuditMarkerSubprocess(subprocess: { subprocess_url?: string | null }): boolean {
  return (
    (subprocess.subprocess_url ?? '').toLowerCase().trim().replace(/\/+$/, '') === LOGIN_AUDIT_MARKER_URL
  );
}

/** Texto del distintivo del marcador en Administración → Usuarios. */
export const LOGIN_AUDIT_MARKER_DESCRIPTION =
  'Permiso: ver la auditoría de inicios de sesión (IP, país, navegador)';

/** Formas de entrar a SynerLink que se registran. */
export const LOGIN_PROVIDERS = {
  credentials: 'Correo y contraseña',
  'supplier-nit': 'Proveedor (NIT)',
  'azure-ad': 'Microsoft (Entra ID)',
} as const;

export type LoginProvider = keyof typeof LOGIN_PROVIDERS;

export function isLoginProvider(value: string | null | undefined): value is LoginProvider {
  return value === 'credentials' || value === 'supplier-nit' || value === 'azure-ad';
}

/**
 * Motivos de fallo. Se guarda la CLAVE (texto corto y estable) y la pantalla
 * pone la etiqueta. Ojo: al usuario que intenta entrar se le sigue diciendo
 * solo «credenciales inválidas»; el detalle es para el administrador.
 */
export const LOGIN_FAILURE_REASONS = {
  DATOS_INCOMPLETOS: 'Faltan el usuario o la contraseña',
  USUARIO_NO_EXISTE: 'El usuario no existe',
  SIN_CONTRASENA: 'El usuario no tiene contraseña local',
  CONTRASENA_INCORRECTA: 'Contraseña incorrecta',
  USUARIO_INACTIVO: 'Usuario inactivo',
  PROVEEDOR_EN_LOGIN_INTERNO: 'Proveedor intentando entrar por el login interno',
  NIT_NO_REGISTRADO: 'NIT no registrado o proveedor inactivo',
  MICROSOFT_RECHAZADO: 'Microsoft rechazó o canceló el inicio de sesión',
  CSRF_INVALIDO: 'Token CSRF inválido o vencido: NextAuth rechazó el envío sin validar las credenciales',
  SIN_AUTORIZACION: 'NextAuth no llegó a validar las credenciales',
  ERROR_INTERNO: 'Error interno al validar',
} as const;

export type LoginFailureReason = keyof typeof LOGIN_FAILURE_REASONS;

export function describeFailureReason(code: string | null | undefined): string {
  if (!code) return '';
  return (LOGIN_FAILURE_REASONS as Record<string, string>)[code] ?? code;
}

/** Alcance de la IP. */
export type IpScope = 'PUBLICA' | 'INTERNA' | 'DESCONOCIDA';

/** Valores especiales del filtro de país (además de los códigos ISO). */
export const COUNTRY_FILTER_INTERNAL = 'INTERNA';
export const COUNTRY_FILTER_UNKNOWN = 'DESCONOCIDO';

/** País «de casa»: lo que no sea esto (y sea IP pública) se resalta. */
export const HOME_COUNTRY_CODE = 'CO';

/** Desde cuántos fallos seguidos del mismo usuario se resalta la fila. */
export const FAIL_STREAK_ALERT = 3;

/** Topes (iguales a las columnas de dbo.user_login_audit). */
export const LOGIN_AUDIT_LIMITS = {
  identifier: 320,
  userName: 255,
  ip: 64,
  userAgent: 400,
  browser: 60,
  os: 60,
  device: 20,
  countryName: 100,
  region: 120,
  city: 120,
  companies: 400,
  failureReason: 40,
  /** Filas por página que acepta la API. */
  maxPageSize: 100,
  /** Filas máximas de una exportación a Excel. */
  maxExportRows: 10_000,
} as const;

/** Atribución que pide la licencia CC BY 4.0 de la base gratuita de DB-IP. */
export const GEOIP_ATTRIBUTION = 'Geolocalización por IP: DB-IP (db-ip.com), licencia CC BY 4.0';
