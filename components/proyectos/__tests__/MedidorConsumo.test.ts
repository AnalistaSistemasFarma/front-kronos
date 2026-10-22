import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import { describe, expect, it, vi } from 'vitest';
// El CSS module no se procesa en Node (postcss de Tailwind): cada clase vale su propio nombre.
vi.mock('../proyectos.module.css', () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
import MedidorConsumo from '../MedidorConsumo';
import type { CuotaAgenteDto } from '../../../lib/proyectos/consumo-anthropic';

/*
 * Medidor del consumo de Anthropic (2026-10-22). Aclaración de Nicolás: «es algo estático, para que
 * todos los integrantes del grupo puedan verlo». Se verifica que:
 *   - lo esencial (las dos barras, %, reinicios y «token compartido») está en el marcado visible, no
 *     escondido en el tooltip;
 *   - sin medición la caja SIGUE a la vista («sin medición todavía»);
 *   - ProyectoPage lo pinta en el encabezado (escritorio y celular) y en el hilo a pantalla completa,
 *     SIN depender del rol ni de `capabilities`: un miembro normal (lector) lo ve igual que el dueño.
 */
const render = (el: ReactElement) => renderToStaticMarkup(createElement(MantineProvider, null, el));
const ahora = Date.now();
const dto: CuotaAgenteDto = {
  code: 'horus',
  displayName: 'Orus',
  utilizacion7d: 40,
  reset7d: new Date(ahora + 30 * 3600_000).toISOString(),
  utilizacion5h: 92,
  reset5h: new Date(ahora + 90 * 60_000).toISOString(),
  overage: 'rejected',
  medidoEn: new Date(ahora - 60_000).toISOString(),
  fuente: 'turno',
};

describe('MedidorConsumo', () => {
  it('pinta a la vista las dos barras con su %, el reinicio y «token compartido»', () => {
    for (const compacto of [false, true]) {
      const html = render(createElement(MedidorConsumo, { agentes: [dto], compacto }));
      expect(html).toContain('data-testid="medidor-consumo"');
      expect(html).toContain('Semanal');
      expect(html).toContain('Ventana de 5 h');
      expect(html).toContain('40 %');
      expect(html).toContain('92 %');
      expect(html).toMatch(/se reinicia (lun|mar|mié|jue|vie|sáb|dom) \d+ \w+, \d+:\d\d [ap]\. m\./);
      expect(html).toMatch(/se (libera a las|libera el)/);
      expect(html).toContain('token compartido');
      expect(html.match(/mantine-Progress-root/g)?.length).toBe(2);
    }
  });

  it('sin medición la caja sigue visible', () => {
    const html = render(createElement(MedidorConsumo, { agentes: [] }));
    expect(html).toContain('data-testid="medidor-consumo-vacio"');
    expect(html).toContain('sin medición todavía');
    expect(render(createElement(MedidorConsumo, { agentes: [], cargado: false }))).toContain('cargando');
  });
});

describe('ProyectoPage: el medidor es fijo y para todos los miembros', () => {
  const fuente = readFileSync(path.resolve(__dirname, '../ProyectoPage.tsx'), 'utf8');
  const usos = fuente.split('\n').filter((l) => l.includes('<MedidorConsumo'));

  it('aparece en el encabezado de escritorio, en el de celular y en el hilo a pantalla completa', () => {
    expect(usos).toHaveLength(3);
    expect(fuente).toMatch(/<MedidorConsumo agentes=\{consumo\} cargado=\{consumoCargado\} \/>/);
    expect(usos.filter((l) => l.includes('compacto'))).toHaveLength(2);
  });

  it('no depende del rol, de capabilities ni de un permiso: ningún uso está condicionado a ellos', () => {
    for (const l of usos) expect(l).not.toMatch(/myRole|role|capabilities|canManage|isAdmin|owner/i);
    expect(fuente).toMatch(/useConsumoAnthropic\(idProject\)/);
  });
});
