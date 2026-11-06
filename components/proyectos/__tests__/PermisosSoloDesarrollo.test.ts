import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import { describe, expect, it, vi } from 'vitest';
// El CSS module no se procesa en Node (postcss de Tailwind): cada clase vale su propio nombre.
vi.mock('../proyectos.module.css', () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock('../api', () => ({ apiSend: vi.fn(), apiGet: vi.fn(), fechaCorta: (x: string) => x }));
import PermisosSegunAgentes from '../permisos/PermisosSegunAgentes';
import { valorInicialEdicion } from '../permisos/EditarPermisosModal';
import { PERMISOS_POR_DEFECTO } from '../permisos/FormPermisosAgentes';
import type { PermisosProyectoDto, RepoCatalogoDto } from '../../../lib/proyectos/permisos-agentes-tipos';

/*
 * Regla de Nicolás Rivera (2026-10-27): en «Nuevo proyecto» y en «Permisos de los agentes», la
 * sección de nivel de código y repos SOLO aparece si los agentes son de desarrollo (Orus, Pedro).
 * Con Play (negocio) se ve un aviso y no se ofrecen ni nivel ni repos.
 */
const render = (el: ReactElement) => renderToStaticMarkup(createElement(MantineProvider, null, el));
const catalogo: RepoCatalogoDto[] = [
  { idRepo: 1, slug: 'front-kronos', name: 'SynerLink', github: 'AnalistaSistemasFarma/front-kronos', branchTesting: 'testing', branchProduction: 'main', description: null, active: true, updatedAt: '2026-10-20T00:00:00Z' },
  { idRepo: 2, slug: 'sapsend', name: 'SAPSEND', github: 'gsslatam/sapsend', branchTesting: 'testing', branchProduction: 'production', description: null, active: true, updatedAt: '2026-10-20T00:00:00Z' },
];
const base = { valor: { codeLevel: 'lectura' as const, repos: ['sapsend'], deployApprovers: [] }, onChange: () => {}, catalogo, operadores: [] };

describe('PermisosSegunAgentes', () => {
  it('con agentes de desarrollo: nivel de código y repositorios', () => {
    const html = render(createElement(PermisosSegunAgentes, { ...base, codigoPermitido: true, agentesNegocio: [] }));
    expect(html).toContain('data-testid="permisos-formulario"');
    expect(html).toContain('data-testid="permisos-nivel-lectura"');
    expect(html).toContain('data-testid="permisos-repo-sapsend"');
    expect(html).not.toContain('permisos-solo-desarrollo');
  });

  it('con Play (negocio): ni nivel ni repos, solo el aviso con su nombre', () => {
    const html = render(createElement(PermisosSegunAgentes, { ...base, codigoPermitido: false, agentesNegocio: ['Play'] }));
    expect(html).toContain('data-testid="permisos-solo-desarrollo"');
    expect(html).toContain('Play no es agente de desarrollo');
    expect(html).not.toContain('permisos-formulario');
    expect(html).not.toContain('permisos-nivel-');
    expect(html).not.toContain('permisos-repo-');
    expect(html).not.toContain('front-kronos');
  });

  it('sin asistentes escogidos todavía: pide escogerlos, sin formulario', () => {
    const html = render(createElement(PermisosSegunAgentes, { ...base, codigoPermitido: false, sinAgentes: true, agentesNegocio: [] }));
    expect(html).toContain('Escoja los asistentes');
    expect(html).not.toContain('permisos-formulario');
  });
});

describe('«Cambiar permisos» con un agente de negocio', () => {
  const dto = (codeAllowed?: boolean): PermisosProyectoDto => ({
    policy: { codeLevel: 'lectura', repos: catalogo, deployApprovers: [], configurada: true, reason: 'x', updatedAt: null, updatedBy: null },
    canEdit: true,
    codeAllowed,
    nonDevAgents: codeAllowed === false ? ['Play'] : [],
    catalog: catalogo,
    operators: [],
    log: [],
  });

  it('arranca en «Ninguno» sin repos (guardar corrige el proyecto, como el 9)', () => {
    expect(valorInicialEdicion(dto(false))).toEqual(PERMISOS_POR_DEFECTO);
  });

  it('con agentes de desarrollo (o respuesta vieja sin el campo) arranca con lo guardado', () => {
    expect(valorInicialEdicion(dto(true))).toEqual({ codeLevel: 'lectura', repos: ['front-kronos', 'sapsend'], deployApprovers: [] });
    expect(valorInicialEdicion(dto(undefined)).codeLevel).toBe('lectura');
  });
});
