import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import { describe, expect, it, vi } from 'vitest';
// El CSS module no se procesa en Node (postcss de Tailwind): cada clase vale su propio nombre.
vi.mock('../proyectos.module.css', () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock('../api', () => ({ apiSend: vi.fn(), apiGet: vi.fn(), fechaCorta: (x: string) => x }));
import PermisosSegunAgentes from '../permisos/PermisosSegunAgentes';
import { valorInicialEdicion } from '../permisos/EditarPermisosModal';
import type { PermisosProyectoDto, RepoCatalogoDto } from '../../../lib/proyectos/permisos-agentes-tipos';

/*
 * Agentes de negocio en proyectos con código (2026-10-27 → 2026-11-11, Nicolás Rivera: «la mesa de
 * discusión no debe depender de proyectos de desarrollo»). El formulario de nivel y repos se ofrece
 * siempre; con agentes de negocio y una política con código, un aviso informativo (no bloquea).
 */
const render = (el: ReactElement) => renderToStaticMarkup(createElement(MantineProvider, null, el));
const catalogo: RepoCatalogoDto[] = [
  { idRepo: 1, slug: 'front-kronos', name: 'SynerLink', github: 'AnalistaSistemasFarma/front-kronos', branchTesting: 'testing', branchProduction: 'main', description: null, active: true, updatedAt: '2026-10-20T00:00:00Z' },
  { idRepo: 2, slug: 'sapsend', name: 'SAPSEND', github: 'gsslatam/sapsend', branchTesting: 'testing', branchProduction: 'production', description: null, active: true, updatedAt: '2026-10-20T00:00:00Z' },
];
const base = { valor: { codeLevel: 'lectura' as const, repos: ['sapsend'], deployApprovers: [] }, onChange: () => {}, catalogo, operadores: [] };

describe('PermisosSegunAgentes', () => {
  it('con agentes de desarrollo: nivel de código y repositorios, sin aviso', () => {
    const html = render(createElement(PermisosSegunAgentes, { ...base, agentesNegocio: [] }));
    expect(html).toContain('data-testid="permisos-formulario"');
    expect(html).toContain('data-testid="permisos-nivel-lectura"');
    expect(html).toContain('data-testid="permisos-repo-sapsend"');
    expect(html).not.toContain('permisos-negocio-sin-codigo');
  });

  it('con Play (negocio) y código: el formulario sigue y aparece el aviso informativo', () => {
    const html = render(createElement(PermisosSegunAgentes, { ...base, agentesNegocio: ['Play'] }));
    expect(html).toContain('data-testid="permisos-formulario"');
    expect(html).toContain('data-testid="permisos-repo-sapsend"');
    expect(html).toContain('data-testid="permisos-negocio-sin-codigo"');
    expect(html).toContain('Play no es agente de desarrollo: participa sin acceso al código.');
  });

  it('con Play y «Ninguno»: sin aviso (no hay código que negarle)', () => {
    const html = render(createElement(PermisosSegunAgentes, { ...base, valor: { codeLevel: 'ninguno' as const, repos: [], deployApprovers: [] }, agentesNegocio: ['Play'] }));
    expect(html).not.toContain('permisos-negocio-sin-codigo');
  });
});

describe('«Cambiar permisos» con un agente de negocio', () => {
  const dto = (codeAllowed?: boolean): PermisosProyectoDto => ({
    policy: { codeLevel: 'lectura', repos: catalogo, deployApprovers: [], configurada: true, reason: 'x', updatedAt: null, updatedBy: null },
    canEdit: true,
    codeAllowed,
    nonDevAgents: ['Play'],
    catalog: catalogo,
    operators: [],
    log: [],
  });

  it('arranca con lo guardado, aunque haya agentes de negocio (y aunque una respuesta vieja diga codeAllowed=false)', () => {
    const guardado = { codeLevel: 'lectura', repos: ['front-kronos', 'sapsend'], deployApprovers: [] };
    expect(valorInicialEdicion(dto(true))).toEqual(guardado);
    expect(valorInicialEdicion(dto(false))).toEqual(guardado);
    expect(valorInicialEdicion(dto(undefined))).toEqual(guardado);
  });
});
