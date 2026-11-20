import os from 'node:os';
import { NextResponse } from 'next/server';
import { extractBearer } from '../../../../../lib/integration/apiKeyAuth';
import { withMssqlPool } from '../../../../../lib/mssqlPool';
import { evaluateSlNodeAlerts, evaluateViewTimeoutAlerts, SAP_THRESHOLDS } from '../../../../../lib/sap-monitor/analysis';
import { ingestKeys, isValidIngestKey } from '../../../../../lib/sap-monitor/config';
import { validateIngestPayload } from '../../../../../lib/sap-monitor/ingest';

/**
 * POST /api/system-metrics/sap/ingest  (Authorization: Bearer <SAP_MONITOR_INGEST_KEYS>)
 *
 * Receives AGGREGATED Service Layer metrics from the collector that runs on the horus Mac
 * (scripts/sap-monitor/collector.mjs, launchd com.horus.monitor-sap): handles/memory per node,
 * view calls per 5-min bucket (plus one row per call for the ranking detail) and logins/logouts per
 * hour. Nothing runs on the SAP server.
 * With "dryRun": true it validates and answers what it would store, without writing.
 */
const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(request: Request) {
  if (!ingestKeys().length) return NextResponse.json({ error: 'Ingesta no configurada' }, { status: 503 });
  if (!isValidIngestKey(extractBearer(request.headers.get('authorization')))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BYTES) return NextResponse.json({ error: 'Cuerpo demasiado grande' }, { status: 413 });
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BYTES) return NextResponse.json({ error: 'Cuerpo demasiado grande' }, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const parsed = validateIngestPayload(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const p = parsed.payload;
  const counts = {
    nodes: p.nodes.length,
    viewCalls: p.viewCalls.length,
    sessions: p.sessions.length,
    viewCallDetails: p.viewCallDetails.length,
    skipped: p.skipped,
  };
  if (p.dryRun) return NextResponse.json({ ok: true, dryRun: true, counts });

  try {
    const result = await withMssqlPool(async (pool) => {
      const store = await import('../../../../../lib/sap-monitor/store');
      const at = new Date(p.collectedAt);
      at.setSeconds(0, 0);
      if (p.nodes.length) await store.insertSlNodes(pool, at, p.nodes);
      if (p.viewCalls.length) await store.insertSlViewCalls(pool, p.viewCalls);
      if (p.sessions.length) await store.insertSlSessions(pool, p.sessions);
      // The per-call table came later (same pase); without it the aggregates are still stored.
      if (p.viewCallDetails.length) {
        await store.insertSlViewCallDetails(pool, p.viewCallDetails).catch((e) => {
          if ((e as { number?: number })?.number !== 208) throw e;
          console.warn('[sap-monitor] Falta dbo.sap_monitor_sl_view_call: se omite el detalle por llamada.');
        });
      }

      const { raiseSapAlerts } = await import('../../../../../lib/sap-monitor/alerts');
      const windowRows = await store.readRecentViewTimeouts(pool, SAP_THRESHOLDS.alert.viewWindowMin);
      const warnings = [...evaluateSlNodeAlerts(p.nodes), ...evaluateViewTimeoutAlerts(windowRows)];
      const sent = await raiseSapAlerts(pool, `${os.hostname()}/${p.source}`, warnings).catch((e) => {
        console.warn('[sap-monitor] Alertas (ingesta):', e instanceof Error ? e.message : e);
        return [];
      });
      return { alerts: sent.map((w) => w.key) };
    });
    return NextResponse.json({ ok: true, counts, ...result });
  } catch (error) {
    if ((error as { number?: number })?.number === 208) {
      return NextResponse.json({ error: 'Faltan las tablas sap_monitor_*' }, { status: 503 });
    }
    console.error('[sap-monitor] Ingesta fallida:', error);
    return NextResponse.json({ error: 'No se pudo guardar' }, { status: 500 });
  }
}
