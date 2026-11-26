import { describe, expect, it } from 'vitest';
import { wordByMicrosoft } from '../db/bulkUpload';
import type { SgcDb } from '../db/catalogs';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const WORD = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
const db = (root: string | null) => ({ sgcCompanyConfig: { findUnique: async () => (root ? { storage_root: root } : null) } }) as unknown as SgcDb;
const base = { docxToHtml: async () => '', htmlToPdf: async () => new Uint8Array() };

describe('SGC · Word de la carga inicial convertido por Microsoft (2026-11-23)', () => {
  it('[SGC-REQ-165] el Word va tal cual a Microsoft, en la raíz de la empresa, y se usa su PDF', async () => {
    const calls: [string, string, Uint8Array][] = [];
    const pdf = await wordByMicrosoft(db('SGC/OLP'), 3, { ...base, officeToPdf: async (root, name, bytes) => (calls.push([root, name, bytes]), PDF) }, 'OLP-GCC-05-PR.docx', WORD);
    expect(pdf).toBe(PDF);
    expect(calls).toEqual([['SGC/OLP', 'OLP-GCC-05-PR.docx', WORD]]);
  });

  it('[SGC-REQ-165] sin conversor, sin raíz, si Microsoft falla o no devuelve un PDF: null (queda la conversión de SynerLink)', async () => {
    expect(await wordByMicrosoft(db('SGC/OLP'), 3, base, 'A.docx', WORD)).toBeNull();
    expect(await wordByMicrosoft(db(null), 3, { ...base, officeToPdf: async () => PDF }, 'A.docx', WORD)).toBeNull();
    expect(await wordByMicrosoft(db('SGC/OLP'), 3, { ...base, officeToPdf: async () => Promise.reject(new Error('Graph caído')) }, 'A.docx', WORD)).toBeNull();
    expect(await wordByMicrosoft(db('SGC/OLP'), 3, { ...base, officeToPdf: async () => new Uint8Array([1, 2, 3]) }, 'A.docx', WORD)).toBeNull();
  });
});
