import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Regla de la Vitrina: solo componentes y tokens de SynerLink/Mantine. Nada de colores fijos ni hojas de estilo propias.
describe('Vitrina · interfaz con los temas de SynerLink', () => {
  const dir = join(__dirname, '..', '..', '..', 'components', 'vitrina');
  const archivos = readdirSync(dir).filter((f) => f.endsWith('.tsx'));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta fija del repositorio.
  const leer = (f: string) => readFileSync(join(dir, f), 'utf8');

  it('sin colores fijos (hex, rgb) ni CSS propio', () => {
    expect(archivos.length).toBeGreaterThan(10);
    for (const f of archivos) {
      const s = leer(f);
      expect(s, f).not.toMatch(/['"\s(]#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/);
      expect(s, f).not.toMatch(/\brgba?\(/);
      expect(s, f).not.toMatch(/import\s+['"][^'"]+\.(css|scss)['"]/);
    }
  });

  it('el modo presentación no muestra códigos SAP, alertas ni exclusividades', () => {
    const s = leer('VitrinaModoPresentacion.tsx');
    expect(s).toContain("catalogoUrl(company.idCompany, 'presentacion')");
    expect(s).not.toMatch(/\.itemCode|\.exclusividades|RegistroBadge|\.registroEstado|VisibilidadBadge/);
  });

  it('los documentos se ven en el visor seguro del SGC, sin descarga ni impresión', () => {
    const s = leer('VitrinaFicha.tsx');
    expect(s).toMatch(/<SgcSecureViewer[^>]*canDownload=\{false\}[^>]*canPrint=\{false\}[^>]*hideDownloadPrint/);
    expect(s).toContain('pendiente de vinculación');
  });
});

// Modelo 3D (2026-11-04): @google/model-viewer solo en el cliente y solo en la Vitrina.
describe('Vitrina · visor 3D (model-viewer)', () => {
  const raiz = join(__dirname, '..', '..', '..');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta fija del repositorio.
  const leer = (f: string) => readFileSync(join(raiz, f), 'utf8');

  it('se importa SOLO con import() dinámico dentro del visor (nada estático fuera de tipos)', () => {
    const s = leer('components/vitrina/VitrinaModelo3d.tsx');
    expect(s).toContain("import('@google/model-viewer')");
    expect(s).not.toMatch(/^import\s+(?!type\b)[^;]*['"]@google\/model-viewer['"]/m);
    expect(s).not.toMatch(/^import\s+['"]@google\/model-viewer['"]/m);
  });

  it('fondo con la superficie del tema, controles táctiles, AR sin Scene Viewer y póster', () => {
    const s = leer('components/vitrina/VitrinaModelo3d.tsx');
    expect(s).toContain("'var(--app-surface, var(--surface))'");
    expect(s).toContain('camera-controls');
    expect(s).toContain("touch-action='pan-y'");
    expect(s).toContain("ar-modes='webxr quick-look'");
    expect(s).toContain('canActivateAR');
    expect(s).toContain("'user-interaction'");
    expect(s).toContain('Ver en mi espacio');
  });

  it('la ficha pone el visor ANTES del vial y la etiqueta; la tarjeta marca «3D»', () => {
    const f = leer('components/vitrina/VitrinaFicha.tsx');
    expect(f.indexOf('<VitrinaModelo3d')).toBeGreaterThan(0);
    expect(f.indexOf('<VitrinaModelo3d')).toBeLessThan(f.indexOf("data-testid='vitrina-ficha-imagenes'"));
    expect(leer('components/vitrina/VitrinaTarjeta.tsx')).toContain('item.modelo3d');
    expect(leer('components/vitrina/VitrinaModoPresentacion.tsx')).toContain('p.modelo3d ?');
  });
});
