import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Regla del V2: SAP SOLO LECTURA. Ningún archivo de la Vitrina (lib, rutas, componentes) usa escrituras del Service Layer.
describe('Vitrina · SAP solo lectura', () => {
  const raiz = join(__dirname, '..', '..', '..');
  const archivos = (dir: string): string[] =>
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas del repositorio.
    readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? archivos(join(dir, d.name)) : /\.(ts|tsx)$/.test(d.name) && !d.name.endsWith('.test.ts') ? [join(dir, d.name)] : []));

  it('no importa sapPost, sapPatch, sapDelete ni sapUploadFiles', () => {
    const todos = [join(raiz, 'lib', 'vitrina'), join(raiz, 'app', 'api', 'vitrina'), join(raiz, 'components', 'vitrina')].flatMap(archivos);
    expect(todos.length).toBeGreaterThan(5);
    for (const f of todos) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas del repositorio.
      const s = readFileSync(f, 'utf8');
      expect(s, f).not.toMatch(/\bsap(Post|Patch|Delete|UploadFiles)\b/);
    }
  });

  it('la lectura usa solo Login, GET y Logout', () => {
    const s = readFileSync(join(raiz, 'lib', 'vitrina', 'sap.ts'), 'utf8');
    const importados = /import \{([^}]+)\} from '\.\.\/sap\/serviceLayer'/.exec(s)![1].split(',').map((x) => x.trim());
    expect(importados.sort()).toEqual(['sapGetAll', 'sapLogin', 'sapLogout']);
  });
});
