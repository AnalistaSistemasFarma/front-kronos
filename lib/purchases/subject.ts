/**
 * Asunto y descripción de la solicitud de compra en SynerLink, armados desde el
 * borrador de SAP (como el de Ventas: «OV - cliente - NIT - primera línea»). PURO.
 *
 *   SC - PROVEEDOR - primera línea (+N líneas)
 *
 * El proveedor es el de la primera línea que lo tenga; si ninguna lo tiene se omite.
 */
type Line = { ItemDescription?: unknown; ItemCode?: unknown; U_NombreProveedor?: unknown; LineVendor?: unknown };
type DraftLike = { DocTotal?: unknown; DocCurrency?: unknown; Comments?: unknown; DocumentLines?: Line[] };

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

export function purchaseSubject(d: DraftLike): string {
  const lines = d.DocumentLines ?? [];
  const first = lines[0];
  const vendor = lines.map((l) => clean(l.U_NombreProveedor) || clean(l.LineVendor)).find(Boolean) ?? '';
  const firstText = first ? clean(first.ItemDescription) || clean(first.ItemCode) : '';
  const more = lines.length > 1 ? ` (+${lines.length - 1} ${lines.length - 1 === 1 ? 'línea' : 'líneas'})` : '';
  return ['SC', vendor.toUpperCase(), firstText ? `${firstText}${more}` : '']
    .filter(Boolean)
    .join(' - ')
    .slice(0, 250);
}

export function purchaseDescription(d: DraftLike): string {
  const total =
    d.DocTotal != null && d.DocTotal !== ''
      ? ` · Total ${Number(d.DocTotal).toLocaleString('es-CO')} ${clean(d.DocCurrency)}`.trimEnd()
      : '';
  return `${clean(d.Comments).slice(0, 900)}${total}`.trim();
}
