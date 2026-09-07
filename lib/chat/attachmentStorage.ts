/**
 * ADJUNTOS del chat — la parte que habla con Microsoft Graph.
 *
 * Está separada de lib/chat/attachments.ts (que es isomórfico y lo importa
 * también el compositor del navegador) porque aquí sí se importan cosas de
 * servidor: el token de la aplicación en Azure y el helper de OneDrive. Si
 * todo viviera en un solo archivo, importar una constante desde un componente
 * cliente arrastraría el secreto de Graph al bundle.
 */
import {
  buildChatAttachmentFolderSegments,
  buildStoredAttachmentName,
  type ChatAttachmentCandidate,
} from './attachments';
import { useGetMicrosoftToken as getMicrosoftToken } from '../../components/microsoft-365/useGetMicrosoftToken';
import { ensureFolderAndUploadFile } from '../onedrive/graphFolderUpload';

/* ──────────────────────────── Subida a OneDrive ───────────────────────── */

/** Lo que queda listo para insertar en `chat_attachment`. */
export interface UploadedChatAttachment {
  file_name: string;
  content_type: string | null;
  size_bytes: number;
  onedrive_item_id: string;
  web_url: string | null;
}

/**
 * Sube los adjuntos de un mensaje a OneDrive y devuelve las filas listas para
 * crearse junto con el mensaje.
 *
 * ORDEN DELIBERADO (el mismo del SGD, lib/document-management/newVersion.ts):
 * primero OneDrive —que es una operación externa y NO transaccional— y solo si
 * todo salió bien se escribe en la base, dentro de una única transacción con el
 * mensaje. Si algo aquí falla, esta función lanza y la ruta responde error sin
 * haber creado el mensaje: `chat_attachment.id_message` es NOT NULL y no
 * queremos filas huérfanas ni mensajes a medias.
 *
 * Contrapartida asumida: si el tercer archivo falla, los dos primeros quedan
 * subidos en OneDrive sin referencia en la base. Es basura inerte —nadie puede
 * llegar a ella desde la aplicación— y es exactamente el mismo compromiso que
 * ya acepta el SGD. La alternativa (borrarlos por Graph en el camino de error)
 * agrega llamadas que también pueden fallar.
 */
export async function uploadChatAttachments(
  conversationId: number,
  files: ChatAttachmentCandidate[],
  at: Date = new Date()
): Promise<UploadedChatAttachment[]> {
  if (files.length === 0) return [];

  const token = await getMicrosoftToken();
  if (!token) throw new Error('No se pudo obtener el token de Microsoft Graph');

  const segments = buildChatAttachmentFolderSegments(conversationId, at);
  const uploaded: UploadedChatAttachment[] = [];

  for (const file of files) {
    const storedName = buildStoredAttachmentName(file.fileName);
    const item = await ensureFolderAndUploadFile(
      token,
      segments,
      storedName,
      file.blob,
      file.contentType ?? undefined
    );

    uploaded.push({
      file_name: file.fileName,
      content_type: file.contentType,
      size_bytes: file.size,
      onedrive_item_id: item.id,
      web_url: typeof item.webUrl === 'string' ? item.webUrl : null,
    });
  }

  return uploaded;
}

/* ─────────────────────────── Descarga desde Graph ─────────────────────── */

export interface ChatAttachmentContent {
  /** Cuerpo en streaming, tal como lo entrega Graph. */
  stream: ReadableStream<Uint8Array> | null;
  contentLength: string | null;
}

/**
 * Descarga el contenido de un adjunto desde OneDrive por su `onedrive_item_id`.
 *
 * Devuelve el STREAM, no un Buffer: un archivo de 25 MB no tiene por qué pasar
 * entero por la memoria del proceso para reenviarse. `fetch` sigue por su
 * cuenta el 302 que Graph responde hacia la URL preautenticada, así que esa URL
 * jamás sale del servidor — que es justo lo que se quiere: si se le devolviera
 * al navegador, cualquiera con ese enlace bajaría el archivo sin sesión.
 */
export async function downloadChatAttachment(
  onedriveItemId: string
): Promise<ChatAttachmentContent | null> {
  const graphBase = (process.env.MICROSOFTGRAPHUSERROUTE || '').toString();
  if (!graphBase) {
    console.error('[chat/attachments] MICROSOFTGRAPHUSERROUTE no está configurado.');
    return null;
  }

  const token = await getMicrosoftToken();
  if (!token) return null;

  const response = await fetch(`${graphBase}items/${encodeURIComponent(onedriveItemId)}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    console.error(
      `[chat/attachments] no se pudo descargar el item ${onedriveItemId} de OneDrive (HTTP ${response.status})`
    );
    return null;
  }

  return {
    stream: response.body,
    contentLength: response.headers.get('content-length'),
  };
}
