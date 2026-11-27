/**
 * Description matching for purchase-order lines without a strong key (no SAP code, barcode or catalog number).
 * Customer POs describe the product in their own words («CEFAZOLINA 1G POLVO PARA SOLUCION INYECTABLE VIAL 1
 * TABLETA (S) - LAB. :VARIOS») while SAP names are short («CEFAZOLINA 1g (10 UNID. X PLEGADIZA)»), so a plain word
 * overlap fails. This module keeps only what identifies the product: the active ingredient(s) and the strength.
 * Deterministic and explainable: every point of the score comes with a reason. PURE: no I/O.
 * (Nicolás Rivera, 2026-11-27, SynerLink msg 41307: Farmalogica PO 11619.)
 */

/** Words that describe the presentation, the form or the PO itself, never the product. */
const FILLER = new Set([
  'polvo', 'para', 'solucion', 'suspension', 'inyectable', 'inyeccion', 'iny', 'esteril', 'reconstituir', 'liofilizado',
  'vial', 'viales', 'ampolla', 'ampollas', 'amp', 'tableta', 'tabletas', 'tab', 'tabs', 'capsula', 'capsulas', 'cap',
  'frasco', 'bolsa', 'jeringa', 'sobre', 'sobres', 'lab', 'laboratorio', 'varios', 'generico', 'caja', 'cajas', 'cj',
  'unid', 'unidad', 'unidades', 'und', 'un', 'uds', 'plegadiza', 'presentacion', 'contenido', 'uso', 'inst',
  'institucional', 'oral', 'topico', 'via', 'intravenosa', 'intramuscular', 'iv', 'im', 'con', 'sin', 'por', 'de',
  'del', 'la', 'el', 'los', 'las', 'en', 'al', 'y', 'o', 'x', 's', 'sol', 'ref', 'referencia', 'marca', 'producto',
  'medicamento', 'diluyente', 'recubierta', 'recubiertas', 'liberacion', 'prolongada', 'comprimido', 'comprimidos',
]);

/** Dosage forms: a weak presentation hint when both sides mention one. */
const FORMS: Record<string, string> = {
  vial: 'vial', viales: 'vial', ampolla: 'ampolla', ampollas: 'ampolla', amp: 'ampolla', tableta: 'tableta', tabletas: 'tableta',
  tab: 'tableta', capsula: 'capsula', capsulas: 'capsula', cap: 'capsula', frasco: 'frasco', bolsa: 'bolsa', jarabe: 'jarabe',
  crema: 'crema', gel: 'gel', sobre: 'sobre', sobres: 'sobre',
};

/** Export / country variants: never the natural choice for a domestic PO. */
export const EXPORT_RE = /\b(exp|export|exportacion|ecuador|peru|guatemala|salvador|honduras|nicaragua|venezuela|panama|bolivia|chile|mexico|dominicana|costa rica|paraguay|uruguay)\b/;

const UNIT_ALIASES: [RegExp, string][] = [
  [/^(g|gr|grs|gramo|gramos)$/, 'g'],
  [/^(mg|mgs|miligramo|miligramos)$/, 'mg'],
  [/^(mcg|ug|microgramo|microgramos)$/, 'mcg'],
  [/^(ml|mls|cc|mililitro|mililitros)$/, 'ml'],
  [/^(l|lt|lts|litro|litros)$/, 'l'],
  [/^(ui|u\.i|iu)$/, 'ui'],
];
const TO_BASE: Record<string, number> = { g: 1000, mg: 1, mcg: 0.001, ml: 1, l: 1000, ui: 1 };
const DIM: Record<string, string> = { g: 'mass', mg: 'mass', mcg: 'mass', ml: 'vol', l: 'vol', ui: 'ui' };

export interface NormalizedDescription {
  /** Normalized text (lowercase, no accents, units unified). */
  text: string;
  /** Active-ingredient words per component («a + b» → [[a], [b]]). */
  components: string[][];
  /** All ingredient words. */
  ingredients: string[];
  /** Strengths as «1000mg», «500mg», «5ml». */
  strengths: string[];
  /** Dosage forms mentioned. */
  forms: string[];
  /** Mentions an export/country variant itself. */
  export: boolean;
}

const strip = (s: string) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const unitOf = (u: string): string | null => {
  for (const [re, v] of UNIT_ALIASES) if (re.test(u)) return v;
  return null;
};

/** «1.000» / «0,5» → number. PURE. */
const num = (s: string): number => Number(s.replace(',', '.'));

/** Strength in the base unit of its dimension (mg, ml, ui): «1g» → «1000mg». PURE. */
export function strengthKey(value: number, unit: string): string {
  const v = Math.round(value * TO_BASE[unit] * 1000) / 1000;
  return `${v}${DIM[unit] === 'mass' ? 'mg' : DIM[unit] === 'vol' ? 'ml' : 'ui'}`;
}

/**
 * Normalizes a PO description or an SAP item name. PURE.
 * «CEFAZOLINA 1G POLVO PARA SOLUCION INYECTABLE VIAL 1 TABLETA (S) - LAB. :VARIOS» →
 *   components [['cefazolina']], strengths ['1000mg'].
 */
export function normalizeDescription(desc: string): NormalizedDescription {
  let s = strip(desc)
    // «1 G», «1gr», «0,5 G», «4.5g» → «1g», «0.5g»
    .replace(/(\d+[.,]?\d*)\s*(gramos|gramo|grs|gr|g|miligramos|miligramo|mgs|mg|microgramos|mcg|ug|mililitros|mls|ml|cc|litros|lts|lt|u\.i|ui|iu)\b/g, (_m, n: string, u: string) => `${n.replace(',', '.')}${unitOf(u) ?? u}`);
  // Combos: «a + b», «a y b» (only the «+» splits safely; «y» splits when both sides carry words).
  s = s.replace(/\+/g, ' + ');
  const raw = s.split(/[^a-z0-9.+/%]+/).filter(Boolean);
  const components: string[][] = [[]];
  const strengths: string[] = [];
  const forms: string[] = [];
  for (const w0 of raw) {
    const w = w0.replace(/^\.+|\.+$/g, '');
    if (!w) continue;
    if (w === '+' || w === 'y') {
      if (components[components.length - 1].length) components.push([]);
      continue;
    }
    // Strengths, also «500mg/5ml» (each part counts).
    const parts = w.split('/');
    let isStrength = false;
    for (const p of parts) {
      const m = p.match(/^(\d+\.?\d*)(g|mg|mcg|ml|l|ui)$/);
      if (m) { strengths.push(strengthKey(num(m[1]), m[2])); isStrength = true; }
    }
    if (isStrength) continue;
    if (FORMS[w]) forms.push(FORMS[w]);
    if (FILLER.has(w) || /\d/.test(w) || w.length < 4) continue;
    components[components.length - 1].push(w);
  }
  const comps = components.filter((c) => c.length);
  return {
    text: s.replace(/\s+/g, ' ').trim(),
    components: comps,
    ingredients: [...new Set(comps.flat())],
    strengths: [...new Set(strengths)],
    forms: [...new Set(forms)],
    export: EXPORT_RE.test(s),
  };
}

/** Main ingredient word of each component (the longest: «acido ascorbico» → «ascorbico»). Used for the SAP search. PURE. */
export function searchTokens(n: NormalizedDescription): string[] {
  return n.components.map((c) => [...c].sort((a, b) => b.length - a.length || a.localeCompare(b))[0]).filter(Boolean);
}

export interface DescriptionMatch {
  /** Every component has its main ingredient in the item name. */
  ingredientOk: boolean;
  /** Share of the PO ingredient words found in the item name (0..1). */
  ingredientShare: number;
  /** Strength matches (same set, or the sum of a combo: 4g + 0.5g = 4.5g). */
  strengthOk: boolean;
  /** The item states a different strength. */
  strengthClash: boolean;
  formOk: boolean;
  /** Export/country variant that the PO did not ask for. */
  exportVariant: boolean;
  /** Brand item («ZOLIBIOS (CEFAZOLINA 1g …)»): its name starts with a word that is not an ingredient and the PO does not mention it. */
  brandVariant: boolean;
}

const sumKey = (keys: string[]): string | null => {
  const ms = keys.map((k) => k.match(/^(\d+\.?\d*)(mg|ml|ui)$/)).filter(Boolean) as RegExpMatchArray[];
  if (ms.length < 2 || new Set(ms.map((m) => m[2])).size !== 1) return null;
  return `${Math.round(ms.reduce((a, m) => a + Number(m[1]), 0) * 1000) / 1000}${ms[0][2]}`;
};

/** How a PO description matches an SAP item name. PURE. */
export function matchDescription(po: NormalizedDescription, itemName: string, itemCode = ''): DescriptionMatch {
  const it = normalizeDescription(itemName);
  const words = new Set(it.text.split(/[^a-z0-9]+/));
  const has = (w: string) => words.has(w) || [...words].some((x) => x.length >= 5 && w.length >= 5 && (x.startsWith(w) || w.startsWith(x)));
  const mains = searchTokens(po);
  const ingredientOk = mains.length > 0 && mains.every(has);
  const ingredientShare = po.ingredients.length ? po.ingredients.filter(has).length / po.ingredients.length : 0;
  const poS = new Set(po.strengths);
  const itS = new Set(it.strengths);
  const strengthOk = poS.size > 0 && itS.size > 0 && (
    [...poS].every((k) => itS.has(k)) || (sumKey([...poS]) != null && itS.has(sumKey([...poS])!))
  );
  const strengthClash = poS.size > 0 && itS.size > 0 && !strengthOk;
  const formOk = po.forms.length > 0 && it.forms.some((f) => po.forms.includes(f));
  const exportVariant = !po.export && (it.export || /EXP/i.test(itemCode));
  const first = it.text.split(/[^a-z]+/).find((w) => w.length >= 4 && !FILLER.has(w));
  const poWords = new Set(po.text.split(/[^a-z]+/));
  const brandVariant = ingredientOk && Boolean(first) && !po.ingredients.includes(first!) && !mains.some((m) => first!.startsWith(m)) && !poWords.has(first!);
  return { ingredientOk, ingredientShare, strengthOk, strengthClash, formOk, exportVariant, brandVariant };
}

/** Company-wide sales of an item (any customer, recent months). */
export interface SalesInfo {
  /** Distinct invoices with the item in the window (capped read: a lower bound for best sellers). */
  docs: number;
  /** Recent distinct unit prices (> $1), newest first. */
  prices: number[];
  lastDate: string;
}

/** Closest ratio between the PO price and a reference unit price, directly or per box. PURE. */
export function priceDistance(poPrice: number | null, refPrices: number[], pack: number): { diff: number; factor: number } | null {
  if (!poPrice || poPrice <= 0) return null;
  let best: { diff: number; factor: number } | null = null;
  for (const r of refPrices) {
    if (!r || r <= 0) continue;
    for (const f of pack > 1 ? [1, pack] : [1]) {
      const diff = Math.abs(poPrice / (r * f) - 1);
      if (!best || diff < best.diff) best = { diff, factor: f };
    }
  }
  return best;
}
