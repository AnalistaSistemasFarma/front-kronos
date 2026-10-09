import { describe, expect, it, vi } from 'vitest';

// El CSS module no aporta a la prueba (y Vite no carga la config de PostCSS de Next).
vi.mock('../../../components/avatar/avatarEditor.module.css', () => ({
  default: new Proxy({}, { get: (_t, clave) => String(clave) }),
}));
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import FiguraEditor from '../../../components/avatar/FiguraEditor';
import { figuraPorDefecto, FIGURA_KINDS } from '../figuras';

describe('FiguraEditor (render en el servidor)', () => {
  it('pinta la vista previa y un círculo por opción, sin SVG en línea', () => {
    for (const kind of FIGURA_KINDS) {
      const html = renderToStaticMarkup(
        createElement(MantineProvider, null, createElement(FiguraEditor, { config: figuraPorDefecto(kind, 'Orión'), onChange: () => {} }))
      );
      expect(html).toContain('data-testid="avatar-canvas"');
      expect(html).toContain('src="data:image/svg+xml;charset=utf-8,');
      for (const label of ['Figura', 'Expresión', 'Accesorio: Ninguno', 'Relleno: Blanco', 'Acento: Negro', 'Fondo: Gris claro'])
        expect(html).toContain(label);
      expect(html).not.toContain('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"');
    }
  });
});
