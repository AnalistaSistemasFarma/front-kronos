/**
 * Lectura con IA del navegador (Prompt API / Gemini Nano, on-device) de la orden de compra del cliente
 * en PDF, para proponer las líneas de la oferta de venta (reunión del 2026-11-06). PURO: esquema de la
 * respuesta, instrucciones y normalización. El PDF no sale del computador del usuario.
 */
import type { ImportLine } from './linesImport';

/** Esquema JSON que debe cumplir la respuesta del modelo (responseConstraint). */
export const PDF_ORDER_SCHEMA = {
  type: 'object',
  properties: {
    numeroOrdenCompra: { type: 'string' },
    nitCliente: { type: 'string' },
    fechaEntrega: { type: 'string', description: 'AAAA-MM-DD o vacío' },
    lineas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          codigo: { type: 'string' },
          descripcion: { type: 'string' },
          cantidad: { type: 'number' },
          precioUnitario: { type: 'number' },
        },
        required: ['descripcion', 'cantidad'],
      },
    },
  },
  required: ['lineas'],
} as const;

export const PDF_ORDER_SYSTEM_PROMPT =
  'Eres un asistente que lee órdenes de compra de clientes de una farmacéutica en Colombia. ' +
  'Extrae SOLO lo que está escrito en el documento, sin inventar: número de la orden de compra, NIT del cliente ' +
  '(el comprador, no el proveedor), fecha de entrega si aparece y cada línea de producto con su código (si lo hay), ' +
  'descripción, cantidad y precio unitario (sin IVA si se distingue). No incluyas subtotales, impuestos, fletes ni ' +
  'totales como líneas. Los números van sin separadores de miles. Si un dato no aparece, déjalo vacío.';

export function pdfOrderPrompt(text: string): string {
  return `Texto de la orden de compra (puede venir desordenado por columnas):\n"""\n${text.slice(0, 12000)}\n"""\nDevuelve el JSON pedido.`;
}

export interface PdfOrderResult {
  numeroOrdenCompra: string;
  nitCliente: string;
  fechaEntrega: string;
  lineas: ImportLine[];
}

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').replace(/[^\d,.-]/g, '');
  if (!s) return null;
  // Formato colombiano: «1.200» o «2.500,5» (punto de miles, coma decimal); si no, «1200.5» / «1,200.5».
  const [ent, dec] = s.replace(/^-/, '').split(',');
  const grupos = ent.split('.');
  const miles = grupos.length > 1 && grupos[0].length >= 1 && grupos[0].length <= 3 && grupos.slice(1).every((g) => g.length === 3);
  const co = (miles && (dec === undefined || /^\d+$/.test(dec))) || /,\d{1,2}$/.test(s);
  const n = co ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** Normaliza la respuesta del modelo (texto JSON) a líneas importables. Tolerante: ignora lo que no sirva. */
export function parsePdfOrder(raw: string): PdfOrderResult {
  let data: Record<string, unknown> = {};
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    data = JSON.parse(m ? m[0] : raw);
  } catch {
    throw new Error('La IA no devolvió un resultado legible. Intente de nuevo o use el cargue desde Excel.');
  }
  const fecha = String(data.fechaEntrega ?? '').trim();
  const lineas: ImportLine[] = [];
  ((data.lineas as Record<string, unknown>[] | undefined) ?? []).forEach((l, i) => {
    const qty = num(l.cantidad);
    const desc = String(l.descripcion ?? '').trim().slice(0, 200);
    const code = String(l.codigo ?? '').trim().slice(0, 50);
    if (!qty || qty <= 0 || (!desc && !code)) return;
    const price = num(l.precioUnitario);
    lineas.push({ row: i + 1, ItemCode: code, Quantity: qty, UnitPrice: price && price > 0 ? price : null, WarehouseCode: '', ItemDescription: desc });
  });
  return {
    numeroOrdenCompra: String(data.numeroOrdenCompra ?? '').trim().slice(0, 100),
    nitCliente: String(data.nitCliente ?? '').replace(/[^\d-]/g, '').slice(0, 30),
    fechaEntrega: /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : '',
    lineas,
  };
}

/** Palabras útiles de una descripción para buscarla en SAP (sin unidades ni palabras cortas). PURA. */
export function searchTerms(desc: string): string[] {
  const stop = new Set(['caja', 'por', 'con', 'para', 'uso', 'inst', 'und', 'unidad', 'frasco', 'ampolla', 'amp', 'vial', 'tab', 'sol', 'iny', 'x']);
  return desc
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^A-Z0-9]+/)
    .filter((w) => w.length >= 4 && !stop.has(w.toLowerCase()) && !/^\d+$/.test(w))
    .slice(0, 2);
}

/** NIT sin dígito de verificación ni separadores («900.123.456-7» → «900123456»). PURA. */
export function nitBase(nit: string): string {
  const s = String(nit ?? '').trim();
  const sinDv = s.includes('-') ? s.slice(0, s.lastIndexOf('-')) : s;
  return sinDv.replace(/\D/g, '');
}

const tokens = (s: string) =>
  String(s ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/(\d)\s+(ML|MG|G|MCG|UI|L|H)\b/g, '$1$2')
    .split(/[^A-Z0-9./]+/)
    .filter((w) => w.length >= 2);

/** Parecido entre la descripción de la OC y el nombre del artículo en SAP (0 a 1): palabras y medidas en común. PURA. */
export function similarity(desc: string, name: string): number {
  const a = new Set(tokens(desc));
  const b = new Set(tokens(name));
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const t of a) if (b.has(t)) hit += /\d/.test(t) ? 2 : 1; // las medidas (270ML, 5ML/H) pesan doble
  let total = 0;
  for (const t of a) total += /\d/.test(t) ? 2 : 1;
  return hit / total;
}

/**
 * Elige el artículo de SAP más parecido. Se toma solo si es claro: puntaje ≥ 0,5 y sin empate con el segundo
 * (si hay empate, se deja el mejor pero marcado «a revisar»). PURA.
 */
export function bestCandidate(desc: string, candidates: { ItemCode: string; ItemName: string }[]): { ItemCode: string; ItemName: string; score: number; seguro: boolean } | null {
  const scored = candidates.map((c) => ({ ...c, score: similarity(desc, c.ItemName) })).sort((x, y) => y.score - x.score);
  const top = scored[0];
  if (!top || top.score < 0.34) return null;
  const second = scored[1]?.score ?? 0;
  return { ...top, seguro: top.score >= 0.5 && top.score - second >= 0.15 };
}
