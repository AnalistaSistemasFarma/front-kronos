import { describe, expect, it } from 'vitest';
import { notificationReplyTarget, replyPlaceholder } from '../replyTarget';
import { replyToNotification, type SqlPoolLike, type SqlTypes } from '../replyToNotification';

describe('notificationReplyTarget', () => {
  it('requests, activities and tickets accept a note', () => {
    expect(notificationReplyTarget('/process/request-general/view-request?id=10&from=general-requests')).toEqual({ kind: 'request', id: 10 });
    expect(notificationReplyTarget('https://prod:8445/process/request-general/view-request?id=10&orionFileId=x')).toEqual({ kind: 'request', id: 10 });
    expect(notificationReplyTarget('/process/request-general/view-activities?id=77&from=assigned-activities')).toEqual({ kind: 'task', id: 77, requestId: null });
    expect(notificationReplyTarget('/process/help-desk/view-ticket?id=5')).toEqual({ kind: 'ticket', id: 5 });
  });

  it('anything else (alerts, SGC, bad ids) → null', () => {
    expect(notificationReplyTarget('/process/system-metrics#alertas')).toBeNull();
    expect(notificationReplyTarget('/process/sgc/documentos?id=3')).toBeNull();
    expect(notificationReplyTarget('/process/help-desk/view-ticket?id=abc')).toBeNull();
    expect(notificationReplyTarget('/process/help-desk/view-ticket?id=0')).toBeNull();
    expect(notificationReplyTarget(null)).toBeNull();
  });

  it('placeholder names the target', () => {
    expect(replyPlaceholder({ kind: 'request', id: 10 })).toBe('Agregar una nota a la solicitud #10…');
  });
});

/** Fake pool: answers each query by a matching regex and records what ran. */
function fakePool(answers: [RegExp, Record<string, unknown>[]][]) {
  const calls: { text: string; inputs: Record<string, unknown> }[] = [];
  const pool: SqlPoolLike = {
    request() {
      const inputs: Record<string, unknown> = {};
      const req = {
        input(name: string, _t: unknown, value: unknown) {
          inputs[name] = value;
          return req;
        },
        async query(text: string) {
          calls.push({ text, inputs });
          const hit = answers.find(([re]) => re.test(text));
          return { recordset: hit ? hit[1] : [] };
        },
      };
      return req;
    },
  };
  return { pool, calls };
}
const SQL: SqlTypes = { Int: 'Int', NVarChar: () => 'NVarChar', Text: 'Text', MAX: 'MAX' };
const USER = { id: 'cuid-session', email: 'Ana@GSSLatam.com ' };

describe('replyToNotification', () => {
  it('adds the note to the request with the SESSION user as author and marks the notification read', async () => {
    const { pool, calls } = fakePool([
      [/FROM notifications/, [{ id: 9, url: '/process/request-general/view-request?id=10' }]],
      [/FROM requests_general/, [{ id: 10 }]],
      [/INSERT INTO notes/, [{ id_note: 501 }]],
    ]);
    const r = await replyToNotification(pool, SQL, USER, 9, '  Ya lo reviso  ');
    expect(r).toEqual({ ok: true, kind: 'request', targetId: 10, noteId: 501 });
    expect(calls[0].inputs).toEqual({ id: 9, email: 'ana@gsslatam.com' });
    const insert = calls.find((c) => c.text.includes('INSERT INTO notes'))!;
    expect(insert.text).toContain('id_request');
    expect(insert.inputs).toEqual({ note: 'Ya lo reviso', target: 10, createdBy: 'cuid-session' });
    expect(calls.at(-1)!.text).toContain('UPDATE notifications SET read_at');
  });

  it('activity → note on the request of that task', async () => {
    const { pool, calls } = fakePool([
      [/FROM notifications/, [{ id: 9, url: '/process/request-general/view-activities?id=77' }]],
      [/FROM task_request_general/, [{ id_request_general: 12 }]],
      [/FROM requests_general/, [{ id: 12 }]],
      [/INSERT INTO notes/, [{ id_note: 502 }]],
    ]);
    expect(await replyToNotification(pool, SQL, USER, 9, 'ok')).toMatchObject({ ok: true, kind: 'request', targetId: 12 });
    expect(calls.find((c) => c.text.includes('INSERT'))!.inputs.target).toBe(12);
  });

  it('ticket → note with id_case', async () => {
    const { pool, calls } = fakePool([
      [/FROM notifications/, [{ id: 9, url: '/process/help-desk/view-ticket?id=5' }]],
      [/FROM \[case\]/, [{ id_case: 5 }]],
      [/INSERT INTO notes/, [{ id_note: 503 }]],
    ]);
    expect(await replyToNotification(pool, SQL, USER, 9, 'ok')).toMatchObject({ ok: true, kind: 'ticket', targetId: 5 });
    expect(calls.find((c) => c.text.includes('INSERT'))!.text).toContain('id_case');
  });

  it("someone else's notification → 404 and nothing written", async () => {
    const { pool, calls } = fakePool([]);
    expect(await replyToNotification(pool, SQL, USER, 9, 'ok')).toMatchObject({ ok: false, status: 404 });
    expect(calls.some((c) => c.text.includes('INSERT'))).toBe(false);
  });

  it('no reply target (alert) → 422; empty or too long text → 400', async () => {
    const { pool } = fakePool([[/FROM notifications/, [{ id: 9, url: '/process/system-metrics#alertas' }]]]);
    expect(await replyToNotification(pool, SQL, USER, 9, 'ok')).toMatchObject({ ok: false, status: 422 });
    expect(await replyToNotification(pool, SQL, USER, 9, '   ')).toMatchObject({ ok: false, status: 400 });
    expect(await replyToNotification(pool, SQL, USER, 9, 'x'.repeat(2001))).toMatchObject({ ok: false, status: 400 });
  });

  it('request that no longer exists → 404', async () => {
    const { pool } = fakePool([[/FROM notifications/, [{ id: 9, url: '/process/request-general/view-request?id=10' }]]]);
    expect(await replyToNotification(pool, SQL, USER, 9, 'ok')).toMatchObject({ ok: false, status: 404 });
  });
});
