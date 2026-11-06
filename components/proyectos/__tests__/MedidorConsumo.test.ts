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
 *   - la píldora compacta muestra en UNA línea «Semanal 42 %» y «5 h 31 %» con su mini barra; el
 *     detalle (reinicios, «token compartido», medición) va en el tooltip y en el aria-label;
 *   - sin medición la píldora SIGUE a la vista («Consumo: sin medición»);
 *   - ProyectoPage la pinta en la BARRA SUPERIOR (a la derecha de la miga en escritorio, en el
 *     encabezado del celular y en la cabecera del hilo a pantalla completa), YA NO en la barra lateral,
 *     y SIN depender del rol ni de `capabilities`: un miembro normal (lector) la ve igual que el dueño.
 *   Ajuste de Nicolás (2026-10-22): «este sidebar ya está muy cargado… cerca a la miga de pan».
 */
const render = (el: ReactElement) => renderToStaticMarkup(createElement(MantineProvider, null, el));
const ahora = Date.now();
const dto: CuotaAgenteDto = {
  code: 'horus',
  displayName: 'Orus',
  utilizacion7d: 42,
  reset7d: new Date(ahora + 30 * 3600_000).toISOString(),
  utilizacion5h: 31,
  reset5h: new Date(ahora + 90 * 60_000).toISOString(),
  overage: 'rejected',
  medidoEn: new Date(ahora - 60_000).toISOString(),
  fuente: 'turno',
};

describe('MedidorConsumo (píldora compacta)', () => {
  it('una sola línea con «Semanal 42 %» y «5 h 31 %», dos mini barras y el detalle accesible', () => {
    const html = render(createElement(MedidorConsumo, { agentes: [dto] }));
    expect(html).toContain('data-testid="medidor-consumo"');
    expect(html).toMatch(/>Semanal<[\s\S]*>42 %<[\s\S]*>5 h<[\s\S]*>31 %</);
    expect(html.match(/mantine-Progress-root/g)?.length).toBe(2);
    expect(html).toMatch(/<button[^>]*aria-label="Consumo de Anthropic\. Semanal 42 % · se reinicia [^"]*\. Ventana de 5 h 31 % · se libera [^"]*\. Consumo del token del agente \(compartido\)\. Medido el [^"]*"/);
    // Compacta: sin las líneas de detalle a la vista.
    expect(html).not.toMatch(/>se reinicia/);
  });

  it('sin medición la píldora sigue visible', () => {
    const html = render(createElement(MedidorConsumo, { agentes: [] }));
    expect(html).toContain('data-testid="medidor-consumo-vacio"');
    expect(html).toContain('Consumo: sin medición');
    expect(render(createElement(MedidorConsumo, { agentes: [], cargado: false }))).toContain('Consumo…');
  });

  it('con varios agentes, una píldora por agente con su nombre', () => {
    const html = render(createElement(MedidorConsumo, { agentes: [dto, { ...dto, code: 'play', displayName: 'Play', utilizacion7d: 95 }] }));
    expect(html).toContain('data-testid="medidor-consumo-horus"');
    expect(html).toContain('data-testid="medidor-consumo-play"');
    expect(html).toContain('>Play<');
  });
});

describe('ProyectoPage: la píldora va en la barra superior, fija y para todos los miembros', () => {
  const fuente = readFileSync(path.resolve(__dirname, '../ProyectoPage.tsx'), 'utf8');
  const usos = fuente.split('\n').filter((l) => l.includes('<MedidorConsumo'));

  it('a la derecha de la miga (escritorio), en el encabezado del celular y en la cabecera del hilo', () => {
    expect(usos).toHaveLength(3);
    expect(fuente).toMatch(/<Encabezado titulo=\{proyecto\?\.name \?\? 'Proyecto'\} derecha=\{<MedidorConsumo agentes=\{consumo\} cargado=\{consumoCargado\} \/>\} \/>/);
    expect(fuente.match(/className=\{css\.medidorMovil\}/g)).toHaveLength(2);
  });

  it('ya no está en la barra lateral (cabecera del proyecto)', () => {
    const lateral = fuente.slice(fuente.indexOf('const cabeceraProyecto'), fuente.indexOf('// ─── Escritorio: dos columnas ───'));
    expect(lateral.length).toBeGreaterThan(200);
    expect(lateral).not.toContain('MedidorConsumo');
  });

  it('no depende del rol, de capabilities ni de un permiso', () => {
    for (const l of usos) expect(l).not.toMatch(/myRole|role|capabilities|canManage|isAdmin|owner/i);
    expect(fuente).toMatch(/useConsumoAnthropic\(idProject\)/);
  });
});
