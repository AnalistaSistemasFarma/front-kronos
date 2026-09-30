/**
 * Error de negocio del SGC con su código HTTP. Las rutas lo traducen a una
 * respuesta con su mensaje (pensado para el usuario); cualquier otro error
 * se responde como 500 sin filtrar el detalle.
 */
export class SgcError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'SgcError';
    this.status = status;
  }
}

export function isSgcError(error: unknown): error is SgcError {
  return error instanceof SgcError;
}

/** true si Prisma rechazó por clave única duplicada (P2002). */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}
