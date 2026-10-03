import { PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { canonicalJson, sha256HexOf } from '../signature/record';
import { formatBogotaDateTime, toWinAnsiSafe } from '../watermark';
import { drawInstitutionalHeaders, type SgcInstitutionalHeaderData, type SgcRect } from './institutional';
import { drawQr } from './qr';

/**
 * PDF CONTROLADO del SGC — funciones PURAS sobre pdf-lib (se prueban sin red).
 *
 * El PDF oficial de una versión aprobada se arma así:
 *   1. PORTADA DE CONTROL: empresa, código, versión, título, tipo, proceso,
 *      estado, fechas, contenido firmado (con su SHA-256) y el bloque de
 *      firmas (Elaboró / Revisó / Aprobó con nombre, fecha y motivo).
 *   2. CONTENIDO: las páginas del borrador aprobado, cada una con encabezado
 *      y pie de control («CÓDIGO · Versión n · Documento controlado ·
 *      Página i de N»).
 *   3. MANIFIESTO DE FIRMAS ELECTRÓNICAS: cada firma con su significado,
 *      firmante, sello de tiempo del servidor, motivo, método de
 *      reautenticación, hash del contenido y hash del registro (y el trazo
 *      del maestro de firmas, si la persona lo tiene).
 * El manifiesto va además DENTRO del PDF, legible por máquina (entrada
 * «SgcManifest» del catálogo y archivo adjunto manifiesto-firmas.json), para
 * que la verificación compare el PDF con los registros de sgc.signature. La
 * huella SHA-256 del PDF final queda en sgc.document_version: alterar un solo
 * byte invalida la verificación. La marca «COPIA CONTROLADA» del visor (S1) se
 * estampa aparte, en cada consulta.
 *
 * Correcciones de Calidad (2026-10-02/03):
 *   - FIRMAS DENTRO DEL DOCUMENTO: cada firma (Elaboró/Revisó/Aprobó) se
 *     estampa en la posición que el elaborador ubicó sobre el documento
 *     (mecanismo de SynerLink, copia congelada). La portada solo lista las
 *     firmas que no tenían ubicación (respaldo); el manifiesto del final queda
 *     como REGISTRO DE TRAZABILIDAD (quién, cuándo, motivo, huellas).
 *   - ENCABEZADO INSTITUCIONAL opcional (lib/sgc/pdf/institutional.ts).
 *   - REVISIÓN MENOR de Calidad: el manifiesto la declara (motivo, quién,
 *     huella anterior y nueva) y la verificación acepta las firmas hechas
 *     sobre el contenido que esa revisión corrigió.
 */

export const SGC_MANIFEST_SCHEMA = 'sgc-manifiesto-firmas/v1';
export const SGC_MANIFEST_KEY = 'SgcManifest';

export interface SgcManifestSignature {
  uid: string;
  meaning: string;
  meaningLabel: string;
  signerName: string | null;
  signerEmail: string;
  signedAt: string;
  reason: string;
  authMethod: string;
  contentSha256: string;
  recordHash: string;
}

/** Firma ubicada en el documento: página del CONTENIDO (1 = primera) y caja en % (origen arriba-izquierda). */
export interface SgcManifestPlacement {
  uid: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Revisión menor de Calidad (forma o puntuación) hecha durante la aprobación. */
export interface SgcManifestMinorRevision {
  revision: number;
  baseSha256: string;
  newSha256: string;
  reason: string;
  by: string;
  at: string;
}

export interface SgcManifest {
  schema: typeof SGC_MANIFEST_SCHEMA;
  company: string;
  idCompany: number;
  code: string;
  title: string;
  versionNumber: number;
  idRequest: number;
  documentType: string;
  process: string;
  statusLabel: string;
  approvedAt: string;
  generatedAt: string;
  changeDescription: string | null;
  signedContent: { name: string; sha256: string };
  signatures: SgcManifestSignature[];
  verifyUrl: string;
  /** 2026-10-03: firmas estampadas dentro del documento. */
  placements?: SgcManifestPlacement[];
  /** 2026-10-03: el contenido lleva el encabezado institucional del sistema. */
  institutionalHeader?: boolean;
  /** 2026-10-03: revisiones menores de Calidad (en orden). */
  minorRevisions?: SgcManifestMinorRevision[];
}

/** Huellas de contenido sobre las que una firma del manifiesto es válida (el contenido final y lo que corrigieron las revisiones menores). */
export function acceptedContentHashes(m: Pick<SgcManifest, 'signedContent' | 'minorRevisions'>): Set<string> {
  const out = new Set([m.signedContent.sha256]);
  for (const r of m.minorRevisions ?? []) out.add(r.baseSha256);
  return out;
}

export function manifestSha256(manifest: SgcManifest): string {
  return sha256HexOf(canonicalJson(manifest));
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 48;
const INK = rgb(0.12, 0.14, 0.18);
const MUTED = rgb(0.42, 0.45, 0.5);
const BRAND = rgb(0.0, 0.19, 0.34);
const LINE = rgb(0.8, 0.82, 0.86);

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of toWinAnsiSafe(text).split(/\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const probe = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(probe, size) <= width) {
        line = probe;
        continue;
      }
      if (line) out.push(line);
      // Palabra más ancha que la línea (p.ej. un hash): se corta por caracteres.
      let chunk = word;
      while (font.widthOfTextAtSize(chunk, size) > width && chunk.length > 1) {
        let cut = chunk.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(chunk.slice(0, cut), size) > width) cut--;
        out.push(chunk.slice(0, cut));
        chunk = chunk.slice(cut);
      }
      line = chunk;
    }
    out.push(line);
  }
  return out;
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
  italic: PDFFont;
}

class Writer {
  page: PDFPage;
  y: number;
  constructor(private readonly pdf: PDFDocument, private readonly fonts: Fonts, private readonly header: string) {
    this.page = this.newPage();
    this.y = A4[1] - MARGIN - 18;
  }
  private newPage(): PDFPage {
    const page = this.pdf.addPage(A4);
    page.drawText(toWinAnsiSafe(this.header), { x: MARGIN, y: A4[1] - 30, size: 8, font: this.fonts.regular, color: MUTED });
    page.drawLine({ start: { x: MARGIN, y: A4[1] - 36 }, end: { x: A4[0] - MARGIN, y: A4[1] - 36 }, thickness: 0.6, color: LINE });
    return page;
  }
  ensure(height: number) {
    if (this.y - height < MARGIN + 20) {
      this.page = this.newPage();
      this.y = A4[1] - MARGIN - 18;
    }
  }
  text(value: string, opts: { size?: number; font?: keyof Fonts; color?: ReturnType<typeof rgb>; indent?: number; gap?: number; right?: number } = {}) {
    const size = opts.size ?? 10;
    const font = this.fonts[opts.font ?? 'regular'];
    const x = MARGIN + (opts.indent ?? 0);
    for (const line of wrap(value, font, size, A4[0] - MARGIN - x - (opts.right ?? 0))) {
      this.ensure(size + 3);
      this.page.drawText(line, { x, y: this.y, size, font, color: opts.color ?? INK });
      this.y -= size + 3;
    }
    this.y -= opts.gap ?? 2;
  }
  row(label: string, value: string, labelWidth = 150) {
    const size = 9.5;
    const lines = wrap(value || '—', this.fonts.regular, size, A4[0] - MARGIN * 2 - labelWidth);
    this.ensure(lines.length * (size + 3) + 6);
    this.page.drawText(toWinAnsiSafe(label), { x: MARGIN, y: this.y, size, font: this.fonts.bold, color: MUTED });
    for (const l of lines) {
      this.page.drawText(l, { x: MARGIN + labelWidth, y: this.y, size, font: this.fonts.regular, color: INK });
      this.y -= size + 3;
    }
    this.y -= 3;
    this.page.drawLine({ start: { x: MARGIN, y: this.y + 3 }, end: { x: A4[0] - MARGIN, y: this.y + 3 }, thickness: 0.3, color: LINE });
    this.y -= 3;
  }
  rule(gap = 8) {
    this.ensure(gap * 2);
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: A4[0] - MARGIN, y: this.y }, thickness: 0.8, color: BRAND });
    this.y -= gap;
  }
}

function colombia(iso: string): string {
  return `${formatBogotaDateTime(new Date(iso))} (hora Colombia)`;
}

/** Lado del QR de verificación en la portada (puntos) y su espacio reservado a la derecha. */
export const SGC_QR_SIZE = 86;
const QR_RESERVE = SGC_QR_SIZE + 12;

function drawCover(w: Writer, m: SgcManifest, mSha: string, placed: ReadonlySet<string>) {
  // Sprint 4: QR de verificación arriba a la derecha (abre la verificación de vigencia en SynerLink).
  if (m.verifyUrl) drawQr(w.page, m.verifyUrl, { x: A4[0] - MARGIN - SGC_QR_SIZE, y: A4[1] - 44 - SGC_QR_SIZE, size: SGC_QR_SIZE });
  const right = m.verifyUrl ? QR_RESERVE : 0;
  w.text(m.company, { size: 11, font: 'bold', color: BRAND, gap: 0, right });
  w.text('DOCUMENTO CONTROLADO · Sistema de Gestión de Calidad', { size: 8.5, color: MUTED, gap: 10, right });
  w.text(m.title, { size: 17, font: 'bold', gap: 2, right });
  w.text(`${m.code} · Versión ${m.versionNumber}`, { size: 12, font: 'bold', color: BRAND, gap: 10, right });
  if (m.verifyUrl && w.y > A4[1] - 44 - SGC_QR_SIZE - 14) w.y = A4[1] - 44 - SGC_QR_SIZE - 14;
  w.rule();
  w.text('Control del documento', { size: 11, font: 'bold', gap: 4 });
  w.row('Código', m.code);
  w.row('Versión', String(m.versionNumber));
  w.row('Título', m.title);
  w.row('Tipo documental', m.documentType);
  w.row('Proceso', m.process);
  w.row('Estado', m.statusLabel);
  w.row('Fecha de aprobación', colombia(m.approvedAt));
  w.row('Generado', colombia(m.generatedAt));
  w.row('Solicitud documental', `#${m.idRequest}`);
  if (m.changeDescription) w.row('Descripción del cambio', m.changeDescription);
  w.row('Contenido firmado', `${m.signedContent.name} · SHA-256 ${m.signedContent.sha256}`);
  for (const r of m.minorRevisions ?? []) {
    w.row(`Revisión menor de Calidad (${r.revision})`, `${r.by} · ${colombia(r.at)} · Motivo: ${r.reason}`);
  }
  w.y -= 8;
  // 2026-10-03: las firmas van DENTRO del documento; aquí solo las que no tenían ubicación (respaldo).
  const unplaced = m.signatures.filter((s) => !placed.has(s.uid));
  if (placed.size > 0) {
    w.text('Las firmas Elaboró, Revisó y Aprobó están estampadas dentro del documento, en la posición que ubicó el elaborador. Su trazabilidad está en el registro de firmas electrónicas del final.', { size: 9, color: MUTED, gap: 6 });
  }
  if (unplaced.length > 0) {
    w.text(placed.size > 0 ? 'Firmas sin ubicación en el documento' : 'Firmas', { size: 11, font: 'bold', gap: 4 });
    for (const s of unplaced) {
      w.row(s.meaningLabel, `${s.signerName ?? s.signerEmail} (${s.signerEmail}) · ${colombia(s.signedAt)} · Motivo: ${s.reason}`);
    }
  }
  w.y -= 10;
  w.text(
    'Firmado electrónicamente en SynerLink (Ley 527 de 1999, Decreto 2364 de 2012): cada firmante se reautenticó con su contraseña, indicó el significado y el motivo, y el sistema registró el sello de tiempo del servidor y la huella del contenido. El detalle está en el manifiesto de firmas al final del documento.',
    { size: 8.5, color: MUTED, gap: 4 }
  );
  w.text(`Verifique la vigencia y la integridad de esta versión en SynerLink (código QR de la portada o este enlace): ${m.verifyUrl}`, { size: 8.5, color: MUTED, gap: 2 });
  w.text(`Huella del manifiesto (SHA-256): ${mSha}`, { size: 8, font: 'mono', color: MUTED });
}

async function drawManifest(pdf: PDFDocument, w: Writer, m: SgcManifest, mSha: string, masters: Record<string, Uint8Array>) {
  w.text(m.placements?.length ? 'Registro de trazabilidad de firmas electrónicas' : 'Manifiesto de firmas electrónicas', { size: 14, font: 'bold', color: BRAND, gap: 2 });
  w.text(`${m.code} · Versión ${m.versionNumber} · Solicitud #${m.idRequest}`, { size: 9.5, color: MUTED, gap: 8 });
  w.rule();
  for (const s of m.signatures) {
    const png = masters[s.uid];
    w.ensure(png ? 190 : 150);
    w.text(`${s.meaningLabel} — ${s.signerName ?? s.signerEmail}`, { size: 11, font: 'bold', gap: 2 });
    if (png) {
      try {
        const img = await pdf.embedPng(png);
        const h = 38;
        const width = Math.min(160, (img.width / img.height) * h);
        w.page.drawImage(img, { x: MARGIN, y: w.y - h, width, height: h });
        w.y -= h + 6;
      } catch {
        // Un trazo ilegible no impide el PDF: la firma electrónica es el registro, no la imagen.
      }
    }
    w.row('Firmante', `${s.signerName ?? ''} <${s.signerEmail}>`.trim());
    w.row('Significado', s.meaningLabel);
    w.row('Sello de tiempo (servidor)', `${s.signedAt} UTC · ${colombia(s.signedAt)}`);
    w.row('Motivo', s.reason);
    w.row('Reautenticación', s.authMethod === 'contrasena_synerlink' ? 'Contraseña de SynerLink en el momento de firmar' : s.authMethod);
    w.row('Contenido firmado (SHA-256)', s.contentSha256);
    w.row('Registro de la firma (SHA-256)', s.recordHash);
    w.row('Identificador', s.uid);
    w.y -= 8;
  }
  w.text(`Huella del manifiesto (SHA-256): ${mSha}`, { size: 8, font: 'mono', color: MUTED, gap: 2 });
  w.text('La huella del PDF completo queda registrada en SynerLink; cualquier alteración del archivo invalida la verificación.', { size: 8, color: MUTED });
}

/** Estampa una firma electrónica dentro de su caja (trazo del maestro si existe, nombre, significado y fecha). */
async function drawPlacedSignature(pdf: PDFDocument, page: PDFPage, box: SgcRect, s: SgcManifestSignature, png: Uint8Array | undefined, fonts: Fonts) {
  page.drawRectangle({ x: box.x, y: box.y, width: box.width, height: box.height, borderColor: rgb(0.0, 0.19, 0.34), borderWidth: 0.4, opacity: 0, borderOpacity: 0.35 });
  const size = Math.max(4, Math.min(7, box.height / 6));
  const lines = [s.signerName ?? s.signerEmail, `${s.meaningLabel} · ${formatBogotaDateTime(new Date(s.signedAt))}`, 'Firma electrónica · SynerLink'];
  const textH = lines.length * (size + 1.5);
  const imgArea = box.height - textH - 3;
  let drewImage = false;
  if (png && imgArea > 6) {
    try {
      const img = await pdf.embedPng(png);
      const scale = Math.min((box.width - 4) / img.width, imgArea / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: box.x + (box.width - w) / 2, y: box.y + textH + 2 + (imgArea - h) / 2, width: w, height: h });
      drewImage = true;
    } catch {
      // Un trazo ilegible no impide la firma: la firma electrónica es el registro, no la imagen.
    }
  }
  if (!drewImage && imgArea > 6) {
    const name = toWinAnsiSafe(s.signerName ?? s.signerEmail);
    let nsize = Math.min(imgArea * 0.7, 14);
    while (nsize > 5 && fonts.italic.widthOfTextAtSize(name, nsize) > box.width - 4) nsize -= 0.5;
    page.drawText(name, { x: box.x + 2, y: box.y + textH + 2 + (imgArea - nsize) / 2, size: nsize, font: fonts.italic, color: rgb(0.05, 0.15, 0.4) });
  }
  let y = box.y + textH - size;
  lines.forEach((l, i) => {
    const font = i === 0 ? fonts.bold : fonts.regular;
    let t = toWinAnsiSafe(l);
    while (t.length > 1 && font.widthOfTextAtSize(t, size) > box.width - 3) t = t.slice(0, -1);
    page.drawText(t, { x: box.x + 1.5, y: y + 1, size, font, color: INK });
    y -= size + 1.5;
  });
}

export interface SgcControlledPdfOptions {
  /** Encabezado institucional del sistema (si el documento lo usa). */
  header?: SgcInstitutionalHeaderData | null;
}

/** Composición del PDF controlado que se guarda en sgc.document_version.layout_json. */
export interface SgcControlledLayout {
  institutionalHeader: boolean;
  /** Recuadro «Fecha de emisión» (página ABSOLUTA del PDF controlado, en puntos). */
  emission: (SgcRect & { page: number }) | null;
  placements: SgcManifestPlacement[];
}

/**
 * Arma el PDF controlado a partir del PDF del contenido aprobado. Devuelve
 * los bytes finales (a los que luego se les calcula el SHA-256).
 */
export async function buildControlledPdf(contentPdf: Uint8Array, manifest: SgcManifest, masters: Record<string, Uint8Array> = {}, options: SgcControlledPdfOptions = {}): Promise<Uint8Array> {
  return (await buildControlledPdfWithLayout(contentPdf, manifest, masters, options)).bytes;
}

/** Igual que buildControlledPdf, y además devuelve la composición (fecha de emisión y firmas ubicadas). */
export async function buildControlledPdfWithLayout(contentPdf: Uint8Array, manifest: SgcManifest, masters: Record<string, Uint8Array> = {}, options: SgcControlledPdfOptions = {}): Promise<{ bytes: Uint8Array; layout: SgcControlledLayout }> {
  const content = await PDFDocument.load(contentPdf, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await out.embedFont(StandardFonts.Helvetica),
    bold: await out.embedFont(StandardFonts.HelveticaBold),
    mono: await out.embedFont(StandardFonts.Courier),
    italic: await out.embedFont(StandardFonts.HelveticaOblique),
  };
  const mSha = manifestSha256(manifest);
  const runningHeader = `${manifest.company} · ${manifest.code} · Versión ${manifest.versionNumber} · Documento controlado`;

  const total = content.getPageCount();
  // Firmas DENTRO del documento: solo las cajas de firmas del manifiesto y de páginas que existen.
  const bySignature = new Map(manifest.signatures.map((s) => [s.uid, s]));
  const placements = (manifest.placements ?? []).filter((p) => bySignature.has(p.uid) && p.page >= 1 && p.page <= total);
  drawCover(new Writer(out, fonts, runningHeader), manifest, mSha, new Set(placements.map((p) => p.uid)));

  const copied = await out.copyPages(content, content.getPageIndices());
  const header = options.header ?? null;
  copied.forEach((page, i) => {
    out.addPage(page);
    const { width, height } = page.getSize();
    if (!header) {
      const top = toWinAnsiSafe(`${manifest.code} · Versión ${manifest.versionNumber} · ${manifest.title}`);
      let size = 7.5;
      while (size > 5 && fonts.regular.widthOfTextAtSize(top, size) > width - 40) size -= 0.5;
      page.drawText(top, { x: 20, y: height - 14, size, font: fonts.regular, color: MUTED });
      // Con encabezado institucional, la página x de y ya va en el encabezado (y el pie lo ocupa la marca de la copia controlada).
      page.drawText(toWinAnsiSafe(`Documento controlado · Página ${i + 1} de ${total}`), { x: 20, y: 8, size: 7, font: fonts.regular, color: MUTED });
    }
  });
  let emission: SgcControlledLayout['emission'] = null;
  if (header) {
    const drawn = await drawInstitutionalHeaders(out, copied, header, fonts);
    // El contenido empieza en la página 2 del PDF controlado (la 1 es la portada de control).
    if (drawn.emission) emission = { ...drawn.emission, page: 2 };
  }
  // Cada firma en la caja que ubicó el elaborador.
  for (const p of placements) {
    const page = copied[p.page - 1];
    const { width, height } = page.getSize();
    const box = { x: (p.x / 100) * width, y: height - ((p.y + p.height) / 100) * height, width: (p.width / 100) * width, height: (p.height / 100) * height };
    await drawPlacedSignature(out, page, box, bySignature.get(p.uid)!, masters[p.uid], fonts);
  }

  const w = new Writer(out, fonts, runningHeader);
  await drawManifest(out, w, manifest, mSha, masters);

  const json = canonicalJson(manifest);
  out.catalog.set(PDFName.of(SGC_MANIFEST_KEY), PDFHexString.fromText(json));
  await out.attach(new TextEncoder().encode(JSON.stringify(manifest, null, 2)), 'manifiesto-firmas.json', {
    mimeType: 'application/json',
    description: 'Manifiesto de firmas electrónicas del SGC (SynerLink)',
    creationDate: new Date(manifest.generatedAt),
    modificationDate: new Date(manifest.generatedAt),
  });
  out.setTitle(toWinAnsiSafe(`${manifest.code} V${manifest.versionNumber} — ${manifest.title}`));
  out.setSubject(toWinAnsiSafe(`Documento controlado · ${manifest.company}`));
  out.setKeywords(['SGC', manifest.code, `V${manifest.versionNumber}`, `manifiesto:${mSha}`]);
  out.setProducer('SynerLink — SGC documental (PDF controlado)');
  out.setCreator('SynerLink — SGC documental');
  out.setCreationDate(new Date(manifest.generatedAt));
  out.setModificationDate(new Date(manifest.generatedAt));
  const bytes = await out.save({ useObjectStreams: false });
  return { bytes, layout: { institutionalHeader: Boolean(header), emission, placements } };
}

/** Lee el manifiesto incrustado en un PDF controlado (null si no lo tiene o no es válido). */
export async function readManifest(pdfBytes: Uint8Array): Promise<SgcManifest | null> {
  try {
    const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true, updateMetadata: false });
    const raw = pdf.catalog.lookup(PDFName.of(SGC_MANIFEST_KEY));
    if (!(raw instanceof PDFHexString) && !(raw instanceof PDFString)) return null;
    const parsed = JSON.parse(raw.decodeText()) as SgcManifest;
    return parsed?.schema === SGC_MANIFEST_SCHEMA ? parsed : null;
  } catch {
    return null;
  }
}

export interface SgcPdfVerification {
  ok: boolean;
  pdfSha256: string;
  pdfMatches: boolean;
  manifestFound: boolean;
  manifestSha256: string | null;
  manifestMatches: boolean;
  signatures: { uid: string; meaningLabel: string; signer: string; ok: boolean; problem: string | null }[];
  problems: string[];
}

/**
 * Verifica un PDF controlado: (1) su SHA-256 coincide con el registrado,
 * (2) trae el manifiesto y coincide con el guardado en la base, (3) cada firma
 * del manifiesto existe en sgc.signature con el mismo registro (record_hash
 * íntegro) y sobre el mismo contenido. Función pura: la base entrega los datos.
 */
export async function verifyControlledPdf(
  pdfBytes: Uint8Array,
  expected: { pdfSha256: string; manifestJson: string | null; signatures: { uid: string; recordHash: string; contentSha256: string; intact: boolean }[] }
): Promise<SgcPdfVerification> {
  const problems: string[] = [];
  const pdfSha256 = sha256HexOf(pdfBytes);
  const pdfMatches = pdfSha256 === expected.pdfSha256.trim().toLowerCase();
  if (!pdfMatches) problems.push('El PDF no coincide con la huella SHA-256 registrada: fue alterado o no es el oficial.');
  const manifest = await readManifest(pdfBytes);
  if (!manifest) problems.push('El PDF no trae el manifiesto de firmas del SGC.');
  const stored = expected.manifestJson ? (JSON.parse(expected.manifestJson) as SgcManifest) : null;
  const mSha = manifest ? manifestSha256(manifest) : null;
  const manifestMatches = Boolean(manifest && stored && mSha === manifestSha256(stored));
  if (manifest && !manifestMatches) problems.push('El manifiesto del PDF no coincide con el registrado en SynerLink.');
  const byUid = new Map(expected.signatures.map((s) => [s.uid.trim(), s]));
  const accepted = manifest ? acceptedContentHashes(manifest) : new Set<string>();
  const signatures = (manifest?.signatures ?? []).map((s) => {
    const db = byUid.get(s.uid);
    let problem: string | null = null;
    if (!db) problem = 'La firma no existe en el registro de firmas del SGC.';
    else if (!db.intact) problem = 'El registro de la firma fue alterado (su huella no coincide).';
    else if (db.recordHash.trim() !== s.recordHash) problem = 'El registro de la firma no coincide con el del PDF.';
    else if (db.contentSha256.trim() !== s.contentSha256 || !accepted.has(s.contentSha256)) problem = 'La firma no corresponde al contenido del documento.';
    if (problem) problems.push(`${s.meaningLabel} (${s.signerEmail}): ${problem}`);
    return { uid: s.uid, meaningLabel: s.meaningLabel, signer: s.signerName ?? s.signerEmail, ok: !problem, problem };
  });
  if (manifest && signatures.length === 0) problems.push('El manifiesto no tiene firmas.');
  return { ok: problems.length === 0, pdfSha256, pdfMatches, manifestFound: Boolean(manifest), manifestSha256: mSha, manifestMatches, signatures, problems };
}
