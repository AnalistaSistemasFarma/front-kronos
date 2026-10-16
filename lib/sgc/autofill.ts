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
 * - La contraseña de la firma NUNCA se autocompleta (S7, 2026-10-08, y S14,
 *   2026-10-14): ver `sgcSignaturePasswordProps`. Solo en el respaldo (campo de
 *   contraseña clásico) va junto a ella un campo de usuario explícito
 *   (`autoComplete='username'`, solo lectura, con el correo de la sesión) para
 *   que el gestor no tome el «Motivo» como usuario.
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

/**
 * Prefijo del nombre/id de la contraseña de la firma. No es `password`,
 * `current-password` ni una palabra que las heurísticas de los navegadores
 * asocien a una clave («clave», «pass», «pwd»); cada apertura del formulario
 * le agrega un sufijo aleatorio, así el historial de autocompletado del
 * navegador (que se guarda por nombre de campo) nunca tiene nada que ofrecer.
 */
export const SGC_SIGNATURE_PASSWORD_FIELD = 'sgc-firma-reautenticacion';

/** Sufijo aleatorio corto para el nombre del campo (uno por apertura del formulario). */
export function sgcFieldNonce(random: () => number = Math.random): string {
  return random().toString(36).slice(2, 10).padEnd(8, '0');
}

/**
 * ¿El navegador enmascara un campo de TEXTO con `-webkit-text-security`?
 * Chrome, Edge y Safari (también en iOS y Android) sí. Si no (algún Firefox),
 * se usa el campo de contraseña clásico con `new-password`.
 */
export function supportsTextSecurity(css: { supports?: (property: string, value: string) => boolean } | undefined = typeof CSS === 'undefined' ? undefined : CSS): boolean {
  try {
    return Boolean(css?.supports?.('-webkit-text-security', 'disc'));
  } catch {
    return false;
  }
}

/**
 * Props de la contraseña de la firma (R24, S14 — 2026-10-14). El #537 (S7)
 * usaba `type='password'` con `new-password`, pero Chrome y Edge siguen
 * OFRECIENDO la contraseña guardada para el dominio en cualquier campo de
 * contraseña (y el campo de usuario oculto con el correo de la sesión les
 * confirmaba la credencial). Ahora:
 *   - Donde el navegador enmascara texto (Chrome, Edge, Safari): el campo es
 *     de TEXTO enmascarado con `-webkit-text-security: disc`. Sin ningún
 *     `type='password'` en el formulario, el gestor de contraseñas del
 *     navegador no lo reconoce: no ofrece, no rellena y no propone guardar.
 *     Sin corrector, sin mayúscula automática y sin sugerencias del teclado
 *     (celular), para que el teclado no aprenda la contraseña.
 *   - Si no (respaldo): `type='password'` con `new-password`.
 *   - En los dos casos: nombre único por apertura, `autocomplete` apagado y
 *     las marcas que respetan 1Password, LastPass y Bitwarden. El modal lo
 *     deja además de solo lectura hasta que la persona lo toca.
 * Límite honesto: una extensión puede ignorar todo esto; la defensa real
 * sigue siendo el servidor (contraseña en cada firma y bloqueo tras 5
 * intentos fallidos en 15 minutos).
 */
export function sgcSignaturePasswordProps(opts: { nonce: string; textSecurity: boolean }) {
  const id = `${SGC_SIGNATURE_PASSWORD_FIELD}-${opts.nonce}`;
  const common = {
    id,
    name: id,
    'data-1p-ignore': 'true',
    'data-lpignore': 'true',
    'data-bwignore': 'true',
    'data-form-type': 'other',
  } as const;
  if (opts.textSecurity) {
    return { ...common, type: 'text', autoComplete: 'off', autoCorrect: 'off', autoCapitalize: 'off', spellCheck: false, inputMode: 'text' } as const;
  }
  return { ...common, type: 'password', autoComplete: 'new-password' } as const;
}

/** Estilo del campo de texto enmascarado (puntos en lugar de caracteres), o nada si se muestra o es el respaldo. */
export function sgcMaskedInputStyle(textSecurity: boolean, hidden: boolean): Record<string, string> | undefined {
  return textSecurity ? { WebkitTextSecurity: hidden ? 'disc' : 'none' } : undefined;
}
