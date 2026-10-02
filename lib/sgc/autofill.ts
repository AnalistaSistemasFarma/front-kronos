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
 *   (`autoComplete='username'`, solo lectura, con el correo de la sesión) y la
 *   contraseña con `autoComplete='current-password'`.
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
