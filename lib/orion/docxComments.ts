import JSZip from 'jszip';

/**
 * Inserta las marcas del tablero como comentarios nativos de Word, anclados al párrafo que
 * contiene el texto marcado. Así la preparadora corrige en Word sin copiar nada a mano.
 */

export type DocxCommentInput = {
  author: string;
  initials?: string | null;
  date?: string | null;
  /** Texto marcado en el tablero: ubica el párrafo. */
  quote: string;
  /** Contenido del comentario; cada elemento es un párrafo. */
  lines: string[];
};

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const COMMENTS_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';
const COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';

function escXml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

function paragraphText(xml: string): string {
  const parts: string[] = [];
  // \b evita <w:tab>, <w:tbl>… (solo <w:t> y <w:t xml:space="preserve">).
  const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) parts.push(decodeXml(m[1]));
  return parts.join('');
}

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || 'SL'
  );
}

export async function addCommentsToDocx(content: Uint8Array | Buffer, comments: DocxCommentInput[]): Promise<Buffer> {
  const zip = await JSZip.loadAsync(content);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw Object.assign(new Error('El archivo no es un documento Word (.docx) válido.'), { status: 400 });
  let documentXml = await docFile.async('string');
  if (comments.length === 0) return Buffer.from(await zip.generateAsync({ type: 'uint8array' }));

  let commentsXml = (await zip.file('word/comments.xml')?.async('string')) ?? null;
  let nextId = 0;
  if (commentsXml) {
    const ids = [...commentsXml.matchAll(/<w:comment\b[^>]*\sw:id="(\d+)"/g)].map((m) => Number(m[1]));
    nextId = ids.length ? Math.max(...ids) + 1 : 0;
  }

  // Párrafos del cuerpo (no <w:pPr>, no <w:p/> vacíos).
  const paragraphs: Array<{ start: number; end: number; text: string }> = [];
  // \b evita <w:pPr>; [^>/] evita los <w:p/> vacíos.
  const pRe = /<w:p\b[^>/]*>[\s\S]*?<\/w:p>/g;
  let pm: RegExpExecArray | null;
  while ((pm = pRe.exec(documentXml))) {
    paragraphs.push({ start: pm.index, end: pm.index + pm[0].length, text: norm(paragraphText(pm[0])) });
  }
  if (paragraphs.length === 0) throw Object.assign(new Error('El Word no tiene párrafos para comentar.'), { status: 422 });

  // Inserciones por párrafo; se aplican de atrás hacia adelante para no mover los índices.
  const byParagraph = new Map<number, number[]>();
  const newComments: string[] = [];
  for (const c of comments) {
    const q = norm(c.quote);
    let index = q ? paragraphs.findIndex((p) => p.text.includes(q)) : -1;
    const lines = [...c.lines];
    if (index < 0) {
      index = 0;
      lines.unshift(`(No se encontró el texto marcado en esta versión: "${c.quote}")`);
    }
    const id = nextId++;
    byParagraph.set(index, [...(byParagraph.get(index) ?? []), id]);
    const body = lines
      .map((line) => `<w:p><w:r><w:t xml:space="preserve">${escXml(line)}</w:t></w:r></w:p>`)
      .join('');
    newComments.push(
      `<w:comment w:id="${id}" w:author="${escXml(c.author)}" w:date="${escXml(
        c.date || new Date().toISOString()
      )}" w:initials="${escXml(c.initials || initialsOf(c.author))}">${body}</w:comment>`
    );
  }

  for (const index of [...byParagraph.keys()].sort((a, b) => b - a)) {
    const ids = byParagraph.get(index)!;
    const p = paragraphs[index];
    let xml = documentXml.slice(p.start, p.end);
    const starts = ids.map((id) => `<w:commentRangeStart w:id="${id}"/>`).join('');
    const ends = ids
      .map((id) => `<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`)
      .join('');
    const pPrEnd = xml.indexOf('</w:pPr>');
    const openEnd = xml.indexOf('>') + 1;
    const insertAt = pPrEnd >= 0 ? pPrEnd + '</w:pPr>'.length : openEnd;
    xml = xml.slice(0, insertAt) + starts + xml.slice(insertAt);
    xml = xml.slice(0, xml.length - '</w:p>'.length) + ends + '</w:p>';
    documentXml = documentXml.slice(0, p.start) + xml + documentXml.slice(p.end);
  }
  zip.file('word/document.xml', documentXml);

  if (commentsXml) {
    commentsXml = commentsXml.replace(/<\/w:comments>\s*$/, `${newComments.join('')}</w:comments>`);
  } else {
    commentsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="${W_NS}">${newComments.join('')}</w:comments>`;
  }
  zip.file('word/comments.xml', commentsXml);

  const ctFile = zip.file('[Content_Types].xml');
  if (ctFile) {
    let ct = await ctFile.async('string');
    if (!ct.includes('/word/comments.xml')) {
      ct = ct.replace('</Types>', `<Override PartName="/word/comments.xml" ContentType="${COMMENTS_CT}"/></Types>`);
      zip.file('[Content_Types].xml', ct);
    }
  }

  const relsPath = 'word/_rels/document.xml.rels';
  let rels =
    (await zip.file(relsPath)?.async('string')) ??
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  if (!rels.includes(COMMENTS_REL)) {
    let relId = 'rIdSynerlinkComments';
    while (rels.includes(`Id="${relId}"`)) relId += '1';
    rels = rels.replace(
      '</Relationships>',
      `<Relationship Id="${relId}" Type="${COMMENTS_REL}" Target="comments.xml"/></Relationships>`
    );
    zip.file(relsPath, rels);
  }

  return Buffer.from(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
}
