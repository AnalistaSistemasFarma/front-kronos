import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  aggregateSessions,
  aggregateViewCalls,
  completeLines,
  parseAccessLine,
  parseSecurityLine,
  viewCallDetails,
} from '../../../scripts/sap-monitor/slLog.mjs';

const TIMEOUT =
  "[19/Nov/2026:19:59:19 -0500] 192.168.10.11 300006812 \"GET /b1s/v1/view.svc/OLP_IND_VentasB1SLQuery?$filter=Fecha%20ge%20'2026-11-13' HTTP/1.1\" 502 341 ssl=TLSv1.3 t=300s pid=46968 sid=9d33b5f6-e47d-11f1-8000-8c8474d54850 n=.node4 -";
const OK = '[20/Nov/2026:09:29:51 -0500] 192.168.10.5 137099 "GET /b1s/v1/view.svc/IT_SolicitudesB1SLQuery HTTP/1.1" 200 368 ssl=TLSv1.3 t=0s pid=10708 sid=abc n=.node3 +';
const OTHER = '[20/Nov/2026:09:29:56 -0500] 192.168.10.5 91248 "POST /b1s/v1/Logout HTTP/1.1" 204 - ssl=TLSv1.3 t=0s pid=10708 sid=abc n=.node3 +';

describe('parseAccessLine', () => {
  it('parses time (to UTC), IP, microseconds, status and the view name', () => {
    const e = parseAccessLine(TIMEOUT)!;
    expect(e.at.toISOString()).toBe('2026-11-20T00:59:19.000Z');
    expect(e).toMatchObject({ ip: '192.168.10.11', durationMs: 300_007, status: 502, view: 'OLP_IND_VentasB1SLQuery', bytes: 341 });
    expect(parseAccessLine(OTHER)).toMatchObject({ view: null, bytes: 0, status: 204 });
    expect(parseAccessLine('garbage')).toBeNull();
  });
});

describe('aggregateViewCalls', () => {
  it('groups by 5-min bucket, view and IP; counts 502 and >= 290 s as timeouts', () => {
    const rows = aggregateViewCalls([TIMEOUT, TIMEOUT.replace('19:59:19', '19:59:40'), OK, OTHER].map(parseAccessLine));
    const olp = rows.find((r: { view: string }) => r.view === 'OLP_IND_VentasB1SLQuery');
    expect(olp).toMatchObject({ bucketAt: '2026-11-20T00:55:00.000Z', calls: 2, timeouts: 2, errors: 2, sourceIp: '192.168.10.11', company: null });
    expect(rows).toHaveLength(2);
  });
});

describe('Securityevent', () => {
  const lines = [
    '2026-11-20 09:29:33.284000\tSERFARMA07:FARMALOGICA_PROD:ServiceLayer\t192.168.10.5\tLoginSucceed:pid=11056:session=aaaa',
    '2026-11-20 09:40:00.000000\tSERFARMA07:FARMALOGICA_PROD:ServiceLayer\t192.168.10.5\tLoginSucceed:pid=11056:session=bbbb',
    '2026-11-20 09:45:00.000000\tSERFARMA07:FARMALOGICA_PROD:ServiceLayer\t192.168.10.5\tLogoutSucceed:pid=11956:session=aaaa',
    '2026-11-20 09:46:00.000000\tSERFARMA07:ONELATAMPHARMA_PROD:Servicelayer\t192.168.10.11\tSessionRestoreSucceed:pid=1:session=cccc',
  ];
  it('drops the port some lines add to the IP', () => {
    expect(parseSecurityLine('2026-11-20 01:00:00.000000\tS:ABAMIA_PROD:ServiceLayer\t192.168.10.11:58449\tLoginSucceed:pid=1:session=x')!.ip).toBe('192.168.10.11');
  });
  it('parses server local time (-05:00) and counts per hour, IP, company and user', () => {
    const e = parseSecurityLine(lines[0])!;
    expect(e).toMatchObject({ company: 'FARMALOGICA_PROD', user: 'ServiceLayer', ip: '192.168.10.5', event: 'LoginSucceed', pid: 11056 });
    expect(e.at.toISOString()).toBe('2026-11-20T14:29:33.000Z');
    const { sessions } = aggregateSessions(lines.map((l) => parseSecurityLine(l)));
    const farma = sessions.find((s: { company: string }) => s.company === 'FARMALOGICA_PROD');
    expect(farma).toMatchObject({ bucketAt: '2026-11-20T14:00:00.000Z', logins: 2, logouts: 1 });
    expect(sessions.find((s: { company: string }) => s.company === 'ONELATAMPHARMA_PROD')).toMatchObject({ restores: 1 });
  });
});

describe('completeLines', () => {
  it('keeps the trailing partial line for the next run', () => {
    expect(completeLines('a\nb\nc')).toEqual({ lines: ['a', 'b'], consumed: 4 });
    expect(completeLines('partial')).toEqual({ lines: [], consumed: 0 });
  });
});

describe('join access log sid <-> Securityevent session', () => {
  const sid = '9d33b5f6-e47d-11f1-8000-8c8474d54850';
  // The Securityevent `session` is the uppercase hex SHA-256 of the access log sid.
  const session = createHash('sha256').update(sid).digest('hex').toUpperCase();
  const login = `2026-11-19 19:58:00.000000\tSERFARMA07:ONELATAMPHARMA_PROD:ServiceLayer\t192.168.10.11\tLoginSucceed:pid=1:session=${session}`;

  it('labels each view call with company and SL user, plus query and node', () => {
    const { sidWho } = aggregateSessions([parseSecurityLine(login)]);
    const [call] = viewCallDetails([parseAccessLine(TIMEOUT)], sidWho);
    expect(call).toMatchObject({
      at: '2026-11-20T00:59:19.000Z',
      view: 'OLP_IND_VentasB1SLQuery',
      sourceIp: '192.168.10.11',
      status: 502,
      timeout: true,
      query: "$filter=Fecha ge '2026-11-13'",
      node: 'node4',
      company: 'ONELATAMPHARMA_PROD',
      user: 'ServiceLayer',
    });
    expect(aggregateViewCalls([parseAccessLine(TIMEOUT)], sidWho)[0].company).toBe('ONELATAMPHARMA_PROD');
  });

  it('leaves the owner empty when the login is not in the log; a call without query has query null', () => {
    const [call] = viewCallDetails([parseAccessLine(OK)], new Map());
    expect(call).toMatchObject({ company: null, user: null, query: null, node: 'node3', timeout: false });
    expect(viewCallDetails([parseAccessLine(OTHER)])).toHaveLength(0);
  });
});
