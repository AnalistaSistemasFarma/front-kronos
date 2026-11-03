import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_CHAT_REQUEST_BODY_BYTES,
  getRequestBodySizeError,
} from '../attachments';

/**
 * Tope del cuerpo completo de las peticiones del chat (2026-10-30).
 *
 * Next.js truncaba en silencio, pasados 10 MB, el cuerpo de toda petición que
 * cruza middleware.ts, y los adjuntos grandes fallaban con un 400 genérico. El
 * tope se subió a 30 MB en next.config.ts y las rutas responden 413 claro cuando
 * se excede.
 */
describe('tope del cuerpo de la petición', () => {
  it('son 30 MB y caben un adjunto del tope por archivo más la envoltura', () => {
    expect(MAX_CHAT_REQUEST_BODY_BYTES).toBe(30 * 1024 * 1024);
    expect(MAX_CHAT_REQUEST_BODY_BYTES).toBeGreaterThan(MAX_CHAT_ATTACHMENT_BYTES + 1024 * 1024);
  });

  it('coincide con experimental.middlewareClientMaxBodySize de next.config.ts', () => {
    const config = readFileSync(join(__dirname, '..', '..', '..', 'next.config.ts'), 'utf8');
    const match = config.match(/middlewareClientMaxBodySize:\s*([\d\s*]+),/);
    expect(match).not.toBeNull();
    const bytes = match![1]
      .split('*')
      .map((n) => Number(n.trim()))
      .reduce((a, b) => a * b, 1);
    expect(bytes).toBe(MAX_CHAT_REQUEST_BODY_BYTES);
  });

  it('IIS (deploy/iis/web.config) deja pasar más que Next, para que llegue el 413 de la app', () => {
    const webConfig = readFileSync(join(__dirname, '..', '..', '..', 'deploy', 'iis', 'web.config'), 'utf8');
    const match = webConfig.match(/maxAllowedContentLength="(\d+)"/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThan(MAX_CHAT_REQUEST_BODY_BYTES);
  });

  it('no objeta cuerpos dentro del tope ni peticiones sin Content-Length', () => {
    expect(getRequestBodySizeError(null)).toBeNull();
    expect(getRequestBodySizeError(undefined)).toBeNull();
    expect(getRequestBodySizeError('')).toBeNull();
    expect(getRequestBodySizeError('abc')).toBeNull();
    expect(getRequestBodySizeError('0')).toBeNull();
    // Medidas reales de prod que sí pasaban / que fallaban con el tope viejo.
    expect(getRequestBodySizeError(String(7.6 * 1024 * 1024))).toBeNull();
    expect(getRequestBodySizeError(String(21 * 1024 * 1024))).toBeNull();
    expect(getRequestBodySizeError(String(MAX_CHAT_REQUEST_BODY_BYTES))).toBeNull();
  });

  it('explica el tamaño cuando se excede', () => {
    const error = getRequestBodySizeError(String(MAX_CHAT_REQUEST_BODY_BYTES + 1));
    expect(error).not.toBeNull();
    expect(error).toContain('30.0 MB');
    expect(error).toMatch(/máximo por mensaje/);

    const grande = getRequestBodySizeError(String(48 * 1024 * 1024));
    expect(grande).toContain('48.0 MB');
  });

  it('acepta un tope distinto', () => {
    expect(getRequestBodySizeError('11', 10)).not.toBeNull();
    expect(getRequestBodySizeError('10', 10)).toBeNull();
  });
});
