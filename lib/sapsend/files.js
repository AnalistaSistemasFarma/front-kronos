import { sql, withMssqlPool } from '../mssqlPool';
import { useGetMicrosoftToken } from '../../components/microsoft-365/useGetMicrosoftToken';
import { SAPSEND_URL, SYNERLINK_API_KEY, notifySapsendFailure } from './config.js';
import { syncRequestToSapsend } from './treasury.js';

// Reenvía a SAPSEND los adjuntos de una solicitud. Los archivos viven en OneDrive
// (SAPSEND/TEC/SG/Request-{id}); el servidor los lee con Graph (client-credentials) y los reenvía
// en multipart a POST /api/synerlink/files. Idempotente: SAPSEND reemplaza por nombre.

const FILES_ENDPOINT = `${SAPSEND_URL}/api/synerlink/files`;
const GRAPH = (process.env.MICROSOFTGRAPHUSERROUTE || '').toString();

// Extensiones y límites que acepta SAPSEND (más restrictivo que el uploader de la app).
const ALLOWED_EXT = new Set(['pdf', 'txt', 'xlsx', 'jpg', 'jpeg', 'png']);
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_FILES_PER_REQUEST = 20;

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Asegura que el caso exista en SAPSEND; devuelve id_treasury_requests o null.
async function ensureCaseCreated(requestId) {
  const read = () =>
    withMssqlPool(async (pool) => {
      const r = await pool
        .request()
        .input('id', sql.Int, requestId)
        .query(`SELECT id_treasury_requests FROM requests_general WHERE id = @id`);
      return r.recordset[0]?.id_treasury_requests ?? null;
    });

  let idTreasury = await read();
  if (idTreasury != null) return idTreasury;

  // Aún no sincronizado (p. ej. archivos justo tras crear): intentar crear el caso.
  await syncRequestToSapsend(requestId);
  idTreasury = await read();
  return idTreasury;
}

async function listOneDriveFiles(token, requestId) {
  const url = `${GRAPH}root:/SAPSEND/TEC/SG/Request-${requestId}:/children`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return []; // carpeta inexistente = sin archivos
  if (!res.ok) throw new Error(`No se pudo listar OneDrive (HTTP ${res.status})`);
  const data = await res.json();
  return (data.value || []).filter((it) => it.file); // solo archivos, no carpetas
}

async function downloadFile(item) {
  const downloadUrl = item['@microsoft.graph.downloadUrl'];
  if (!downloadUrl) return null;
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`No se pudo descargar ${item.name} (HTTP ${res.status})`);
  const buf = await res.arrayBuffer();
  return new Blob([buf], { type: item.file?.mimeType || 'application/octet-stream' });
}

async function postFilesBatch(requestId, files) {
  const form = new FormData();
  form.append('id', String(requestId));
  for (const f of files) form.append('files', f.blob, f.name);

  // Sin Content-Type manual: fetch pone el boundary del multipart.
  const res = await fetch(FILES_ENDPOINT, {
    method: 'POST',
    headers: { 'x-api-key': SYNERLINK_API_KEY },
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  const rawText = await res.text().catch(() => '');
  let body = null;
  try {
    body = rawText ? JSON.parse(rawText) : null;
  } catch {
    /* no-JSON */
  }
  return { httpStatus: res.status, ok: res.ok, body, rawText };
}

async function setFilesResult(requestId, error) {
  await withMssqlPool((pool) =>
    pool
      .request()
      .input('id', sql.Int, requestId)
      .input('error', sql.NVarChar(500), error ?? null)
      .query(`
        UPDATE requests_general
        SET sapsend_files_synced_at = GETDATE(), sapsend_files_error = @error
        WHERE id = @id
      `)
  );
}

/**
 * Reenvía los adjuntos de la solicitud a SAPSEND. Nunca lanza.
 * @param {number} requestId  id de requests_general
 */
export async function sendFilesToSapsend(requestId) {
  const id = Number(requestId);
  try {
    const idTreasury = await ensureCaseCreated(id);
    if (idTreasury == null) {
      // El caso todavía no existe en SAPSEND; el botón/reintento lo puede reintentar luego.
      return { ok: false, pending: true };
    }

    const token = await useGetMicrosoftToken();
    if (!token) throw new Error('No se pudo obtener el token de Microsoft Graph');

    const items = await listOneDriveFiles(token, id);

    // Filtrar por extensión y tamaño.
    const skipped = [];
    const usable = [];
    for (const it of items) {
      const ext = extOf(it.name);
      if (!ALLOWED_EXT.has(ext)) {
        skipped.push(`${it.name} (extensión no permitida)`);
        continue;
      }
      if ((it.size ?? 0) > MAX_FILE_BYTES) {
        skipped.push(`${it.name} (> 10MB)`);
        continue;
      }
      usable.push(it);
    }
    if (skipped.length) console.log('[sapsend] files omitidos:', skipped.join(', '));

    if (usable.length === 0) {
      await setFilesResult(id, skipped.length ? `Omitidos: ${skipped.join(', ')}` : null);
      return { ok: true, sent: 0, skipped };
    }

    // Descargar bytes.
    const prepared = [];
    for (const it of usable) {
      const blob = await downloadFile(it);
      if (blob) prepared.push({ name: it.name, blob });
    }

    // Enviar en lotes de ≤20, con un reintento solo de los fallidos (failed[]).
    const failedNames = [];
    for (const batch of chunk(prepared, MAX_FILES_PER_REQUEST)) {
      let toSend = batch;
      for (let attempt = 0; attempt < 2 && toSend.length > 0; attempt++) {
        const result = await postFilesBatch(id, toSend);
        if (result.httpStatus === 404) {
          // El caso no está creado en SAPSEND: marcar pending para reintento.
          return { ok: false, pending: true };
        }
        if (!result.ok && result.httpStatus < 500) {
          // 4xx (no 404): no reintentar este lote.
          toSend.forEach((f) => failedNames.push(f.name));
          toSend = [];
          break;
        }
        const failed = Array.isArray(result.body?.failed) ? result.body.failed : [];
        if (result.ok && failed.length === 0) {
          toSend = [];
          break;
        }
        // Reintentar solo los nombres marcados como fallidos (o todo el lote si 5xx sin detalle).
        const failedSet = new Set(
          failed.map((f) => (typeof f === 'string' ? f : f?.name)).filter(Boolean)
        );
        toSend =
          failedSet.size > 0 ? toSend.filter((f) => failedSet.has(f.name)) : result.ok ? [] : toSend;
        if (attempt === 1 && toSend.length) toSend.forEach((f) => failedNames.push(f.name));
      }
    }

    const errParts = [];
    if (failedNames.length) errParts.push(`Fallidos: ${failedNames.join(', ')}`);
    if (skipped.length) errParts.push(`Omitidos: ${skipped.join(', ')}`);
    await setFilesResult(id, errParts.length ? errParts.join(' · ') : null);

    if (failedNames.length) {
      await notifySapsendFailure(
        id,
        'Archivos no enviados a SAPSEND · SynerLink',
        `No se pudieron enviar: ${failedNames.join(', ')}`
      );
      return { ok: false, sent: prepared.length - failedNames.length, failed: failedNames, skipped };
    }
    return { ok: true, sent: prepared.length, skipped };
  } catch (err) {
    console.error('[sapsend] sendFilesToSapsend error:', err);
    try {
      await setFilesResult(id, err?.message || 'Error inesperado al enviar archivos');
    } catch {
      /* best-effort */
    }
    return { ok: false, error: err?.message };
  }
}
