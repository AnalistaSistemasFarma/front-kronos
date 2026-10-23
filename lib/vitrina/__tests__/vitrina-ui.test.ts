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
