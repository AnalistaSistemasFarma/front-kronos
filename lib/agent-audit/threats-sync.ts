import "server-only";
import { claimSync, failSync, finishSync, progressSync, readCachedCves, readInventory, upsertCves } from "./threats-db";
import { cpeKeys, mergeCve, parseKevEntry, parseNvdCve, type ThreatCve } from "./threats-rules";

/**
 * Refresh job for «Lo más reciente y crítico». Runs inside the Next.js server (server-side fetch, public feeds):
 *   1. CISA KEV catalog (known exploited, one JSON file).
 *   2. NVD CVE API 2.0 — CRITICAL and HIGH published in the last THREATS_WINDOW_DAYS days (default 30, max 120).
 *   3. NVD — KEV entries added in the window (to get CVSS + CPE ranges).
 *   4. NVD — per inventory CPE key and version (`virtualMatchString`): exploited ones of any age, and anything
 *      published in the last 120 days. This is what tells «Nos afecta».
 *   5. FIRST EPSS (exploit probability), optional (THREATS_EPSS=0 turns it off).
 * NVD rate limit: 5 requests / 30 s without key, 50 / 30 s with NVD_API_KEY (optional, .env). We wait between calls.
 * Triggered by «Actualizar ahora» (administration) or lazily when the last refresh is older than 24 h.
 */

const NVD = "https://services.nvd.nist.gov/rest/json/cves/2.0";
const KEV = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
const EPSS = "https://api.first.org/data/v1/epss";
const DAY = 86_400_000;

const windowDays = () => Math.min(120, Math.max(1, Number(process.env.THREATS_WINDOW_DAYS) || 30));
const nvdKey = () => (process.env.NVD_API_KEY ?? "").trim();
const nvdDelay = () => (nvdKey() ? 700 : 6_500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nvdDate = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, ".000Z");

async function getJson(url: string, headers: Record<string, string> = {}, timeoutMs = 60_000): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "SynerLink-threats/1.0", ...headers }, signal: ctrl.signal, cache: "no-store" });
      if ((r.status === 403 || r.status === 429 || r.status >= 500) && attempt < 2) {
        await sleep(30_000); // NVD answers 403/429 when the rolling window is exceeded
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status} en ${new URL(url).host}`);
      return await r.json();
    } finally {
      clearTimeout(timer);
    }
  }
}

let lastNvdCall = 0;
async function nvd(params: Record<string, string | null>): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let start = 0; ; ) {
    const wait = lastNvdCall + nvdDelay() - Date.now();
    if (wait > 0) await sleep(wait);
    lastNvdCall = Date.now();
    const qs = Object.entries({ ...params, resultsPerPage: "2000", startIndex: String(start) })
      .map(([k, v]) => (v === null ? encodeURIComponent(k) : `${encodeURIComponent(k)}=${encodeURIComponent(v)}`))
      .join("&");
    const key = nvdKey();
    const j = (await getJson(`${NVD}?${qs}`, key ? { apiKey: key } : {})) as { totalResults?: number; vulnerabilities?: { cve: Record<string, unknown> }[] };
    const page = j.vulnerabilities ?? [];
    out.push(...page.map((v) => v.cve));
    start += page.length;
    if (!page.length || start >= Number(j.totalResults ?? 0) || start >= 10_000) return out;
  }
}

let running = false;

/** Runs every pending refresh (one at a time per process). Never throws. */
export async function runPendingSyncs(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (let guard = 0; guard < 3; guard++) {
      const job = await claimSync();
      if (!job) return;
      try {
        await refresh(job.id);
      } catch (e) {
        await failSync(job.id, e instanceof Error ? e.message : String(e)).catch(() => undefined);
      }
    }
  } catch (e) {
    console.error("[threats] refresh failed", e);
  } finally {
    running = false;
  }
}

async function refresh(id: number): Promise<void> {
  const now = Date.now();
  const days = windowDays();
  const merged = new Map<string, ThreatCve & { fromNvd?: boolean }>();
  const add = (p: (Partial<ThreatCve> & { cveId: string }) | null, fromNvd = false) => {
    if (!p) return;
    const prev = merged.get(p.cveId);
    merged.set(p.cveId, { ...mergeCve(prev, p), fromNvd: Boolean(prev?.fromNvd || fromNvd) });
  };

  // 1. CISA KEV
  const kev = (await getJson(KEV)) as { vulnerabilities?: unknown[] };
  const kevList = (kev.vulnerabilities ?? []).map(parseKevEntry).filter(Boolean);
  kevList.forEach((k) => add(k));

  // 2. NVD recent CRITICAL / HIGH
  const from = nvdDate(now - days * DAY);
  const to = nvdDate(now);
  let nvdCount = 0;
  for (const sev of ["CRITICAL", "HIGH"]) {
    await progressSync(id, `Consultando NVD: ${sev === "CRITICAL" ? "críticas" : "altas"} de los últimos ${days} días…`);
    const list = await nvd({ pubStartDate: from, pubEndDate: to, cvssV3Severity: sev, noRejected: null });
    list.forEach((c) => add(parseNvdCve(c), true));
    nvdCount += list.length;
  }

  // 3. NVD details of KEV entries added in the window
  await progressSync(id, "Consultando NVD: explotadas agregadas recientemente…");
  const kevRecent = await nvd({ hasKev: null, kevStartDate: from, kevEndDate: to });
  kevRecent.forEach((c) => add(parseNvdCve(c), true));
  nvdCount += kevRecent.length;

  // 4. Inventory: what affects our versions
  const inventory = (await readInventory()).filter((i) => i.active && i.version);
  const keys = new Map<string, string>();
  for (const it of inventory) for (const k of cpeKeys(it)) keys.set(`cpe:2.3:*:${k.vendor}:${k.product}:${it.version}`, it.product);
  const from120 = nvdDate(now - 119 * DAY);
  let n = 0;
  for (const [match, product] of keys) {
    n++;
    await progressSync(id, `Cruzando el inventario con NVD (${n} de ${keys.size}): ${product}…`);
    try {
      const exploited = await nvd({ virtualMatchString: match, hasKev: null });
      const recent = await nvd({ virtualMatchString: match, pubStartDate: from120, pubEndDate: to, noRejected: null });
      for (const c of [...exploited, ...recent]) {
        const p = parseNvdCve(c);
        if (p && (p.kev || (p.cvss ?? 0) >= 7)) add(p, true);
      }
      nvdCount += exploited.length + recent.length;
    } catch (e) {
      // NVD may reject an odd version string: skip that key, keep the rest.
      console.warn("[threats] inventory query skipped", match, e instanceof Error ? e.message : e);
    }
  }

  // 5. EPSS for everything relevant this run (KEV of any age is many; only recent KEV + NVD ones)
  if (process.env.THREATS_EPSS !== "0") {
    await progressSync(id, "Consultando la probabilidad de explotación (EPSS)…");
    const cached = new Map((await readCachedCves()).map((c) => [c.cveId, c]));
    const ids = [...merged.values()]
      .filter((c) => c.fromNvd || (c.kevAdded && Date.parse(c.kevAdded) >= now - days * DAY) || cached.get(c.cveId)?.cpes.length)
      .map((c) => c.cveId);
    for (let i = 0; i < ids.length; i += 100) {
      try {
        const j = (await getJson(`${EPSS}?cve=${ids.slice(i, i + 100).join(",")}`, {}, 30_000)) as { data?: { cve: string; epss: string }[] };
        for (const d of j.data ?? []) add({ cveId: d.cve, epss: Number(d.epss) });
      } catch {
        break; // EPSS is optional
      }
    }
  }

  await progressSync(id, `Guardando ${merged.size} vulnerabilidades…`);
  await upsertCves([...merged.values()]);
  await finishSync(id, {
    kev: kevList.length,
    nvd: nvdCount,
    summary: `CISA KEV: ${kevList.length} explotadas conocidas. NVD: ${nvdCount} registros (críticas y altas de ${days} días, explotadas recientes y ${keys.size} claves del inventario).${nvdKey() ? "" : " Sin llave de NVD (consultas más lentas)."}`,
  });
}
