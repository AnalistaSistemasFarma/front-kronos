import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildEmailPayload, createSgcMailer, emailServiceUrl, escapeHtml, noopMailer } from '../email';
import { buildIcalendar, escapeIcalText, foldIcalLine, icalTokenHash, isIcalTokenShape, newIcalToken } from '../ical';
import {
  SGC_RELATION_LABELS,
  SGC_RELATION_PHRASES,
  SGC_RELATION_STYLES,
  SGC_RELATION_TYPES,
  filterGraph,
  findNodeByCode,
  initialLayout,
  isSgcRelationType,
  sanitizeLayout,
  type SgcGraphEdge,
  type SgcGraphNode,
} from '../relations';

const m = vi.hoisted(() => ({ runDailySgcJob: vi.fn(), createGeneralRequest: vi.fn() }));
vi.mock('../../prisma', () => ({ prisma: { tag: 'prisma' } }));
vi.mock('../notifications', () => ({ sgcNotifier: 'notifier' }));
vi.mock('../db/reviewAlerts', () => ({ runDailySgcJob: m.runDailySgcJob }));
// lib/scheduler/handlers.js (programador central) importa módulos de SynerLink general: se simulan.
vi.mock('../../requests-general/createGeneralRequest.js', () => ({ createGeneralRequest: m.createGeneralRequest }));
vi.mock('../../notificationEvents.js', () => ({ notifyNewRequest: vi.fn() }));
vi.mock('../../sapsend/treasury.js', () => ({ syncRequestToSapsend: vi.fn() }));

import { runSgcScheduledJob, sgcAlertDeps, summarizeRun } from '../alerts/job';
import { JOB_HANDLERS, JOB_TYPES } from '../../scheduler/handlers.js';

/**
 * Sprint 5 — mapa de relaciones (filtros, búsqueda por código, diseño),
 * enlace iCal privado (RFC 5545), correo de los avisos y registro del job en
 * el programador central.
 */

const node = (p: Partial<SgcGraphNode>): SgcGraphNode => ({
  id: 1, code: 'OLP-GC-PR-001', title: 'Control de documentos', versionNumber: 1, status: 'vigente', idProcessType: 1, processTypeCode: 'M', processType: 'Misionales', processTypeColor: 'blue',
  idProcess: 10, process: 'GC · Gestión de calidad', idDepartment: 3, idDocumentType: 5, documentTypeCode: 'PR', ...p,
});

describe('SGC · S5 · mapa de relaciones', () => {
  const nodes = [
    node({}),
    node({ id: 2, code: 'OLP-GC-FO-001', idDocumentType: 6, documentTypeCode: 'FO' }),
    node({ id: 3, code: 'OLP-PR-IN-001', idProcessType: 2, processType: 'Soporte', idProcess: 20, process: 'PR · Producción', idDepartment: 9, status: 'obsoleto' }),
    node({ id: 4, code: 'OLP-GC-AN-001', idDocumentType: 7 }),
  ];
  const edges: SgcGraphEdge[] = [
    { id: 1, source: 2, target: 1, type: 'formato', note: null },
    { id: 2, source: 1, target: 3, type: 'referencia', note: 'ver' },
  ];

  it('[SGC-REQ-071] cuatro tipos de relación, cada uno con su color, trazo y frase', () => {
    expect(SGC_RELATION_TYPES).toEqual(['procedimiento_padre', 'formato', 'anexo', 'referencia']);
    for (const t of SGC_RELATION_TYPES) {
      expect(SGC_RELATION_LABELS[t]).toBeTruthy();
      expect(SGC_RELATION_PHRASES[t].out).toBeTruthy();
      expect(SGC_RELATION_STYLES[t].color).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(new Set(SGC_RELATION_TYPES.map((t) => SGC_RELATION_STYLES[t].color)).size).toBe(4);
    expect(isSgcRelationType('anexo')).toBe(true);
    expect(isSgcRelationType('modulo_de_proceso')).toBe(false);
  });

  it('[SGC-REQ-072] filtros por tipo de proceso, proceso, área, tipo documental, tipo de relación y estado; las aristas solo con sus DOS extremos', () => {
    expect(filterGraph(nodes, edges, {}).edges).toHaveLength(2);
    const soloGC = filterGraph(nodes, edges, { idProcess: 10 });
    expect(soloGC.nodes.map((n) => n.id)).toEqual([1, 2, 4]);
    expect(soloGC.edges.map((e) => e.id)).toEqual([1]);
    expect(filterGraph(nodes, edges, { idProcessType: 2 }).nodes.map((n) => n.id)).toEqual([3]);
    expect(filterGraph(nodes, edges, { idDepartment: 9 }).nodes.map((n) => n.id)).toEqual([3]);
    expect(filterGraph(nodes, edges, { idDocumentType: 6 }).nodes.map((n) => n.id)).toEqual([2]);
    expect(filterGraph(nodes, edges, { relationTypes: ['referencia'] }).edges.map((e) => e.id)).toEqual([2]);
    expect(filterGraph(nodes, edges, { statuses: ['vigente'] }).nodes.map((n) => n.id)).toEqual([1, 2, 4]);
    expect(filterGraph(nodes, edges, { onlyConnected: true }).nodes.map((n) => n.id)).toEqual([1, 2, 3]);
  });

  it('[SGC-REQ-072] búsqueda por código: exacto, luego prefijo, luego contenido', () => {
    expect(findNodeByCode(nodes, 'olp-gc-fo-001')?.id).toBe(2);
    expect(findNodeByCode(nodes, 'OLP-PR')?.id).toBe(3);
    expect(findNodeByCode(nodes, 'AN-001')?.id).toBe(4);
    expect(findNodeByCode(nodes, '  ')).toBeNull();
    expect(findNodeByCode(nodes, 'ZZZ')).toBeNull();
  });

  it('[SGC-REQ-073] diseño: columna por tipo de proceso; las posiciones guardadas mandan; se valida lo que se guarda', () => {
    const lay = initialLayout(nodes, { '4': { x: 999, y: 5 } }, [2, 1]);
    expect(lay['3']).toEqual({ x: 0, y: 0 });
    expect(lay['1'].x).toBe(340);
    expect(lay['4']).toEqual({ x: 999, y: 5 });
    expect(initialLayout(nodes)['3'].x).toBe(340);
    expect(sanitizeLayout({ '1': { x: 1.4, y: -2.6 } })).toEqual({ '1': { x: 1, y: -3 } });
    expect(sanitizeLayout(null)).toBeNull();
    expect(sanitizeLayout([])).toBeNull();
    expect(sanitizeLayout({ abc: { x: 1, y: 1 } })).toBeNull();
    expect(sanitizeLayout({ '1': 'x' })).toBeNull();
    expect(sanitizeLayout({ '1': { x: Infinity, y: 0 } })).toBeNull();
    expect(sanitizeLayout({ '1': { x: 2e6, y: 0 } })).toBeNull();
    expect(sanitizeLayout(Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [String(i), { x: 0, y: 0 }])))).toBeNull();
  });
});

describe('SGC · S5 · iCal privado', () => {
  it('[SGC-REQ-076] el token es aleatorio de 32 bytes; en la base solo su SHA-256', () => {
    const a = newIcalToken();
    const b = newIcalToken();
    expect(a).not.toBe(b);
    expect(isIcalTokenShape(a)).toBe(true);
    expect(isIcalTokenShape('corto')).toBe(false);
    expect(isIcalTokenShape(`${a.slice(0, 42)}/`)).toBe(false);
    expect(icalTokenHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(icalTokenHash(a)).not.toContain(a);
  });

  it('[SGC-REQ-076] calendario RFC 5545: eventos de día completo con escape y plegado de líneas', () => {
    const ics = buildIcalendar(
      [{ uid: 'sgc-3-doc1-v1@synerlink', date: '2026-12-31', summary: 'Vence revisión: OLP-GC-PR-001 V1 · Control, de; documentos', description: 'Línea 1\nLínea 2 '.repeat(8), url: 'https://synerlink/x' }],
      { calendarName: 'SGC · vencimientos', now: new Date('2026-10-01T12:00:00.123Z') }
    );
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261231\r\n');
    expect(ics).toContain('DTEND;VALUE=DATE:20270101\r\n');
    expect(ics).toContain('DTSTAMP:20261001T120000Z');
    expect(ics).toContain('Control\\, de\\; documentos');
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    expect(escapeIcalText('a\\b\r\nc')).toBe('a\\\\b\\nc');
    expect(foldIcalLine('corta')).toBe('corta');
    expect(foldIcalLine('ñ'.repeat(50)).split('\r\n ').every((l) => Buffer.byteLength(l, 'utf8') <= 75)).toBe(true);
  });
});

describe('SGC · S5 · correo de los avisos', () => {
  beforeEach(() => vi.clearAllMocks());

  it('[SGC-REQ-070] arma el mensaje del servicio de correo compartido con HTML escapado', () => {
    const p = buildEmailPayload({ to: 'a@x.co', title: 'Documento vence hoy', rows: [{ label: 'Título', value: '<script>x</script> & "y"' }], outro: 'Abra la ficha' }, 'sgc@x.co');
    expect(p).toMatchObject({ userEmail: 'a@x.co', title: 'Documento vence hoy', from: 'GSS LATAM <sgc@x.co>', fromEmail: 'sgc@x.co' });
    expect(p.table).toContain('&lt;script&gt;x&lt;/script&gt; &amp; &quot;y&quot;');
    expect(escapeHtml("'")).toBe('&#39;');
    expect(emailServiceUrl('https://correo.x/ ')).toBe('https://correo.x/sapsend/sendMessage');
    expect(buildEmailPayload({ to: 'a@x.co', title: 't', rows: [], outro: '' }).fromEmail).toBe('notificador@gsslatam.com');
  });

  it('[SGC-REQ-070] entrega por destinatario y nunca rompe el aviso (sin servicio, error HTTP o de red)', async () => {
    const msg = (to: string) => ({ to, title: 't', rows: [], outro: '' });
    expect(await createSgcMailer({}, vi.fn())([msg('a@x.co')])).toEqual([{ to: 'a@x.co', ok: false, error: expect.stringContaining('API_EMAIL') }]);
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, status: 200 }).mockResolvedValueOnce({ ok: false, status: 502 }).mockRejectedValueOnce(new Error('ECONNRESET')).mockRejectedValueOnce('raro');
    const res = await createSgcMailer({ API_EMAIL: 'https://correo.x', SGC_EMAIL_FROM: 'sgc@x.co' }, fetcher)([msg('a@x.co'), msg('b@x.co'), msg('c@x.co'), msg('d@x.co')]);
    expect(res).toEqual([
      { to: 'a@x.co', ok: true },
      { to: 'b@x.co', ok: false, error: 'El servicio de correo respondió 502.' },
      { to: 'c@x.co', ok: false, error: 'ECONNRESET' },
      { to: 'd@x.co', ok: false, error: 'Error de red' },
    ]);
    expect(fetcher.mock.calls[0][0]).toBe('https://correo.x/sapsend/sendMessage');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ userEmail: 'a@x.co', fromEmail: 'sgc@x.co' });
    expect(await noopMailer([msg('a@x.co')])).toEqual([{ to: 'a@x.co', ok: true }]);
  });
});

describe('SGC · S5 · job del programador central', () => {
  it('[SGC-REQ-074] el programador central registra el job `sgc_review_alerts` y delega en el SGC (avisos + recordatorios de lectura)', async () => {
    expect(JOB_TYPES).toContain('sgc_review_alerts');
    expect(JOB_TYPES).toContain('create_general_request');
    const summary = { runDate: '2026-10-01', companies: 1, documents: 2, sent: 2, omitted: 1, notified: 6, emails: 5, emailErrors: 1, readingReminders: 3 };
    m.runDailySgcJob.mockResolvedValue(summary);
    const out = await (JOB_HANDLERS as unknown as Record<string, (p: unknown) => Promise<{ ref: string; detail: string }>>).sgc_review_alerts({ company: 3 });
    expect(out.ref).toBe('2026-10-01');
    expect(out.detail).toBe(summarizeRun(summary));
    expect(out.detail).toContain('2 aviso(s) de vencimiento, 1 omitido(s)');
    expect(m.runDailySgcJob).toHaveBeenCalledWith({ tag: 'prisma' }, expect.objectContaining({ notifier: 'notifier' }), { idCompany: 3, source: 'programador' });
    await runSgcScheduledJob(null, { notifier: vi.fn(), mailer: noopMailer, appUrl: 'x' });
    expect(m.runDailySgcJob).toHaveBeenLastCalledWith({ tag: 'prisma' }, expect.anything(), { idCompany: null, source: 'programador' });
    const prev = process.env.NEXTAUTH_URL;
    process.env.NEXTAUTH_URL = 'https://synerlink.pruebas';
    expect(sgcAlertDeps().appUrl).toBe('https://synerlink.pruebas');
    delete process.env.NEXTAUTH_URL;
    expect(sgcAlertDeps().appUrl).toBe('https://synerlink');
    if (prev !== undefined) process.env.NEXTAUTH_URL = prev;
  });
});
