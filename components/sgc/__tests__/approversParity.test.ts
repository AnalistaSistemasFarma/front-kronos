import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import { describe, expect, it, vi } from 'vitest';

/**
 * PARIDAD de «Aprobadores autorizados» (Sprint 12) con «Personas por cargo»
 * (SgcCargoMembers): misma tarjeta, mismo texto de ayuda, misma fila de
 * formulario, misma tabla Mantine y misma fila vacía. Se renderizan ambas
 * pantallas sin datos y se comparan sus elementos estructurales.
 */
vi.mock('../useSgcFetch', () => ({
  useSgcFetch: (url: string | null) => ({
    data: url?.includes('/approvers') ? { enforced: true, applies: false, items: [] } : url?.includes('/cargo-members') ? { cargos: [], members: [] } : { users: [] },
    error: null,
    loading: false,
    reload: () => undefined,
  }),
  sgcSend: vi.fn(),
}));

const render = (el: ReactElement) => renderToStaticMarkup(createElement(MantineProvider, null, el));
const normalize = (html: string) =>
  html
    .replace(/<style\b[\s\S]*?<\/style>/g, '')
    .replace(/ data-testid="[^"]*"/g, '')
    .replace(/(id|for|aria-labelledby|aria-describedby|aria-controls)="[^"]*"/g, '$1=""');
const openTag = (html: string, marker: RegExp) => html.match(marker)?.[0] ?? null;

describe('SGC · paridad de «Aprobadores autorizados» con «Personas por cargo»', () => {
  it('[SGC-REQ-139] la tarjeta, la ayuda, el formulario, la tabla y la fila vacía usan el mismo marcado', async () => {
    const { default: SgcCargoMembers } = await import('../SgcCargoMembers');
    const { default: SgcApprovers } = await import('../SgcApprovers');
    const cargo = normalize(render(createElement(SgcCargoMembers, { idCompany: 3 })));
    const appr = normalize(render(createElement(SgcApprovers, { idCompany: 3, processes: [] })));
    const markers = [
      /<div[^>]*class="[^"]*mantine-Card-root[^"]*"[^>]*>/,
      /<p[^>]*mantine-Text-root[^>]*data-size="sm"[^>]*>/,
      /<div[^>]*class="[^"]*mantine-Group-root[^"]*"[^>]*>/,
      /<table[^>]*>/,
      /<thead[^>]*>/,
      /<th[^>]*>/,
      /<button[^>]*mantine-Button-root[^>]*>/,
    ];
    for (const re of markers) {
      const a = openTag(cargo, re);
      expect(a, String(re)).not.toBeNull();
      expect(openTag(appr, re), String(re)).toBe(a);
    }
    expect(cargo).toContain('Aún no hay personas registradas por cargo.');
    expect(appr).toContain('Aún no hay aprobadores autorizados.');
  });
});
