import { describe, it, expect } from 'vitest';
import {
  detectIntentKind,
  extractAssigneeName,
  extractSubject,
  parseResolveIntent,
  parseUserIntent,
  wantsCreateAction,
} from '../intentParse';
import { extractAssistantAction } from '../assistantPrompt';

describe('intentParse', () => {
  it('detecta caso/ticket vs solicitud', () => {
    expect(
      detectIntentKind(
        'necesito crear un caso, el cual diga, necesito ayuda para mi chatbot',
      ),
    ).toBe('ticket');
    expect(
      detectIntentKind('quiero crear una solicitud de pago de tarjeta'),
    ).toBe('request');
  });

  it('extrae asunto y asignado del mensaje del usuario', () => {
    const msg =
      'necesito crear un caso, el cual diga, necesito ayuda para mi chatbot, y que se asigne a juan fonseca';
    expect(extractAssigneeName(msg)?.toLowerCase()).toContain('juan');
    expect(extractSubject(msg, 'ticket').toLowerCase()).toContain('chatbot');
    const parsed = parseUserIntent(msg);
    expect(parsed.kind).toBe('ticket');
    expect(parsed.wantsCreate || wantsCreateAction(msg)).toBe(true);
  });

  it('parsea resolver solicitud #id con texto', () => {
    const msg =
      'necesito que me ayudes a poner la solicitud #2079 en resuelto y que diga, solucionado';
    const parsed = parseResolveIntent(msg);
    expect(parsed).toMatchObject({
      requestId: 2079,
      kind: 'resolve',
      sendEmail: true,
    });
    expect(parsed?.resolution.toLowerCase()).toContain('solucionado');
    expect(wantsCreateAction(msg)).toBe(false);
  });

  it('parsea cancelar', () => {
    expect(parseResolveIntent('cancela la solicitud 1500 porque duplicada')).toMatchObject({
      requestId: 1500,
      kind: 'cancel',
    });
  });
});

describe('parseWorkspaceQuery', () => {
  it('detecta preguntas de conteo, página y dashboard', async () => {
    const { parseWorkspaceQuery } = await import('../intentParse');
    expect(parseWorkspaceQuery('cuántas solicitudes tengo?')).toBe('requests');
    expect(parseWorkspaceQuery('qué hay en mi dashboard personal')).toBe(
      'dashboard',
    );
    expect(parseWorkspaceQuery('dime que hay en esta pagina')).toBe('page');
    expect(parseWorkspaceQuery('qué hay aquí')).toBe('page');
    expect(parseWorkspaceQuery('cuántos casos tengo abiertos')).toBe('tickets');
    expect(parseWorkspaceQuery('dame un resumen de todo mi espacio')).toBe(
      'all',
    );
    expect(parseWorkspaceQuery('crear una solicitud de pago')).toBeNull();
  });
});

describe('parseHowToIntent', () => {
  it('detecta cómo crear ticket y créamelo', async () => {
    const { parseHowToIntent } = await import('../intentParse');
    expect(parseHowToIntent('ven cómo se crea un ticket')).toMatchObject({
      topic: 'ticket',
      alsoCreate: false,
    });
    expect(
      parseHowToIntent('explícame cómo crear un caso y créamelo'),
    ).toMatchObject({
      topic: 'ticket',
      alsoCreate: true,
    });
  });
});

describe('extractAssistantAction', () => {
  it('parsea create_ticket', () => {
    const raw =
      'Ok\n{"action":"create_ticket","companyId":1,"categoryId":2,"subject":"Ayuda chatbot","description":"Necesito ayuda para mi chatbot"}';
    expect(extractAssistantAction(raw)).toMatchObject({
      action: 'create_ticket',
      subject: 'Ayuda chatbot',
      companyId: 1,
    });
  });

  it('parsea resolve_request', () => {
    const raw =
      '{"action":"resolve_request","requestId":2079,"kind":"resolve","resolution":"solucionado","sendEmail":true}';
    expect(extractAssistantAction(raw)).toMatchObject({
      action: 'resolve_request',
      requestId: 2079,
      kind: 'resolve',
      resolution: 'solucionado',
    });
  });
});
