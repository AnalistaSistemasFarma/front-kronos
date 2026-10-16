import { describe, expect, it } from 'vitest';
import {
  moduleLabel,
  normalizeOutboundHost,
  normalizeRoutePath,
  outboundHostLabel,
} from '../routeKey';

describe('normalizeRoutePath', () => {
  it('quita la query y agrupa por módulo de API', () => {
    expect(normalizeRoutePath('/api/requests-general/view-request?id=812')).toEqual({
      path: '/api/requests-general/view-request',
      module: 'requests-general',
    });
  });

  it('usa el tercer segmento para /api/integrations/*', () => {
    expect(normalizeRoutePath('/api/integrations/orion/signed-file?requestId=1').module).toBe('orion');
  });

  it('reemplaza ids numéricos, uuids, correos y tokens', () => {
    expect(normalizeRoutePath('/api/chat/conversations/123/poll').path).toBe(
      '/api/chat/conversations/:id/poll'
    );
    expect(
      normalizeRoutePath('/api/sgc/requests/3f2a9c1e-1b2c-4d5e-8f90-1234567890ab').path
    ).toBe('/api/sgc/requests/:id');
    expect(normalizeRoutePath('/api/users/juan%40gsslatam.com').path).toBe('/api/users/:email');
    expect(normalizeRoutePath('/firma/externa/aB3dE5fG7hJ9kL1mN3pQ').path).toBe('/firma/externa/:token');
  });

  it('no confunde nombres de ruta largos sin dígitos con tokens', () => {
    expect(normalizeRoutePath('/api/requests-general/update-workflow-complete').path).toBe(
      '/api/requests-general/update-workflow-complete'
    );
  });

  it('agrupa estáticos de Next y archivos públicos', () => {
    expect(normalizeRoutePath('/_next/static/chunks/app/page-abc.js')).toEqual({
      path: '/_next/static/*',
      module: 'estaticos',
    });
    expect(normalizeRoutePath('/icons/logo.png')).toEqual({ path: '/*.png', module: 'estaticos' });
  });

  it('páginas del hub usan el segundo segmento como módulo', () => {
    expect(normalizeRoutePath('/process/help-desk/view-ticket').module).toBe('help-desk');
  });

  it('la raíz y entradas vacías', () => {
    expect(normalizeRoutePath('/')).toEqual({ path: '/', module: 'inicio' });
    expect(normalizeRoutePath(undefined)).toEqual({ path: '/', module: 'inicio' });
  });

  it('recorta rutas muy profundas', () => {
    expect(normalizeRoutePath('/a/b/c/d/e/f/g/h').path).toBe('/a/b/c/d/e/f/*');
  });
});

describe('normalizeOutboundHost', () => {
  it('extrae el host de un origin', () => {
    expect(normalizeOutboundHost('https://graph.microsoft.com')).toBe('graph.microsoft.com');
    expect(normalizeOutboundHost(null, '192.168.10.7:50000')).toBe('192.168.10.7:50000');
    expect(normalizeOutboundHost('')).toBe('(desconocido)');
  });
});

describe('etiquetas', () => {
  it('traduce módulos conocidos y deja los demás igual', () => {
    expect(moduleLabel('requests-general')).toBe('Solicitudes generales');
    expect(moduleLabel('algo-nuevo')).toBe('algo-nuevo');
  });

  it('reconoce servicios externos', () => {
    expect(outboundHostLabel('graph.microsoft.com')).toContain('Graph');
    expect(outboundHostLabel('localhost:3000', 'localhost:3000')).toBe('Orion (firma)');
    expect(outboundHostLabel('192.168.10.7:50000')).toBe('SAP Service Layer');
  });
});
