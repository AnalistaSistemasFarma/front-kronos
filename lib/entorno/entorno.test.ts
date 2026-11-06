import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ICONOS_PRUEBAS, esEntornoPruebas, tituloSegunEntorno } from './index';

describe('esEntornoPruebas', () => {
  it('solo se activa con SYNERLINK_ENTORNO=pruebas', () => {
    expect(esEntornoPruebas({ SYNERLINK_ENTORNO: 'pruebas' })).toBe(true);
    expect(esEntornoPruebas({ SYNERLINK_ENTORNO: ' Pruebas ' })).toBe(true);
  });

  it('producción (sin variable u otro valor) queda igual', () => {
    expect(esEntornoPruebas({})).toBe(false);
    expect(esEntornoPruebas({ SYNERLINK_ENTORNO: '' })).toBe(false);
    expect(esEntornoPruebas({ SYNERLINK_ENTORNO: 'produccion' })).toBe(false);
    expect(esEntornoPruebas({ NEXT_PUBLIC_APP_ENV: 'pruebas' })).toBe(false);
  });
});

describe('tituloSegunEntorno', () => {
  it('antepone el prefijo solo en pruebas', () => {
    expect(tituloSegunEntorno('SynerLink', true)).toBe('🧪 TEST · SynerLink');
    expect(tituloSegunEntorno('SynerLink', false)).toBe('SynerLink');
  });
});

describe('ICONOS_PRUEBAS', () => {
  it('todos los archivos existen en public/', () => {
    for (const ruta of Object.values(ICONOS_PRUEBAS)) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas de ICONOS_PRUEBAS
      expect(existsSync(path.join(process.cwd(), 'public', ruta))).toBe(true);
    }
  });
});
