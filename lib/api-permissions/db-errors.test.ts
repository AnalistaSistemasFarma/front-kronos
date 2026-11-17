/**
 * Permisos API — clasificación de errores de la base (2026-11-10): correo de México
 * repetido (índice único) frente a nombre repetido, y falta del script de vencimiento.
 */
import { describe, expect, it } from 'vitest';
import {
  ApiClientConflictError,
  MEXICO_SUBJECT_UNIQUE_INDEX,
  isMexicoEmailUniqueViolation,
  isMissingKeyExpiryColumnError,
  isUniqueViolation,
} from './db';

const sqlError = (number: number, message: string) => Object.assign(new Error(message), { number });

describe('errores de Permisos API', () => {
  it('distingue el correo de México repetido del nombre repetido', () => {
    const mexico = sqlError(
      2601,
      `Cannot insert duplicate key row in object 'dbo.api_client' with unique index '${MEXICO_SUBJECT_UNIQUE_INDEX}'.`
    );
    const name = sqlError(2627, "Violation of UNIQUE KEY constraint 'UQ_api_client_name'.");
    expect(isMexicoEmailUniqueViolation(mexico)).toBe(true);
    expect(isMexicoEmailUniqueViolation(name)).toBe(false);
    expect(isUniqueViolation(name)).toBe(true);
    expect(isMexicoEmailUniqueViolation(new Error(MEXICO_SUBJECT_UNIQUE_INDEX))).toBe(false);
  });

  it('reconoce la falta de la columna de vencimiento', () => {
    expect(isMissingKeyExpiryColumnError(new Error("Invalid column name 'expires_at'."))).toBe(true);
    expect(isMissingKeyExpiryColumnError(new Error('Timeout'))).toBe(false);
  });

  it('las reglas de negocio rechazadas son un error propio (la ruta responde 409)', () => {
    const error = new ApiClientConflictError('Ese tipo de cliente ya no se puede elegir');
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Ese tipo de cliente ya no se puede elegir');
  });
});
