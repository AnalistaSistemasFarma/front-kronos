import { describe, expect, it, vi } from 'vitest';
import { SGC_AUDIT_ACTIONS, auditOrigin, buildAuditRow, writeSgcAudit } from '../audit';
import { readClientOrigin, stripPort } from '../clientOrigin';

const req = (headers: Record<string, string>) => new Request('http://x/api/sgc', { headers });

describe('SGC · auditoría', () => {
  it('[SGC-REQ-019] la IP se guarda sin el puerto que agrega IIS/ARR', () => {
    expect(stripPort('192.168.10.20:54321')).toBe('192.168.10.20');
    expect(stripPort('[2001:db8::1]:443')).toBe('2001:db8::1');
    expect(stripPort('2001:db8::1')).toBe('2001:db8::1');
    expect(stripPort('  ')).toBe('');
    expect(readClientOrigin(req({ 'x-forwarded-for': '10.0.0.5:1234, 10.0.0.1', 'user-agent': 'Mozilla' }))).toEqual({ clientIp: '10.0.0.5', userAgent: 'Mozilla' });
  });

  it('[SGC-REQ-019] sin x-forwarded-for usa otras cabeceras de proxy, y si no hay nada queda null (no se inventa)', () => {
    expect(readClientOrigin(req({ 'x-real-ip': '10.1.1.1' })).clientIp).toBe('10.1.1.1');
    expect(readClientOrigin(req({ 'x-real-ip': ' ', 'cf-connecting-ip': '10.2.2.2' })).clientIp).toBe('10.2.2.2');
    expect(auditOrigin(req({}))).toEqual({ ip: null, userAgent: null });
  });

  it('[SGC-REQ-019] la fila guarda quién, qué, sobre qué, desde dónde y el antes/después en JSON', () => {
    const row = buildAuditRow({
      idCompany: 3,
      actorEmail: 'calidad@onelatampharma.com',
      action: SGC_AUDIT_ACTIONS.documentoEdicion,
      entity: 'document',
      entityId: 12,
      before: { title: 'A', n: BigInt(1) },
      after: { title: 'B' },
      detail: 'x'.repeat(1500),
      ip: '10.0.0.5',
      userAgent: 'Mozilla',
    });
    expect(row).toMatchObject({ id_company: 3, action: 'documento.edicion', entity: 'document', entity_id: '12', ip: '10.0.0.5' });
    expect(row.before_json).toBe('{"title":"A","n":"1"}');
    expect(row.after_json).toBe('{"title":"B"}');
    expect(row.detail).toHaveLength(1000);
    const bare = buildAuditRow({ idCompany: null, actorEmail: null, action: SGC_AUDIT_ACTIONS.accesoDenegado, entity: 'document_version' });
    expect(bare).toMatchObject({ entity_id: null, before_json: null, after_json: null, detail: null, ip: null, user_agent: null });
  });

  it('[SGC-REQ-019] escribe la entrada en sgc.audit_log', async () => {
    const create = vi.fn().mockResolvedValue({});
    await writeSgcAudit({ sgcAuditLog: { create } } as never, { idCompany: 3, actorEmail: 'a@b.co', action: SGC_AUDIT_ACTIONS.documentoConsulta, entity: 'document_version', entityId: 1 });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'documento.consulta', entity_id: '1' }) });
  });
});
