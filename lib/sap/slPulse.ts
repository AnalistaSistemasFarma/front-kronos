import https from 'node:https';

/**
 * Pulso del Service Layer: un GET sin sesión a la raíz `b1s/v1` de cada host.
 *
 * - NO hace Login: no abre B1SESSION ni consume licencia; el SL responde
 *   (normalmente 401) y medimos cuánto tarda. Si el SL está saturado o caído,
 *   el tiempo sube o falla: es la señal de "SAP lento" vista desde SynerLink.
 * - NO se registra en callMetrics (no ensucia las métricas de llamadas reales).
 * - Caché corta por host para que varios usuarios mirando el monitor cada 5 s
 *   no multipliquen las pruebas.
 */

export type SlPulse = {
  ok: boolean;
  status: number;
  latencyMs: number | null;
  error: string | null;
  at: number;
};

const CACHE_MS = 30_000;
const TIMEOUT_MS = 4_000;
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: false });

const cache = new Map<string, SlPulse>();
const inflight = new Map<string, Promise<SlPulse>>();

function pulseUrl(baseUrl: string): URL | null {
  try {
    const raw = baseUrl.includes('://') ? baseUrl : `https://${baseUrl}`;
    const u = new URL(raw);
    if (!/\/b1s\/v[12]/i.test(u.pathname)) u.pathname = '/b1s/v1/';
    return u;
  } catch {
    return null;
  }
}

function probe(u: URL): Promise<SlPulse> {
  const t0 = performance.now();
  return new Promise((resolve) => {
    const done = (p: Omit<SlPulse, 'latencyMs' | 'at'>) =>
      resolve({ ...p, latencyMs: Math.round(performance.now() - t0), at: Date.now() });
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname,
        method: 'GET',
        agent,
        timeout: TIMEOUT_MS,
      },
      (res) => {
        res.resume();
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          // Cualquier respuesta HTTP < 500 significa que el SL atiende.
          done({ ok: status > 0 && status < 500, status, error: status >= 500 ? `HTTP ${status}` : null });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Timeout')));
    req.on('error', (err) =>
      done({
        ok: false,
        status: 0,
        error: err.message === 'Timeout' ? `Sin respuesta en ${TIMEOUT_MS / 1000} s` : err.message,
      })
    );
    req.end();
  });
}

/** Pulso de un Service Layer (con caché de 10 s por host:puerto). */
export async function pulseServiceLayer(baseUrl: string): Promise<SlPulse> {
  const u = pulseUrl(baseUrl);
  if (!u) return { ok: false, status: 0, latencyMs: null, error: 'URL inválida', at: Date.now() };
  const key = `${u.hostname}:${u.port || 443}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  const running = inflight.get(key);
  if (running) return running;
  const p = probe(u)
    .then((r) => {
      cache.set(key, r);
      return r;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function __resetSlPulseForTests() {
  cache.clear();
  inflight.clear();
}
