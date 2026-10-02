/**
 * Tabla de adjuntos: el PDF que salió de un Word en preparación (`sourceDraftFileId`) se muestra
 * justo debajo de ese Word, como sub-fila (N.º 1.1, 1.2…). Si el Word ya no está en la lista, el
 * PDF queda como fila normal.
 */
export type NestedAttachmentRow<T> = { file: T; rowNumber: string; nested: boolean };

export function nestDraftPdfRows<T extends { id: string | number }>(
  rows: T[],
  sourceDraftOf: (row: T) => string | null | undefined
): NestedAttachmentRow<T>[] {
  const ids = new Set(rows.map((r) => String(r.id)));
  const children = new Map<string, T[]>();
  const nestedIds = new Set<string>();
  for (const row of rows) {
    const source = String(sourceDraftOf(row) || '').trim();
    if (!source || source === String(row.id) || !ids.has(source)) continue;
    children.set(source, [...(children.get(source) ?? []), row]);
    nestedIds.add(String(row.id));
  }

  const out: NestedAttachmentRow<T>[] = [];
  let n = 0;
  for (const row of rows) {
    if (nestedIds.has(String(row.id))) continue;
    n += 1;
    out.push({ file: row, rowNumber: String(n), nested: false });
    (children.get(String(row.id)) ?? []).forEach((child, i) => {
      out.push({ file: child, rowNumber: `${n}.${i + 1}`, nested: true });
    });
  }
  return out;
}
