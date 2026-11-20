import { canAuditAgents, getAuditScope } from "../../../../../../lib/chat/audit-access";
import { jsonNoStore, resolveSessionUser, serverError, unauthorized } from "../../../../../../lib/chat/http";
import { readThreats, requestSync, ThreatsUnavailable } from "../../../../../../lib/agent-audit/threats-db";
import { runPendingSyncs } from "../../../../../../lib/agent-audit/threats-sync";
import { evaluateCve, productName, referenceDate, spanishTitle, compareThreats, type ThreatRowDto } from "../../../../../../lib/agent-audit/threats-rules";

export const dynamic = "force-dynamic";

/**
 * GET /api/chat/auditoria/vulnerabilidades/criticas — «Lo más reciente y crítico» (administration only).
 * Returns the cached CVEs (last 365 days, plus anything that matches our inventory regardless of age),
 * each evaluated against the third-party inventory, and the inventory itself.
 * Lazy daily refresh: if the last successful refresh is older than 24 h, a «programado» one is queued.
 */
const STALE_MS = 24 * 3_600_000;
const SHOW_DAYS = 365;


export async function GET() {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    if (!(await canAuditAgents(user.email)) || !(await getAuditScope(user.email)).all)
      return jsonNoStore({ error: "Esta información solo la ve la administración." }, { status: 403 });
    try {
      let snap = await readThreats();
      const lastOkAt = snap.lastOk?.finishedAt ? Date.parse(snap.lastOk.finishedAt) : 0;
      const recentFailure = snap.last?.status === "fallido" && Date.now() - Date.parse(snap.last.finishedAt ?? snap.last.requestedAt ?? "") < 3_600_000;
      if (!snap.active && Date.now() - lastOkAt > STALE_MS && !recentFailure) {
        await requestSync("programado", null);
        void runPendingSyncs();
        snap = await readThreats();
      } else if (snap.active) {
        void runPendingSyncs(); // picks up a job left by a restart (no-op if this process is already running one)
      }
      const since = Date.now() - SHOW_DAYS * 86_400_000;
      const rows: ThreatRowDto[] = snap.cves
        .sort(compareThreats)
        .map((c) => {
          const evaluation = evaluateCve(c, snap.inventory);
          return {
            cveId: c.cveId,
            title: spanishTitle(c),
            titleEn: c.titleEn,
            description: c.description && c.description.length > 600 ? `${c.description.slice(0, 599)}…` : c.description,
            product: productName(c),
            cvss: c.cvss,
            severity: c.severity,
            published: c.published,
            kev: c.kev,
            kevAdded: c.kevAdded,
            kevDue: c.kevDue,
            kevRansomware: c.kevRansomware,
            epss: c.epss,
            refDate: referenceDate(c),
            evaluation,
          };
        })
        .filter((r) => r.evaluation.status !== "no_aplica" || (r.refDate && Date.parse(r.refDate) >= since));
      return jsonNoStore({
        active: snap.active,
        last: snap.last,
        lastOk: snap.lastOk,
        history: snap.history,
        rows,
        inventory: snap.inventory,
        totalCached: snap.cves.length,
      });
    } catch (e) {
      if (e instanceof ThreatsUnavailable) return jsonNoStore({ error: e.message, disponible: false }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError("GET /api/chat/auditoria/vulnerabilidades/criticas", error);
  }
}
