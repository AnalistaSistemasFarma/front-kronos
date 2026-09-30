import type { SgcContentKind, SgcSignedContent } from '../signature/record';

/**
 * ¿Cuál es el BORRADOR VIGENTE de una solicitud (lo que se firma y lo que se
 * convierte en el PDF controlado)? — función PURA.
 *
 * El elaborador puede cargar el borrador como archivo (Word o PDF) o editarlo
 * en la app (cada guardado es una revisión nueva). Manda el MÁS RECIENTE de
 * los dos: el último adjunto «borrador» no retirado o la última revisión del
 * editor. El borrador solo cambia durante la Elaboración; una devolución abre
 * una ronda nueva y las firmas anteriores quedan sobre el contenido anterior.
 */

export type SgcDraftFormat = 'pdf' | 'docx' | 'doc' | 'html';

export interface SgcCurrentDraft extends SgcSignedContent {
  format: SgcDraftFormat;
  at: Date;
  /** Adjunto: id del item en OneDrive (para descargarlo y verificarlo). */
  itemId: string | null;
}

export interface SgcDraftAttachmentRow {
  id_attachment: number;
  purpose: string;
  file_name: string;
  item_id: string;
  sha256: string;
  created_at: Date;
  withdrawn_at: Date | null;
}

export interface SgcDraftRevisionRow {
  id_draft_revision: number;
  revision_number: number;
  sha256: string;
  saved_at: Date;
}

export function draftFormatOf(fileName: string): SgcDraftFormat | null {
  const n = fileName.toLowerCase();
  if (n.endsWith('.pdf')) return 'pdf';
  if (n.endsWith('.docx')) return 'docx';
  if (n.endsWith('.doc')) return 'doc';
  return null;
}

export function pickCurrentDraft(attachments: readonly SgcDraftAttachmentRow[], revisions: readonly SgcDraftRevisionRow[]): SgcCurrentDraft | null {
  const att = attachments
    .filter((a) => a.purpose === 'borrador' && !a.withdrawn_at)
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || b.id_attachment - a.id_attachment)[0];
  const rev = [...revisions].sort((a, b) => b.revision_number - a.revision_number)[0];
  const fromAtt: SgcCurrentDraft | null = att
    ? {
        kind: 'borrador_adjunto' as SgcContentKind,
        ref: `adjunto:${att.id_attachment}`,
        name: att.file_name,
        sha256: att.sha256.trim().toLowerCase(),
        format: draftFormatOf(att.file_name) ?? 'pdf',
        at: att.created_at,
        itemId: att.item_id,
      }
    : null;
  const fromRev: SgcCurrentDraft | null = rev
    ? {
        kind: 'borrador_editor' as SgcContentKind,
        ref: `revision:${rev.id_draft_revision}`,
        name: `Borrador editado en la app · revisión ${rev.revision_number}`,
        sha256: rev.sha256.trim().toLowerCase(),
        format: 'html',
        at: rev.saved_at,
        itemId: null,
      }
    : null;
  if (!fromAtt) return fromRev;
  if (!fromRev) return fromAtt;
  return fromRev.at.getTime() >= fromAtt.at.getTime() ? fromRev : fromAtt;
}

/** Error si el borrador no sirve para generar el PDF controlado (se valida al enviarlo a revisión). */
export function getDraftForSubmitError(draft: SgcCurrentDraft | null): string | null {
  if (!draft) return 'Cargue el borrador del documento (Word o PDF) o edítelo en la app antes de enviarlo.';
  if (draft.format === 'doc') return 'El borrador vigente es un Word antiguo (.doc): guárdelo como .docx o PDF para poder generar el PDF controlado.';
  return null;
}
