import { describe, expect, it } from 'vitest';
import { cursoDesdeParametro, rutaSiguienteValida, urlFormacionDelCurso, urlIngresoYVolverAFormacion } from '../formacion-navegacion';

// Invitación a un curso (Cristian Baldión, 2026-10-14): el enlace abre el curso y el ingreso por código regresa a él.

describe('cursoDesdeParametro', () => {
  it('acepta un entero positivo y rechaza todo lo demás', () => {
    expect(cursoDesdeParametro('7')).toBe(7);
    expect(cursoDesdeParametro('123456789')).toBe(123456789);
    for (const x of ['0', '-1', '1.5', '1e3', ' 7', '7 ', 'abc', '', '1234567890', '7;DROP', null, undefined]) {
      expect(cursoDesdeParametro(x as string | null | undefined), String(x)).toBeNull();
    }
  });
});

describe('rutaSiguienteValida (no puede ser un redireccionamiento abierto)', () => {
  it('acepta solo la ruta de Formación, con o sin un curso', () => {
    expect(rutaSiguienteValida('/portal/formacion')).toBe('/portal/formacion');
    expect(rutaSiguienteValida('/portal/formacion?curso=7')).toBe('/portal/formacion?curso=7');
  });
  it('rechaza URLs externas, otras rutas y variantes con trampa', () => {
    for (const x of [
      'https://evil.com',
      '//evil.com',
      '/\\evil.com',
      '/portal',
      '/portal/formacion/otro',
      '/portal/formacion?curso=7&x=1',
      '/portal/formacion?curso=007',
      '/portal/formacion?curso=0',
      '/portal/formacion?curso=7#x',
      '/portal/formacion?curso=',
      '/portal/formacion?desde=hub',
      'javascript:alert(1)',
      '/process/portal-th',
      '',
      null,
      undefined,
    ]) {
      expect(rutaSiguienteValida(x as string | null | undefined), String(x)).toBeNull();
    }
  });
  it('lo que arma el portal para volver a Formación lo acepta él mismo', () => {
    const url = urlIngresoYVolverAFormacion(7);
    expect(url).toBe('/portal?siguiente=%2Fportal%2Fformacion%3Fcurso%3D7');
    const siguiente = new URL(url, 'https://x.test').searchParams.get('siguiente');
    expect(rutaSiguienteValida(siguiente)).toBe(urlFormacionDelCurso(7));
    expect(urlIngresoYVolverAFormacion(null)).toBe('/portal?siguiente=%2Fportal%2Fformacion');
  });
});
