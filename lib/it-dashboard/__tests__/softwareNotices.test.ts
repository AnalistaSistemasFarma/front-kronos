import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ queryRaw: vi.fn(), executeRaw: vi.fn() }));
vi.mock('../../prisma', () => ({ prisma: { $queryRaw: m.queryRaw, $executeRaw: m.executeRaw } }));

import { needsExpiryNotice, parseEmailList, validateSoftwareInput } from '../software';
import { buildExpiryMessages, runSoftwareExpiryJob } from '../softwareExpiryJob';

const TODAY = '2026-11-27';

describe('notification e-mails and type «dominio»', () => {
  it('parses, de-duplicates and validates e-mails; needs an expiration date', () => {
    expect(parseEmailList('A@x.com; b@y.co, a@x.com')).toEqual(['a@x.com', 'b@y.co']);
    const ok = validateSoftwareInput({
      companyId: 8,
      kind: 'dominio',
      description: 'gsslatam.com',
      expirationDate: '2027-01-10',
      notifyEmails: ['ti@gsslatam.com', 'Cristian.Baldion@gsslatam.com'],
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.notifyEmails).toEqual(['ti@gsslatam.com', 'cristian.baldion@gsslatam.com']);

    const bad = validateSoftwareInput({ companyId: 8, kind: 'dominio', description: 'x', expirationDate: '2027-01-10', notifyEmails: ['nope'] });
    expect(bad.ok).toBe(false);
    const withPlatform = validateSoftwareInput({ companyId: 8, kind: 'software', description: 'x', platformEmail: ' Licencias@GSSlatam.com ' });
    expect(withPlatform.ok && withPlatform.value.platformEmail).toBe('licencias@gsslatam.com');
    expect(validateSoftwareInput({ companyId: 8, kind: 'software', description: 'x', platformEmail: 'nope' }).ok).toBe(false);

    const noDate = validateSoftwareInput({ companyId: 8, kind: 'software', description: 'x', notifyEmails: ['a@b.co'] });
    expect(noDate.ok).toBe(false);
  });

  it('needsExpiryNotice: within 5 days, not expired, once per expiration date', () => {
    const base = { notifyEmails: ['a@b.co'], noticeSentFor: null };
    expect(needsExpiryNotice({ ...base, expirationDate: '2026-12-02' }, TODAY)).toBe(true); // 5 days
    expect(needsExpiryNotice({ ...base, expirationDate: '2026-12-03' }, TODAY)).toBe(false); // 6 days
    expect(needsExpiryNotice({ ...base, expirationDate: '2026-11-27' }, TODAY)).toBe(true); // today
    expect(needsExpiryNotice({ ...base, expirationDate: '2026-11-26' }, TODAY)).toBe(false); // expired
    expect(needsExpiryNotice({ ...base, expirationDate: '2026-12-01', noticeSentFor: '2026-12-01' }, TODAY)).toBe(false);
    expect(needsExpiryNotice({ ...base, expirationDate: '2026-12-01', noticeSentFor: '2025-12-01' }, TODAY)).toBe(true);
    expect(needsExpiryNotice({ notifyEmails: [], noticeSentFor: null, expirationDate: '2026-12-01' }, TODAY)).toBe(false);
  });
});

const row = {
  id: 7,
  company: 'GSS',
  kind: 'certificado',
  description: 'SSL *.gsslatam.com',
  provider: 'Sectigo',
  expirationDate: new Date('2026-12-02T00:00:00Z'),
  licenses: 1,
  assignedTo: 'Servidor web',
  licenseType: 'anual',
  notifyEmails: 'ti@gsslatam.com, cristian.baldion@gsslatam.com',
  noticeSentFor: null,
};

describe('runSoftwareExpiryJob', () => {
  beforeEach(() => {
    m.queryRaw.mockReset();
    m.executeRaw.mockReset();
  });

  it('builds one message per recipient with the item data', () => {
    const msgs = buildExpiryMessages(row, TODAY);
    expect(msgs.map((x) => x.to)).toEqual(['ti@gsslatam.com', 'cristian.baldion@gsslatam.com']);
    expect(msgs[0].title).toContain('Certificado por vencer: SSL *.gsslatam.com (vence en 5 días)');
    expect(msgs[0].rows.find((r) => r.label === 'Proveedor')?.value).toBe('Sectigo');
  });

  it('sends, marks as notified, and skips excluded / already notified items', async () => {
    m.queryRaw.mockResolvedValue([
      row,
      { ...row, id: 8, noticeSentFor: new Date('2026-12-02T00:00:00Z') },
      { ...row, id: 9, company: 'PRUEBAS' },
    ]);
    const mailer = vi.fn(async (msgs: Array<{ to: string }>) => msgs.map((x) => ({ to: x.to, ok: true as const })));
    const out = await runSoftwareExpiryJob(mailer, TODAY);
    expect(mailer).toHaveBeenCalledTimes(1);
    expect(m.executeRaw).toHaveBeenCalledTimes(1);
    expect(out.detail).toContain('Correos enviados: 2');
  });

  it('does not mark the item when every e-mail failed (retried next day)', async () => {
    m.queryRaw.mockResolvedValue([row]);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const mailer = vi.fn(async (msgs: Array<{ to: string }>) => msgs.map((x) => ({ to: x.to, ok: false as const, error: 'down' })));
    const out = await runSoftwareExpiryJob(mailer, TODAY);
    expect(m.executeRaw).not.toHaveBeenCalled();
    expect(out.detail).toContain('Fallidos: 2');
  });
});
