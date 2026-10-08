/**
 * Autocompletado del navegador en los formularios del SGC.
 *
 * El gestor de contraseñas del navegador (Chrome, Edge, 1Password, LastPass…)
 * toma el campo de texto anterior a un campo de contraseña como «usuario» y lo
 * rellena con el correo: así llegó el correo al «Motivo» de una firma. Regla
 * del módulo:
 * - Campos libres (motivos, observaciones, comentarios, búsquedas): estas
 *   props — `autoComplete='off'`, un `name` que no parezca usuario y las
 *   marcas que respetan los gestores de contraseñas.
 * - Junto a cada contraseña de reautenticación: un campo de usuario explícito
 *   (`autoComplete='username'`, solo lectura, con el correo de la sesión) para
 *   que el gestor no tome el «Motivo» como usuario.
 * - La contraseña de la firma NUNCA se autocompleta (S7, 2026-10-08): con
 *   `current-password` el navegador la rellenaba sola en la demo del 2026-10-07.
 *   Se usa `new-password` (el navegador no rellena la guardada), un `name`/`id`
 *   que no es el estándar de login, las marcas de los gestores y el campo queda
 *   de solo lectura hasta que la persona lo toca (ver `sgcSignaturePasswordProps`).
 *   Límite honesto: un gestor instalado puede ignorar estas marcas; la defensa
 *   real es que el servidor exige la contraseña en cada firma y bloquea tras
 *   varios intentos fallidos.
 */
export function sgcNoAutofill(name: string) {
  return {
    name: `sgc-${name}`,
    autoComplete: 'off',
    'data-1p-ignore': 'true',
    'data-lpignore': 'true',
    'data-bwignore': 'true',
    'data-form-type': 'other',
  } as const;
}

/** ¿El texto es el correo del usuario (lo rellenó el navegador)? */
export function looksLikeAutofilledEmail(value: string, email: string | null | undefined): boolean {
  return Boolean(email) && value.trim().toLowerCase() === String(email).trim().toLowerCase();
}

/** Nombre/id no estándar de la contraseña de la firma (no es `password` ni `current-password`). */
export const SGC_SIGNATURE_PASSWORD_FIELD = 'sgc-firma-clave-reautenticacion';

/** Props de la contraseña de la firma: que el navegador ni los gestores la rellenen. */
export function sgcSignaturePasswordProps() {
  return {
    id: SGC_SIGNATURE_PASSWORD_FIELD,
    name: SGC_SIGNATURE_PASSWORD_FIELD,
    autoComplete: 'new-password',
    'data-1p-ignore': 'true',
    'data-lpignore': 'true',
    'data-bwignore': 'true',
    'data-form-type': 'other',
  } as const;
}
