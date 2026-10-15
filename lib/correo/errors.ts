/** Error de negocio del módulo Correo: mensaje para la persona y estado HTTP. */
export class CorreoError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
    public readonly code?: string,
    /** Solicitud relacionada (p. ej. la que ya tiene este correo, en un DUPLICADO). */
    public readonly idRequest?: number
  ) {
    super(message);
    this.name = 'CorreoError';
  }
}

export function isCorreoError(e: unknown): e is CorreoError {
  return e instanceof CorreoError;
}

/** El correo de la persona es de un inquilino (empresa) que aún no tiene el módulo habilitado. */
export const NO_DISPONIBLE = 'NO_DISPONIBLE';
