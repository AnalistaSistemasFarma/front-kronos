import { NextResponse } from 'next/server';
import { useGetMicrosoftToken as getMicrosoftToken } from '@/components/microsoft-365/useGetMicrosoftToken';
import { oneDriveRoot } from '@/lib/onedrive/root';
import { ensureFolderAndUploadFile } from '@/lib/onedrive/graphFolderUpload';
import { sanitizeOneDriveName } from '@/lib/onedriveName';
import { canManageWorkflows, taskProcessOf } from '../../../../lib/workflow-doc/access';
import { DOC_TEMPLATES_FOLDER, DocTemplateError, loadProcessFields } from '../../../../lib/workflow-doc/engine';
import { buildMarkerCatalog } from '../../../../lib/workflow-doc/fields';
import { prepareSource } from '../../../../lib/workflow-doc/sources';
import { fail, sessionEmail } from '../_shared';

const MAX_BYTES = 15 * 1024 * 1024;

/**
 * POST multipart { id_task, engine: editor|word, file: .docx }
 * Guarda el Word en OneDrive (TEC/PLANTILLAS-FLUJOS/<id_process_category>/) y devuelve:
 *  - motor editor: el HTML (mammoth) con las marcas «@{…}» que resuelven ya convertidas;
 *  - motor word: las marcas «@{…}» detectadas y cuáles resuelven.
 * No guarda la configuración (eso lo hace PUT task-template).
 */
export async function POST(req: Request) {
  try {
    const email = await sessionEmail();
    if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!(await canManageWorkflows(email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const form = await req.formData();
    const task = await taskProcessOf(Number(form.get('id_task')));
    if (!task) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 });
    const engine = form.get('engine') === 'word' ? 'word' : 'editor';
    const file = form.get('file');
    if (!(file instanceof Blob)) throw new DocTemplateError('Adjunte el Word de la plantilla.');
    const name = typeof (file as File).name === 'string' ? (file as File).name : 'plantilla.docx';
    if (!/\.docx$/i.test(name)) throw new DocTemplateError('La plantilla debe ser un archivo .docx.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) throw new DocTemplateError('El archivo está vacío o supera 15 MB.');

    const markers = buildMarkerCatalog(await loadProcessFields(task.id_process_category));
    // Se valida antes de subir: un Word con marcas mal escritas no se guarda.
    const prepared = await prepareSource(bytes, 'docx', engine, markers);

    const token = await getMicrosoftToken();
    if (!token) throw new DocTemplateError('No se pudo obtener el token de OneDrive.', 502);
    const fileName = `${task.id}-${Date.now()}-${sanitizeOneDriveName(name) || 'plantilla.docx'}`;
    const item = await ensureFolderAndUploadFile(
      token,
      [oneDriveRoot(), 'TEC', DOC_TEMPLATES_FOLDER, String(task.id_process_category)],
      fileName,
      new Blob([bytes as BlobPart]),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    return NextResponse.json({ ok: true, source_item_id: String(item.id), source_file_name: name, ...prepared });
  } catch (e) {
    return fail(e, 'upload-template');
  }
}
