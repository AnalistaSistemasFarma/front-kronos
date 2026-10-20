import { describe, expect, it } from 'vitest';
import {
  AI_ASSISTANTS_MODULE,
  chatLookupTarget,
  isWaitingRoute,
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

describe('isWaitingRoute', () => {
  it('reconoce los long-poll del chat (espera, no consumo)', () => {
    expect(isWaitingRoute(normalizeRoutePath('/api/chat/pulse?since=9').path)).toBe(true);
    expect(isWaitingRoute(normalizeRoutePath('/api/chat/agent/inbox?wait=25').path)).toBe(true);
    expect(isWaitingRoute(normalizeRoutePath('/api/chat/conversations/12/poll?after=5').path)).toBe(false);
    expect(isWaitingRoute(normalizeRoutePath('/api/requests-general/view-request').path)).toBe(false);
  });
});

describe('chat entre personas y Asistentes IA', () => {
  it('separa por ruta lo que es solo de agentes y lo que es solo entre personas', () => {
    expect(normalizeRoutePath('/api/chat/agent/inbox?wait=25').module).toBe(AI_ASSISTANTS_MODULE);
    expect(normalizeRoutePath('/api/chat/groups/4/participants').module).toBe(AI_ASSISTANTS_MODULE);
    expect(normalizeRoutePath('/api/chat/auditoria/inventario').module).toBe(AI_ASSISTANTS_MODULE);
    expect(normalizeRoutePath('/api/chat/conversations').module).toBe(AI_ASSISTANTS_MODULE);
    expect(normalizeRoutePath('/process/chat').module).toBe(AI_ASSISTANTS_MODULE);
    expect(normalizeRoutePath('/process/chat/proyecto/3').module).toBe(AI_ASSISTANTS_MODULE);
    expect(normalizeRoutePath('/api/chat/pulse?since=9').module).toBe('chat');
    expect(normalizeRoutePath('/api/chat/people/conversations').module).toBe('chat');
    expect(normalizeRoutePath('/process/chat/persona/12').module).toBe('chat');
    expect(moduleLabel(AI_ASSISTANTS_MODULE)).toBe('Asistentes IA');
    expect(moduleLabel('chat')).toBe('Chat');
  });

  it('marca para consultar en la base las rutas que sirven a los dos (un hilo, un adjunto)', () => {
    expect(chatLookupTarget('/api/chat/conversations/57/poll?after=3')).toEqual({ table: 'conversation', id: 57 });
    expect(chatLookupTarget('/api/chat/conversations/57')).toEqual({ table: 'conversation', id: 57 });
    expect(chatLookupTarget('/api/chat/attachments/42')).toEqual({ table: 'attachment', id: 42 });
    expect(chatLookupTarget('/api/chat/conversations')).toBeNull();
    expect(chatLookupTarget('/api/chat/pulse')).toBeNull();
    expect(chatLookupTarget('/api/requests-general/12')).toBeNull();
  });
});
