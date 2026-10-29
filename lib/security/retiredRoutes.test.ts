/* eslint-disable security/detect-non-literal-fs-filename -- la prueba recorre carpetas del propio repo */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isRetiredApiPath } from './retiredRoutes';

const ROOT = resolve(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|cjs|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

describe('ruta vieja purchase-request retirada', () => {
  it('el middleware la reconoce como retirada (410) en todas sus variantes', () => {
    expect(isRetiredApiPath('/api/purchase-request')).toBe(true);
    expect(isRetiredApiPath('/api/purchase-request/access')).toBe(true);
    expect(isRetiredApiPath('/api/purchase-request/auth')).toBe(true);
    expect(isRetiredApiPath('/api/purchase-request/drafts')).toBe(true);
    expect(isRetiredApiPath('/api/Purchase-Request/AUTH')).toBe(true);
  });

  it('no afecta al módulo de Compras vigente ni a rutas parecidas', () => {
    expect(isRetiredApiPath('/api/purchases/drafts')).toBe(false);
    expect(isRetiredApiPath('/api/purchases/list')).toBe(false);
    expect(isRetiredApiPath('/api/purchase-requests')).toBe(false);
    expect(isRetiredApiPath('/api/requests-general')).toBe(false);
  });

  it('los archivos de la ruta y de la página ya no existen', () => {
    expect(existsSync(join(ROOT, 'app/api/purchase-request'))).toBe(false);
    expect(existsSync(join(ROOT, 'app/(hub)/process/purchases/purchase-request'))).toBe(false);
  });

  it('ningún código de la app llama a /api/purchase-request', () => {
    const offenders = ['app', 'components', 'hooks', 'lib']
      .flatMap((d) => walk(join(ROOT, d)))
      .filter((f) => !f.includes(join('lib', 'security')))
      .filter((f) => readFileSync(f, 'utf8').includes('/api/purchase-request'));
    expect(offenders).toEqual([]);
  });
});
