import { describe, expect, it } from 'vitest';
import { SGC_RATE_RULES, SgcRateLimiter, bodyTooLarge, checkSgcRate } from '../rateLimit';
import { SGC_MAX_EXCEPTIONAL_DAYS, getGrantInputError } from '../documentAccess';
import { auditReportToCsv, type SgcDocumentAuditReport } from '../db/auditReport';
import { computeRecordHash as computeRecordHashTs, verifySignatureChain as verifyChainTs, type SgcSignatureRow } from '../signature/record';
import {
  SGC_SCHEMA_MIGRATIONS,
  computeRecordHash as computeRecordHashMjs,
  denormalizeValue,
  diffStructures,
  mssqlConfigFromUrl,
  normalizeRow,
  payloadFromRow as payloadFromRowMjs,
  rewriteSchema,
  tableDigest,
  topologicalOrder,
  verifyAllChains,
  verifySignatureChain as verifyChainMjs,
} from '../../../scripts/sgc/respaldo/lib.mjs';
import { payloadFromRow as payloadFromRowTs } from '../signature/record';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Sprint 6 — endurecimiento (pruebas puras): límite de tasa, cuerpo máximo,
 * permisos excepcionales con tope, CSV sin fórmulas, y las piezas del
 * procedimiento de respaldo/restauración (scripts/sgc/respaldo), incluida la
 * EQUIVALENCIA exacta de su verificación de la cadena de firmas con la del
 * sistema (lib/sgc/signature/record.ts).
 */

describe('SGC · S6 · límite de tasa y cuerpo máximo', () => {
  it('[SGC-REQ-080] la ventana deslizante deja pasar hasta el máximo y responde con el tiempo de espera', () => {
    const rl = new SgcRateLimiter();
    const rule = { max: 3, windowMs: 1000 };
    expect([0, 10, 20].map((t) => rl.check('a', rule, t).allowed)).toEqual([true, true, true]);
    const blocked = rl.check('a', rule, 30);
    expect(blocked).toEqual({ allowed: false, retryAfterSeconds: 1 });
    expect(rl.check('b', rule, 30).allowed).toBe(true); // otra persona no se ve afectada
    expect(rl.check('a', rule, 1001).allowed).toBe(true); // la primera salió de la ventana
  });

  it('[SGC-REQ-080] el limitador acota su memoria y las reglas cubren las rutas caras o enumerables', () => {
    const rl = new SgcRateLimiter(5);
    for (let i = 0; i < 20; i++) rl.check(`k${i}`, { max: 10, windowMs: 1000 }, i);
    expect(rl.size()).toBeLessThanOrEqual(5);
    rl.prune(10_000_000, 1000);
    expect(rl.size()).toBe(0);
    expect(Object.keys(SGC_RATE_RULES).sort()).toEqual(['archivo', 'ical', 'solicitudAcceso', 'verificacion']);
    const who = `s6-${Date.now()}@x.co`;
    for (let i = 0; i < SGC_RATE_RULES.solicitudAcceso.max; i++) expect(checkSgcRate('solicitudAcceso', who, 1000 + i).allowed).toBe(true);
    expect(checkSgcRate('solicitudAcceso', who.toUpperCase(), 2000).allowed).toBe(false); // sin distinguir mayúsculas
  });

  it('[SGC-REQ-081] un cuerpo declarado mayor de 26 MB (o inválido) se rechaza antes de leerlo', () => {
    expect(bodyTooLarge(null)).toBe(false);
    expect(bodyTooLarge('')).toBe(false);
    expect(bodyTooLarge('1024')).toBe(false);
    expect(bodyTooLarge(String(26 * 1024 * 1024))).toBe(false);
    expect(bodyTooLarge(String(26 * 1024 * 1024 + 1))).toBe(true);
    expect(bodyTooLarge('abc')).toBe(true);
    expect(bodyTooLarge('-5')).toBe(true);
  });
});

describe('SGC · S6 · permisos excepcionales y CSV de auditoría', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const base = { idDepartment: null, userEmail: 'ana@x.co', canView: true, canDownload: true, canPrint: false, reason: 'Visita del INVIMA programada' };

  it('[SGC-REQ-084] la descarga o impresión excepcional no puede durar más de un año', () => {
    const ok = new Date(now.getTime() + 30 * 86_400_000);
    const tooLong = new Date(now.getTime() + (SGC_MAX_EXCEPTIONAL_DAYS + 1) * 86_400_000);
    expect(getGrantInputError({ ...base, expiresAt: ok }, now)).toBeNull();
    expect(getGrantInputError({ ...base, expiresAt: tooLong }, now)).toMatch(/no puede pasar de 366 días/);
    // Un acceso de solo consulta puede durar más (o no vencer).
    expect(getGrantInputError({ ...base, canDownload: false, expiresAt: tooLong }, now)).toBeNull();
  });

  it('[SGC-REQ-082] el CSV del reporte de auditoría neutraliza las fórmulas que escriben las personas', () => {
    const report = {
      events: [
        { at: '2026-10-01T00:00:00Z', actor: 'a@x.co', action: 'nota', entity: 'request', entityId: '1', ip: '10.0.0.1', detail: '=HYPERLINK("http://malo","clic")', after: '+cmd|calc' },
        { at: '2026-10-01T00:00:01Z', actor: 'b@x.co', action: 'nota', entity: 'request', entityId: '2', ip: null, detail: '@SUM(A1)', after: '-2+3' },
        { at: '2026-10-01T00:00:02Z', actor: 'c@x.co', action: 'nota', entity: 'request', entityId: '3', ip: null, detail: 'texto normal "con comillas"\ny salto', after: null },
      ],
    } as unknown as SgcDocumentAuditReport;
    const csv = auditReportToCsv(report);
    expect(csv).toContain(`"'=HYPERLINK(""http://malo"",""clic"")"`);
    expect(csv).toContain(`"'+cmd|calc"`);
    expect(csv).toContain(`"'@SUM(A1)"`);
    expect(csv).toContain(`"'-2+3"`);
    expect(csv).toContain(`"texto normal ""con comillas"" y salto"`);
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(4);
  });
});

describe('SGC · S6 · cabeceras de seguridad de las rutas del SGC', () => {
  it('[SGC-REQ-092] next.config agrega nosniff, SAMEORIGIN, Referrer-Policy y Permissions-Policy SOLO a /process/sgc-documental y /api/sgc', async () => {
    const mod = await import('../../../next.config');
    const cfg = await (mod.default as (phase: string) => Promise<{ headers?: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> }>)('phase-development-server');
    const rules = await cfg.headers!();
    expect(rules.map((r) => r.source)).toEqual(['/process/sgc-documental/:path*', '/api/sgc/:path*']);
    for (const r of rules) {
      const h = Object.fromEntries(r.headers.map((x) => [x.key, x.value]));
      expect(h).toMatchObject({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'same-origin' });
      expect(h['Permissions-Policy']).toContain('camera=()');
    }
  });
});

// ---------------------------------------------------------------------------
// Respaldo y restauración lógica del esquema sgc (scripts/sgc/respaldo)
// ---------------------------------------------------------------------------

const row = (over: Partial<SgcSignatureRow> = {}): SgcSignatureRow => ({
  signature_uid: '11111111-1111-4111-8111-111111111111',
  id_company: 3,
  id_request: 7,
  id_task: 9,
  id_task_assignee: 11,
  signer_email: 'ana@x.co',
  signer_name: 'Ana',
  meaning: 'aprobo',
  reason: 'Apruebo el documento',
  signed_at: new Date('2026-10-01T15:04:05.123Z'),
  content_kind: 'borrador_editor',
  content_ref: 'revision:4',
  content_name: 'Borrador',
  content_sha256: 'a'.repeat(64),
  auth_method: 'contrasena_synerlink',
  consent_version: 'sgc-co-ley527-d2364-v1',
  master_sha256: null,
  ip: '10.0.0.5',
  user_agent: 'vitest',
  evidence_sha256: 'b'.repeat(64),
  prev_record_hash: null,
  record_hash: '',
  ...over,
});

function chainOf(n: number, idCompany = 3, firstId = 1): (SgcSignatureRow & { id_signature: number })[] {
  const out: (SgcSignatureRow & { id_signature: number })[] = [];
  let prev: string | null = null;
  for (let i = 0; i < n; i++) {
    const r = row({ signature_uid: `0000000${i}-1111-4111-8111-111111111111`, prev_record_hash: prev, id_task: 9 + i, reason: `Motivo ${i}`, signer_name: i % 2 ? null : 'Ana', id_company: idCompany });
    r.record_hash = computeRecordHashTs(payloadFromRowTs(r), r.evidence_sha256, prev);
    prev = r.record_hash;
    out.push({ ...r, id_signature: firstId + i });
  }
  return out;
}

describe('SGC · S6 · respaldo y restauración (piezas puras)', () => {
  it('[SGC-REQ-090] la verificación de la cadena del respaldo es IDÉNTICA a la del sistema (íntegra, alterada y rota)', () => {
    const chain = chainOf(5);
    expect(payloadFromRowMjs(chain[0])).toEqual(payloadFromRowTs(chain[0]));
    expect(computeRecordHashMjs(payloadFromRowMjs(chain[1]), chain[1].evidence_sha256, chain[1].prev_record_hash)).toBe(chain[1].record_hash);
    expect(verifyChainMjs(chain)).toEqual(verifyChainTs(chain));
    expect(verifyChainMjs(chain).ok).toBe(true);
    // Fecha como texto ISO de la base (sin zona y con 7 decimales, así la lee el respaldo) da el mismo resultado.
    expect(verifyChainMjs(chain.map((r) => ({ ...r, signed_at: r.signed_at.toISOString().replace('Z', '0000') })))).toEqual(verifyChainTs(chain));
    const altered = chain.map((r, i) => (i === 2 ? { ...r, reason: 'Motivo cambiado' } : r));
    expect(verifyChainMjs(altered)).toEqual(verifyChainTs(altered));
    expect(verifyChainMjs(altered).ok).toBe(false);
    const missing = chain.filter((_, i) => i !== 2);
    expect(verifyChainMjs(missing)).toEqual(verifyChainTs(missing));
    expect(verifyChainMjs(missing).problem).toMatch(/rota/);
    const two = verifyAllChains([...chain, ...chainOf(2, 10, 101)]);
    expect(two.map((c) => [c.idCompany, c.ok, c.checked])).toEqual([[3, true, 5], [10, true, 2]]);
  });

  it('[SGC-REQ-090] la restauración reescribe el esquema sin tocar dbo ni nombres que contienen «sgc_»', () => {
    const sql = `IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'sgc') EXEC('CREATE SCHEMA [sgc]');
CREATE TABLE [sgc].[document] (x INT); ALTER TABLE sgc.document ADD CONSTRAINT fk FOREIGN KEY (d) REFERENCES [dbo].[department]([id_department]);
INSERT INTO dbo.scheduled_job (name) VALUES (N'sgc_review_alerts'); SELECT OBJECT_ID(N'[sgc].[audit_log]');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'document_status_ck') ALTER TABLE [sgc].[document] ADD CONSTRAINT [document_status_ck] CHECK (1=1);`;
    const out = rewriteSchema(sql, 'sgc_rst');
    expect(out).toContain(`name = N'sgc_rst'`);
    expect(out).toContain('CREATE SCHEMA [sgc_rst]');
    expect(out).toContain('CREATE TABLE [sgc_rst].[document]');
    expect(out).toContain('ALTER TABLE sgc_rst.document');
    expect(out).toContain('REFERENCES [dbo].[department]');
    expect(out).toContain(`N'sgc_review_alerts'`);
    expect(out).toContain(`OBJECT_ID(N'[sgc_rst].[audit_log]')`);
    expect(out).toContain(`WHERE name = N'document_status_ck' AND SCHEMA_NAME(schema_id) = N'sgc_rst'`);
    expect(rewriteSchema(sql, 'sgc')).toBe(sql);
    expect(() => rewriteSchema(sql, 'sgc; DROP TABLE x')).toThrow(/no válido/);
  });

  it('[SGC-REQ-090] orden de inserción por claves foráneas, huella estable por tabla y valores que vuelven iguales', () => {
    expect(topologicalOrder(['task', 'request', 'company_config', 'task_assignee'], [
      { child: 'request', parent: 'company_config' },
      { child: 'task', parent: 'request' },
      { child: 'task_assignee', parent: 'task' },
      { child: 'task', parent: 'task' },
    ])).toEqual(['company_config', 'request', 'task', 'task_assignee']);
    expect(() => topologicalOrder(['a', 'b'], [{ child: 'a', parent: 'b' }, { child: 'b', parent: 'a' }])).toThrow(/Ciclo/);
    const cols = ['id', 'at', 'blob', 'big', 'txt'];
    const r1 = normalizeRow({ id: 1, at: new Date('2026-10-01T00:00:00.000Z'), blob: Buffer.from('hola'), big: BigInt("9007199254740993"), txt: null }, cols);
    expect(r1).toEqual({ id: 1, at: '2026-10-01T00:00:00.000Z', blob: { $b64: 'aG9sYQ==' }, big: '9007199254740993', txt: null });
    expect(tableDigest([r1])).toBe(tableDigest([JSON.parse(JSON.stringify(r1))]));
    expect(tableDigest([r1])).not.toBe(tableDigest([{ ...r1, txt: '' }]));
    expect(denormalizeValue({ $b64: 'aG9sYQ==' }, { type: 'nvarchar' })).toEqual(Buffer.from('hola'));
    expect(denormalizeValue('2026-10-01T00:00:00.1234567', { type: 'datetime2' })).toBe('2026-10-01T00:00:00.1234567');
    expect(denormalizeValue(null, { type: 'int' })).toBeNull();
  });

  it('[SGC-REQ-090] la cadena de conexión se convierte sin exponerla y la comparación de estructura detecta diferencias', () => {
    const cfg = mssqlConfigFromUrl('sqlserver://10.0.0.3:1433;database=KRONOSDB_PRUEBAS;user=u;password={p;w};encrypt=true;trustServerCertificate=true');
    expect(cfg).toMatchObject({ server: '10.0.0.3', port: 1433, database: 'KRONOSDB_PRUEBAS', user: 'u', options: { encrypt: true, useUTC: true } });
    expect(() => mssqlConfigFromUrl('postgres://x')).toThrow(/sqlserver/);
    const a = { columns: [{ tbl: 't', col: 'a' }], indexes: [], checks: [], foreignKeys: [], triggers: [{ tbl: 't', trg: 'x', dis: false }] };
    expect(diffStructures(a, JSON.parse(JSON.stringify(a)))).toEqual([]);
    const b = { ...a, triggers: [{ tbl: 't', trg: 'x', dis: true }] };
    expect(diffStructures(a, b).map((d) => [d.kind, d.only])).toEqual([['triggers', 'origen'], ['triggers', 'copia']]);
  });

  it('[SGC-REQ-090] la lista de migraciones del respaldo coincide con las migraciones del esquema sgc del repositorio', () => {
    const dir = path.join(process.cwd(), 'prisma/migrations');
    const repo = fs.readdirSync(dir).filter((d) => /_sgc_/.test(d) && !/retiro/.test(d)).sort();
    expect(SGC_SCHEMA_MIGRATIONS).toEqual(repo);
  });
});
