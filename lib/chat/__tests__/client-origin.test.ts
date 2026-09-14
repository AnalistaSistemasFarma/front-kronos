import { describe, expect, it } from 'vitest';
import { readClientOrigin } from '../client-origin';

/** Petición mínima con las cabeceras que interesan. */
function pedir(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/chat/conversations/1/messages', { headers });
}

describe('readClientOrigin', () => {
  it('quita el puerto que agrega el proxy de IIS (ARR)', () => {
    // Es el caso real de producción: ARR está configurado con
    // includePortInXForwardedFor = True, así que la IP llega con puerto.
    expect(readClientOrigin(pedir({ 'x-forwarded-for': '192.168.10.20:54321' })).clientIp).toBe(
      '192.168.10.20'
    );
  });

  it('deja la IP intacta cuando viene sin puerto', () => {
    expect(readClientOrigin(pedir({ 'x-forwarded-for': '10.1.2.3' })).clientIp).toBe('10.1.2.3');
  });

  it('toma la primera de la cadena cuando hay varios proxies', () => {
    expect(
      readClientOrigin(pedir({ 'x-forwarded-for': '10.1.2.3, 172.16.0.1, 192.168.1.1' })).clientIp
    ).toBe('10.1.2.3');
  });

  it('desenvuelve una IPv6 entre corchetes y le quita el puerto', () => {
    expect(readClientOrigin(pedir({ 'x-forwarded-for': '[2001:db8::1]:54321' })).clientIp).toBe(
      '2001:db8::1'
    );
  });

  it('no parte una IPv6 sin corchetes', () => {
    // Tiene varios ':' y no hay forma de saber si el último es puerto o parte
    // de la dirección: partirla la dañaría.
    expect(readClientOrigin(pedir({ 'x-forwarded-for': '2001:db8::1' })).clientIp).toBe(
      '2001:db8::1'
    );
  });

  it('cae a x-real-ip cuando no hay x-forwarded-for', () => {
    expect(readClientOrigin(pedir({ 'x-real-ip': '10.9.9.9' })).clientIp).toBe('10.9.9.9');
  });

  it('devuelve null cuando ninguna cabecera de origen llega', () => {
    // Lo importante del caso: NO se inventa un valor ni se pone "desconocida".
    expect(readClientOrigin(pedir({})).clientIp).toBeNull();
  });

  it('ignora una cabecera vacía en vez de guardar cadena vacía', () => {
    expect(readClientOrigin(pedir({ 'x-forwarded-for': '   ' })).clientIp).toBeNull();
  });

  it('recorta el navegador al tope de la columna', () => {
    const largo = 'Mozilla/'.padEnd(600, 'x');
    const { userAgent } = readClientOrigin(pedir({ 'user-agent': largo }));
    expect(userAgent).toHaveLength(400);
  });

  it('devuelve null cuando no hay navegador declarado', () => {
    expect(readClientOrigin(pedir({})).userAgent).toBeNull();
  });
});
