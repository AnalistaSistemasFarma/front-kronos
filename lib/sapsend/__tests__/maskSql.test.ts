import { describe, expect, it } from 'vitest';
import { maskSqlLiterals } from '../sqlLive.js';

describe('SQL del monitor sin valores literales', () => {
  it('tapa cadenas, incluidas las N\'…\' y las que traen comillas dobladas', () => {
    expect(maskSqlLiterals("SELECT * FROM OCRD WHERE CardCode = N'C830010792' AND CardName = 'O''Brien'")).toBe(
      "SELECT * FROM OCRD WHERE CardCode = '?' AND CardName = '?'"
    );
  });

  it('tapa la clave de un CREATE LOGIN', () => {
    expect(maskSqlLiterals("CREATE LOGIN lector WITH PASSWORD = 'S3cr3t!'")).toBe(
      "CREATE LOGIN lector WITH PASSWORD = '?'"
    );
  });

  it('tapa una cadena que quedó abierta por el corte de 4000 caracteres', () => {
    expect(maskSqlLiterals("UPDATE T SET nota = N'texto largo sin cerrar")).toBe("UPDATE T SET nota = '?'");
  });

  it('tapa números largos y binarios, pero deja nombres, parámetros y números cortos', () => {
    expect(maskSqlLiterals('SELECT TOP 40 DocTotal FROM OINV WHERE DocEntry = 123456 AND Total > 1500.75')).toBe(
      'SELECT TOP 40 DocTotal FROM OINV WHERE DocEntry = ? AND Total > ?'
    );
    expect(maskSqlLiterals('SELECT * FROM T2024 WHERE id = @P123 AND h = 0xA1B2C3')).toBe(
      'SELECT * FROM T2024 WHERE id = @P123 AND h = 0x?'
    );
  });

  it('corta a 2000 caracteres y respeta null', () => {
    expect(maskSqlLiterals('x'.repeat(5000))).toHaveLength(2000);
    expect(maskSqlLiterals(null)).toBeNull();
  });
});
