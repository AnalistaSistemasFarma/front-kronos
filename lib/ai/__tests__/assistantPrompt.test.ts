import { describe, it, expect } from 'vitest';
import {
  extractAssistantAction,
  stripActionJson,
  buildUserTurn,
  draftFromAction,
  heuristicCreateIntent,
} from '../assistantPrompt';
import {
  normalizeCatalog,
  resolveCompany,
  resolveProcess,
  rankProcessesForQuery,
} from '../assistantCatalog';

describe('assistantPrompt', () => {
  it('arma el turno con contexto de página', () => {
    const turn = buildUserTurn('hola', {
      pathname: '/process/request-general/view-request',
      search: '?id=2073',
      requestId: '2073',
      requestSubject: 'PAGO TC',
    });
    expect(turn).toContain('Solicitud #: 2073');
    expect(turn).toContain('Mensaje del usuario:\nhola');
  });

  it('extrae create_request con ids', () => {
    const text =
      'Te propongo crearla.\n' +
      '{"action":"create_request","companyId":3,"processId":45,"subject":"Pago tarjeta","description":"Legalizar TC corporativa"}';
    expect(extractAssistantAction(text)).toEqual({
      action: 'create_request',
      companyId: 3,
      processId: 45,
      companyName: undefined,
      processName: undefined,
      subject: 'Pago tarjeta',
      description: 'Legalizar TC corporativa',
    });
    expect(stripActionJson(text)).toBe('Te propongo crearla.');
  });

  it('detecta intención de crear', () => {
    expect(heuristicCreateIntent('necesito crear una solicitud de pago')).toBe(
      true,
    );
    expect(heuristicCreateIntent('qué hora es')).toBe(false);
  });

  it('arma draft desde create_request', () => {
    const draft = draftFromAction({
      action: 'create_request',
      companyId: 3,
      processId: 1,
      subject: 'A',
      description: 'Bbbbbbbbbb',
    });
    expect(draft.companyId).toBe(3);
    expect(draft.processId).toBe(1);
  });
});

describe('assistantCatalog', () => {
  const catalog = normalizeCatalog({
    companies: [
      { id_company: 3, company: 'ONELATAMPHARMA' },
      { id_company: 1, company: 'GSS' },
    ],
    processCategories: [
      {
        id_process: 45,
        process: 'PAGO TARJETA CREDITO',
        id_category_request: 9,
        category: 'Tesorería',
        description: 'Legalización de tarjeta',
        active: 1,
      },
      {
        id_process: 99,
        process: 'Vacaciones',
        id_category_request: 2,
        category: 'RRHH',
        description: '',
        active: 0,
      },
    ],
  });

  it('resuelve empresa y proceso por nombre', () => {
    expect(resolveCompany(catalog, { name: 'onelatam' })?.id).toBe(3);
    expect(resolveProcess(catalog, { name: 'pago tarjeta' })?.id).toBe(45);
    expect(resolveProcess(catalog, { id: 99 })).toBeNull(); // inactivo
  });

  it('rankea procesos por query', () => {
    const ranked = rankProcessesForQuery(catalog, 'tarjeta credito', 5);
    expect(ranked[0]?.id).toBe(45);
  });
});
