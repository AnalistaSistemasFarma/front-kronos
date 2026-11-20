// Pure parsers/aggregators for the SAP Business One Service Layer logs (used by collector.mjs and
// unit tested in lib/sap-monitor/__tests__/slLog.test.ts). No I/O here.
//
// Access log of the load balancer (conf/httpd-b1s-lb.conf):
//   LogFormat "%t %h %D \"%r\" %>s %b ssl=%{SSL_PROTOCOL}x t=%Ts pid=%P sid=%{B1SESSION}C n=%{ROUTEID}C %X"
//   [20/Nov/2026:09:29:51 -0500] 192.168.10.5 137099 "PATCH /b1s/v1/Drafts(96398) HTTP/1.1" 204 - ssl=TLSv1.3 t=0s pid=10708 sid=… n=.node3 +
//   (%D = microseconds)
// Security event log (logs/Securityevent.YYYYMMDD.b1s.log), tab separated, server local time:
//   2026-11-20 09:29:33.284000	SERFARMA07:FARMALOGICA_PROD:ServiceLayer	192.168.10.5	LoginSucceed:pid=11056:session=…
//
// Join between both logs (verified 2026-11-20 on serfarma07): the Securityevent `session` is the
// uppercase hex SHA-256 of the access log `sid` (the B1SESSION cookie, a UUID). So
// sessionKey(sid) === session.slice(0, 16).toLowerCase() gives company + SL user of each call.

import { createHash } from 'node:crypto';

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const ACCESS =
  /^\[(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})\] (\S+) (\d+) "(\S+) (\S+)[^"]*" (\d{3}) (\S+)/;
const SID = /\bsid=(\S*)/;
const NODE = /\bn=\.?([A-Za-z0-9_-]{1,40})\b/;
const VIEW_PATH = /\/b1s\/v\d+\/(?:view|sml)\.svc\/([A-Za-z0-9_]{1,120}B1SLQuery)\b/i;

/** Timeout = gateway error from the balancer or a request that hit the ~300 s limit. */
export const TIMEOUT_MS = 290_000;

/** A session id never leaves the Mac in clear: it is hashed before being kept in the state file. */
export function hashSid(sid) {
  return createHash('sha256').update(String(sid)).digest('hex').slice(0, 16);
}

/** Key of a Securityevent `session` (SHA-256 of the sid in uppercase hex) comparable with hashSid(sid). */
export function sessionKey(session) {
  return String(session).slice(0, 16).toLowerCase();
}

const MAX_QUERY = 1000;
/** OData query string of a call, decoded and trimmed (no control characters). */
function decodeQuery(path) {
  const i = path.indexOf('?');
  if (i < 0) return null;
  let q = path.slice(i + 1);
  try {
    q = decodeURIComponent(q.replace(/\+/g, '%20'));
  } catch {}
  q = q.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return q ? q.slice(0, MAX_QUERY) : null;
}

export function parseAccessLine(line) {
  const m = ACCESS.exec(line);
  if (!m) return null;
  const [, dd, mon, yyyy, hh, mi, ss, sign, oh, om, ip, micros, method, path, status, bytes] = m;
  const sid = SID.exec(line)?.[1];
  if (!(mon in MONTHS)) return null;
  const offsetMin = (sign === '-' ? -1 : 1) * (Number(oh) * 60 + Number(om));
  const utc = Date.UTC(Number(yyyy), MONTHS[mon], Number(dd), Number(hh), Number(mi), Number(ss)) - offsetMin * 60_000;
  const view = VIEW_PATH.exec(path)?.[1] ?? null;
  const node = NODE.exec(line)?.[1];
  return {
    at: new Date(utc),
    ip,
    durationMs: Math.round(Number(micros) / 1000),
    method,
    view,
    status: Number(status),
    bytes: bytes === '-' ? 0 : Number(bytes) || 0,
    sid: sid && sid !== '-' ? sid : null,
    node: node && node !== '-' ? node : null,
    query: view ? decodeQuery(path) : null,
  };
}

/**
 * @param {string} line
 * @param {number} offsetMinutes server UTC offset (Colombia = -300)
 */
export function parseSecurityLine(line, offsetMinutes = -300) {
  const parts = line.split('\t');
  if (parts.length < 4) return null;
  const tm = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(parts[0]);
  if (!tm) return null;
  const [server, company, ...userParts] = parts[1].split(':');
  const evText = parts[3].trim();
  const event = /^[A-Za-z]+/.exec(evText)?.[0];
  if (!event || !company) return null;
  const pid = /:pid=(\d+)/.exec(evText)?.[1];
  const session = /:session=(\S+)/.exec(evText)?.[1];
  const utc = Date.UTC(+tm[1], +tm[2] - 1, +tm[3], +tm[4], +tm[5], +tm[6]) - offsetMinutes * 60_000;
  return {
    at: new Date(utc),
    server,
    company,
    user: userParts.join(':') || '(sin usuario)',
    // Some lines carry "ip:port"; keep the host only.
    ip: stripPort(parts[2].trim()),
    event,
    pid: pid ? Number(pid) : null,
    session: session ?? null,
  };
}

function stripPort(ip) {
  const i = ip.lastIndexOf(':');
  // IPv4 with ":port" (one colon only); IPv6 is left as is.
  return i > 0 && ip.indexOf(':') === i && /^\d{1,5}$/.test(ip.slice(i + 1)) ? ip.slice(0, i) : ip;
}

function floorTo(date, minutes) {
  const ms = minutes * 60_000;
  return new Date(Math.floor(date.getTime() / ms) * ms).toISOString();
}

/** Timeout = 502/504 from the balancer or a call that reached the ~300 s limit. */
export function isTimeout(e) {
  return e.status === 502 || e.status === 504 || e.durationMs >= TIMEOUT_MS;
}

/**
 * View calls per 5-minute bucket, view and source IP. The access log does not say which company
 * database a call hits; `company` comes from the session map (hashSid(sid) -> { company, user }),
 * built from the Securityevent log (see sessionKey).
 * @param {Array<ReturnType<typeof parseAccessLine>>} entries
 * @param {Map<string,{company:string,user:string}>} sidWho hashed sid -> session owner (optional)
 */
export function aggregateViewCalls(entries, sidWho = new Map()) {
  const map = new Map();
  for (const e of entries) {
    if (!e || !e.view) continue;
    const bucketAt = floorTo(e.at, 5);
    const company = e.sid ? sidWho.get(hashSid(e.sid))?.company ?? null : null;
    const key = `${bucketAt}|${e.view}|${e.ip}|${company ?? ''}`;
    const row = map.get(key) ?? { bucketAt, view: e.view, sourceIp: e.ip, company, calls: 0, errors: 0, timeouts: 0, totalMs: 0, maxMs: 0, bytes: 0 };
    row.calls += 1;
    if (e.status >= 400) row.errors += 1;
    if (isTimeout(e)) row.timeouts += 1;
    row.totalMs += e.durationMs;
    row.maxMs = Math.max(row.maxMs, e.durationMs);
    row.bytes += e.bytes;
    map.set(key, row);
  }
  return [...map.values()];
}

/**
 * Logins / logouts / restores / failures per hour, IP, company and SL user; also returns the
 * session owners (sessionKey -> { company, user }) to label view calls.
 */
export function aggregateSessions(entries) {
  const map = new Map();
  const sidWho = new Map();
  for (const e of entries) {
    if (!e) continue;
    const bucketAt = floorTo(e.at, 60);
    const key = `${bucketAt}|${e.ip}|${e.company}|${e.user}`;
    const row = map.get(key) ?? { bucketAt, sourceIp: e.ip, company: e.company, user: e.user, logins: 0, logouts: 0, restores: 0, failures: 0 };
    if (e.event === 'LoginSucceed') row.logins += 1;
    else if (e.event === 'LogoutSucceed') row.logouts += 1;
    else if (e.event === 'SessionRestoreSucceed') row.restores += 1;
    else if (/Fail/i.test(e.event)) row.failures += 1;
    else continue;
    map.set(key, row);
    if (e.session && (e.event === 'LoginSucceed' || e.event === 'SessionRestoreSucceed')) {
      sidWho.set(sessionKey(e.session), { company: e.company, user: e.user });
    }
  }
  return { sessions: [...map.values()], sidWho };
}

/**
 * One row per view call (for the click-to-expand detail of the ranking): time, source IP, HTTP
 * status, duration, OData query, SL node and the session owner (company + SL user) when known.
 * @param {Array<ReturnType<typeof parseAccessLine>>} entries
 * @param {Map<string,{company:string,user:string}>} sidWho
 */
export function viewCallDetails(entries, sidWho = new Map()) {
  const out = [];
  for (const e of entries) {
    if (!e || !e.view) continue;
    const who = e.sid ? sidWho.get(hashSid(e.sid)) : undefined;
    out.push({
      at: e.at.toISOString(),
      view: e.view,
      sourceIp: e.ip,
      status: e.status,
      durationMs: e.durationMs,
      timeout: isTimeout(e),
      query: e.query ?? null,
      node: e.node ?? null,
      company: who?.company ?? null,
      user: who?.user ?? null,
      bytes: e.bytes,
    });
  }
  return out;
}

/** Splits a text chunk into complete lines; returns the bytes consumed (up to the last newline). */
export function completeLines(text) {
  const last = text.lastIndexOf('\n');
  if (last < 0) return { lines: [], consumed: 0 };
  const body = text.slice(0, last);
  return { lines: body.split(/\r?\n/).filter((l) => l.trim()), consumed: Buffer.byteLength(text.slice(0, last + 1), 'latin1') };
}
