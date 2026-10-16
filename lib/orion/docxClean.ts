import JSZip from 'jszip';

export type DocxMarkupReport = {
  comments: number;
  trackedChanges: number;
  clean: boolean;
};

/** Partes del .docx donde puede haber texto con cambios (cuerpo, encabezados, pies, notas). */
const CONTENT_PART = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/i;

function count(xml: string, pattern: RegExp): number {
  return (xml.match(pattern) ?? []).length;
}

/**
 * Revisa si el Word todavía tiene comentarios o control de cambios sin aceptar.
 * Graph convierte el .docx a PDF tal cual, así que el PDF final saldría con esas marcas.
 */
export async function inspectDocxMarkup(content: Uint8Array | Buffer): Promise<DocxMarkupReport> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(content);
  } catch {
    throw Object.assign(new Error('El archivo no es un documento Word (.docx) válido.'), { status: 400 });
  }

  let comments = 0;
  const commentsXml = await zip.file('word/comments.xml')?.async('string');
  if (commentsXml) comments = count(commentsXml, /<w:comment\b/g);

  let trackedChanges = 0;
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || !CONTENT_PART.test(path)) continue;
    const xml = await entry.async('string');
    trackedChanges += count(xml, /<w:(ins|del|moveFrom|moveTo)\b/g);
    // Anclas de comentario que quedaron sin comments.xml también cuentan.
    if (!commentsXml) comments += count(xml, /<w:commentReference\b/g);
  }

  return { comments, trackedChanges, clean: comments === 0 && trackedChanges === 0 };
}
