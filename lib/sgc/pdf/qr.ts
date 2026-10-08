import qrcode from 'qrcode-generator';
import { rgb, type PDFPage } from 'pdf-lib';
import { SgcError } from '../errors';

/**
 * CÓDIGO QR de verificación del PDF controlado (Sprint 4, pendiente del S3).
 *
 * El QR lleva a la página de verificación del SGC en SynerLink
 * (/process/sgc-documental/verificar), que confirma si ESA versión del
 * documento sigue vigente, ya es obsoleta o fue anulada. Se dibuja como
 * vector (un rectángulo por módulo) con pdf-lib: nítido al imprimir y sin
 * imágenes incrustadas. Librería: qrcode-generator (MIT, sin dependencias).
 * Corrección de errores M (15 %), suficiente para una hoja impresa.
 */

/** URL de verificación de una versión (la abre el QR; exige iniciar sesión en SynerLink). */
export function buildVerifyUrl(appUrl: string, idCompany: number, code: string, versionNumber: number): string {
  const base = appUrl.replace(/\/+$/, '');
  return `${base}/process/sgc-documental/verificar?empresa=${idCompany}&codigo=${encodeURIComponent(code)}&version=${versionNumber}`;
}

/** Matriz del QR: true = módulo oscuro. */
export function qrMatrix(text: string): boolean[][] {
  if (!text || text.length > 1200) throw new SgcError('Texto inválido para el código QR.', 500);
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/**
 * Dibuja el QR en la página: (x, y) es la esquina inferior izquierda y `size`
 * el lado total en puntos, incluida la zona blanca de 4 módulos que exige el
 * estándar para que los lectores lo reconozcan.
 */
export function drawQr(page: PDFPage, text: string, opts: { x: number; y: number; size: number }): { modules: number } {
  const m = qrMatrix(text);
  const n = m.length;
  const quiet = 4;
  const cell = opts.size / (n + quiet * 2);
  page.drawRectangle({ x: opts.x, y: opts.y, width: opts.size, height: opts.size, color: rgb(1, 1, 1) });
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!m[r][c]) continue;
      page.drawRectangle({
        x: opts.x + (quiet + c) * cell,
        // pdf-lib mide desde abajo: la fila 0 del QR va arriba.
        y: opts.y + opts.size - (quiet + r + 1) * cell,
        // Un poco más ancho que la celda para que no queden líneas finas entre módulos.
        width: cell + 0.05,
        height: cell + 0.05,
        color: rgb(0, 0, 0),
      });
    }
  }
  return { modules: n };
}
