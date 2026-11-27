/**
 * Learned item mappings for PDF purchase orders (Nicolás Rivera, 2026-11-27, SynerLink msg 41435).
 * When the user (or the agent, on the user's instruction) mounts a PO line with a given SAP item, the choice is
 * remembered per company + customer, keyed by what the PO prints: the customer's reference, the EAN and/or the
 * normalized description. The resolver checks these FIRST (confidence «alta», reason «Aprendido…»). A learned
 * description also corrects other lines with the same active ingredient and strength («Sugerencia corregida»).
 * Table dbo.sales_item_mapping_learned + audit dbo.sales_item_mapping_learned_log
 * (prisma/manual/2026-11-27-ventas-mapeo-aprendido-*.sql). The mappings never touch SAP.
 */
import sql from 'mssql';
import sqlConfig from '../../dbconfig.js';
import { normalizeDescription } from './descriptionMatch';
import { normalizeBarcode, type Candidate, type Confidence, type LinePrediction } from './itemPrediction';

export type LearnedKeyType = 'cliente' | 'ean' | 'desc';
export interface LearnedKey { type: LearnedKeyType; value: string }

export interface LearnedMapping {
  id: number;
  keyType: LearnedKeyType;
  keyValue: string;
  itemCode: string;
  itemName: string;
  factor: number;
  /** PO description the mapping was taught with (for the ingredient match). */
  description: string;
  createdBy: string;
  updatedAt: string;
}

/** What the PO prints for a line. */
export interface PoLineSource { clientCode?: string | null; barcode?: string | null; description?: string | null }

export interface LearnedEntry extends PoLineSource { itemCode: string; itemName?: string; factor?: number }

/** Normalized description key: lowercase, no accents, single spaces, max 300 chars. PURE. */
export function descriptionKey(desc: unknown): string {
  return String(desc ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.+/%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/** Keys of a PO line, strongest first: customer reference, EAN, description. PURE. */
export function learnedKeys(s: PoLineSource): LearnedKey[] {
  const keys: LearnedKey[] = [];
  const ref = String(s.clientCode ?? '').trim().slice(0, 100);
  if (ref) keys.push({ type: 'cliente', value: ref.toUpperCase() });
  const ean = normalizeBarcode(s.barcode);
  if (ean) keys.push({ type: 'ean', value: ean });
  const d = descriptionKey(s.description);
  if (d.length >= 4) keys.push({ type: 'desc', value: d });
  return keys;
}

const KEY_LABEL: Record<LearnedKeyType, string> = { cliente: 'referencia del cliente', ean: 'código de barras', desc: 'descripción' };
const fmtDate = (iso: string) => String(iso ?? '').slice(0, 10);

/** Direct learned mapping of a line (customer reference, then EAN, then exact description). PURE. */
export function findLearned(s: PoLineSource, mappings: LearnedMapping[]): { mapping: LearnedMapping; reason: string } | null {
  for (const k of learnedKeys(s)) {
    const m = mappings.find((x) => x.keyType === k.type && x.keyValue === k.value);
    if (m) return { mapping: m, reason: `Aprendido: montado así el ${fmtDate(m.updatedAt)} por ${m.createdBy} (por ${KEY_LABEL[k.type]})` };
  }
  return null;
}

/** Ingredient + strength signature of a description («cefazolina|1000mg»); empty when there is no ingredient. PURE. */
export function ingredientSignature(desc: unknown): string {
  const n = normalizeDescription(String(desc ?? ''));
  if (!n.ingredients.length) return '';
  return `${[...n.ingredients].sort().join('+')}|${[...n.strengths].sort().join('+')}`;
}

/**
 * «Que la corrija sola»: a mapping learned for another description of the same customer with the same active
 * ingredient(s) and strength. Only when every such mapping points to the same item (no guessing). PURE.
 */
export function findSimilarLearned(s: PoLineSource, mappings: LearnedMapping[]): { mapping: LearnedMapping; reason: string } | null {
  const sig = ingredientSignature(s.description);
  if (!sig || sig.endsWith('|')) return null;
  const same = mappings.filter((m) => m.description && ingredientSignature(m.description) === sig);
  if (!same.length || new Set(same.map((m) => m.itemCode)).size !== 1) return null;
  const m = same[0];
  return { mapping: m, reason: `Sugerencia corregida: el ${fmtDate(m.updatedAt)} ${m.createdBy} montó ${m.itemCode} para el mismo principio activo y concentración` };
}

/** Validates the entries sent by the browser. PURE. */
export function cleanEntries(raw: unknown): LearnedEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 200).flatMap((e) => {
    const x = (e ?? {}) as Record<string, unknown>;
    const itemCode = String(x.itemCode ?? '').trim().slice(0, 50);
    const factor = Number(x.factor ?? 1);
    const entry: LearnedEntry = {
      itemCode, itemName: String(x.itemName ?? '').slice(0, 200), factor: Number.isFinite(factor) && factor > 0 && factor <= 10000 ? factor : 1,
      clientCode: x.clientCode == null ? null : String(x.clientCode), barcode: x.barcode == null ? null : String(x.barcode),
      description: x.description == null ? null : String(x.description).slice(0, 500),
    };
    return learnedKeys(entry).length ? [entry] : [];
  });
}

// ---------------------------------------------------------------- database (KRONOSDB)

async function pool(): Promise<{ p: sql.ConnectionPool }> {
  return { p: await sql.connect(sqlConfig) };
}

/** Active mappings of a customer. Returns [] when the table does not exist yet (deploy before the manual SQL). */
export async function loadLearned(companyId: number, cardCode: string): Promise<LearnedMapping[]> {
  try {
    const { p } = await pool();
    const r = await p.request().input('c', sql.Int, companyId).input('cc', sql.NVarChar(50), cardCode).query(`
      SELECT id, key_type, key_value, item_code, item_name, factor, description, created_by, updated_at
      FROM dbo.sales_item_mapping_learned WHERE id_company = @c AND card_code = @cc AND active = 1;`);
    return r.recordset.map((x) => ({
      id: Number(x.id), keyType: x.key_type, keyValue: String(x.key_value), itemCode: String(x.item_code), itemName: String(x.item_name ?? ''),
      factor: Number(x.factor) || 1, description: String(x.description ?? ''), createdBy: String(x.created_by ?? ''),
      updatedAt: x.updated_at instanceof Date ? x.updated_at.toISOString() : String(x.updated_at ?? ''),
    }));
  } catch (e) {
    console.warn('Learned item mappings not available:', (e as Error).message);
    return [];
  }
}

/** Saves (upserts) or forgets the mappings of the given PO lines, with an audit row per key. One transaction. */
export async function changeLearned(
  action: 'save' | 'forget', a: { companyId: number; cardCode: string; entries: LearnedEntry[]; user: string; userEmail: string; source: 'usuario' | 'agente' }
): Promise<number> {
  const { p } = await pool();
  const tx = new sql.Transaction(p);
  await tx.begin();
  let n = 0;
  try {
    for (const e of a.entries) {
      for (const k of learnedKeys(e)) {
        const req = new sql.Request(tx)
          .input('c', sql.Int, a.companyId).input('cc', sql.NVarChar(50), a.cardCode)
          .input('kt', sql.NVarChar(10), k.type).input('kv', sql.NVarChar(300), k.value)
          .input('ic', sql.NVarChar(50), e.itemCode).input('iname', sql.NVarChar(200), e.itemName ?? '')
          .input('f', sql.Decimal(18, 4), e.factor ?? 1).input('d', sql.NVarChar(500), e.description ?? null)
          .input('u', sql.NVarChar(320), a.user).input('ue', sql.NVarChar(320), a.userEmail).input('src', sql.NVarChar(10), a.source).input('act', sql.NVarChar(10), action);
        const r = await req.query(action === 'save'
          ? `
          MERGE dbo.sales_item_mapping_learned WITH (HOLDLOCK) AS t
          USING (SELECT @c AS id_company, @cc AS card_code, @kt AS key_type, @kv AS key_value) AS s
            ON t.id_company = s.id_company AND t.card_code = s.card_code AND t.key_type = s.key_type AND t.key_value = s.key_value
          WHEN MATCHED THEN UPDATE SET item_code = @ic, item_name = @iname, factor = @f, description = @d, active = 1,
            created_by = @u, updated_at = SYSUTCDATETIME(), times_taught = t.times_taught + 1
          WHEN NOT MATCHED THEN INSERT (id_company, card_code, key_type, key_value, item_code, item_name, factor, description, created_by)
            VALUES (@c, @cc, @kt, @kv, @ic, @iname, @f, @d, @u);
          INSERT INTO dbo.sales_item_mapping_learned_log (id_company, card_code, key_type, key_value, item_code, factor, action, source, user_email)
            VALUES (@c, @cc, @kt, @kv, @ic, @f, @act, @src, @ue);`
          : `
          UPDATE dbo.sales_item_mapping_learned SET active = 0, updated_at = SYSUTCDATETIME()
            WHERE id_company = @c AND card_code = @cc AND key_type = @kt AND key_value = @kv AND active = 1;
          IF @@ROWCOUNT > 0
            INSERT INTO dbo.sales_item_mapping_learned_log (id_company, card_code, key_type, key_value, item_code, factor, action, source, user_email)
              VALUES (@c, @cc, @kt, @kv, @ic, @f, @act, @src, @ue);`);
        n += r.rowsAffected[0] ?? 0;
      }
    }
    await tx.commit();
    return n;
  } catch (e) {
    await tx.rollback().catch(() => undefined);
    throw e;
  }
}

export interface LearnedHit { kind: 'directo' | 'similar'; id: number; itemCode: string; reason: string }

/**
 * Puts the learned item first in the prediction of each line: a direct mapping (reference, EAN, description) is
 * «alta»; a mapping of the same active ingredient and strength is at least «media» («Sugerencia corregida»). PURE.
 */
export function withLearned<T extends { input: { ClientCode?: string; Barcode?: string; ItemDescription: string }; prediction: LinePrediction }>(
  rows: T[], mappings: LearnedMapping[]
): (T & { learned?: LearnedHit })[] {
  if (!mappings.length) return rows;
  return rows.map((r) => {
    const src = { clientCode: r.input.ClientCode, barcode: r.input.Barcode, description: r.input.ItemDescription };
    const direct = findLearned(src, mappings);
    const hit = direct ?? findSimilarLearned(src, mappings);
    if (!hit) return r;
    const kind = direct ? 'directo' : 'similar';
    const c: Candidate = { ItemCode: hit.mapping.itemCode, ItemName: hit.mapping.itemName, score: 1, reason: hit.reason, factor: hit.mapping.factor, history: true };
    const p = r.prediction;
    const confidence: Confidence = kind === 'directo' ? 'alta' : p.confidence === 'alta' && p.candidates[0]?.ItemCode === c.ItemCode ? 'alta' : 'media';
    return {
      ...r,
      prediction: { confidence, reason: hit.reason, autoSelected: confidence === 'alta', candidates: [c, ...p.candidates.filter((x) => x.ItemCode !== c.ItemCode)].slice(0, 3) },
      learned: { kind, id: hit.mapping.id, itemCode: c.ItemCode, reason: hit.reason },
    };
  });
}
