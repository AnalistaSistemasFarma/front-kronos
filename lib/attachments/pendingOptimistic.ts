/**
 * Caché durable de adjuntos OneDrive por solicitud.
 * Sobrevive refresh/remount sin “inventar” archivos ya borrados.
 */

export type CachedAttachment = {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  webUrl?: string;
  '@microsoft.graph.downloadUrl'?: string;
};

const pendingKey = (requestId: number | string) => `pending-od-attachments-${requestId}`;
const cacheKey = (requestId: number | string) => `od-attachments-cache-${requestId}`;

function canUseStorage(): boolean {
  return typeof window !== 'undefined';
}

function readJsonArray<T>(key: string): T[] {
  if (!canUseStorage()) return [];
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as T[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJsonArray(key: string, value: unknown[]): void {
  if (!canUseStorage()) return;
  try {
    if (value.length === 0) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota */
  }
}

function mergeById(...groups: CachedAttachment[][]): CachedAttachment[] {
  const byId = new Map<string, CachedAttachment>();
  for (const group of groups) {
    for (const f of group) {
      const id = String(f?.id || '');
      if (id) byId.set(id, f);
    }
  }
  return Array.from(byId.values());
}

function isRecent(file: CachedAttachment, maxMs = 120_000): boolean {
  const ts = file.lastModifiedDateTime ? Date.parse(file.lastModifiedDateTime) : 0;
  return Boolean(ts) && Date.now() - ts < maxMs;
}

export function readPendingAttachments(requestId: number | string): CachedAttachment[] {
  return readJsonArray<CachedAttachment>(pendingKey(requestId)).filter(
    (f) => Boolean(f?.id) && isRecent(f, 300_000)
  );
}

export function rememberPendingAttachment(
  requestId: number | string,
  file: CachedAttachment
): void {
  if (!file?.id) return;
  const prev = readPendingAttachments(requestId);
  const next = [...prev.filter((f) => String(f.id) !== String(file.id)), file];
  writeJsonArray(pendingKey(requestId), next);
  writeAttachmentCache(requestId, mergeById(readAttachmentCache(requestId), [file]));
}

export function clearPendingAttachmentIds(
  requestId: number | string,
  confirmedIds: Iterable<string>
): void {
  const confirmed = new Set(Array.from(confirmedIds, String));
  if (confirmed.size === 0) return;
  writeJsonArray(
    pendingKey(requestId),
    readPendingAttachments(requestId).filter((f) => !confirmed.has(String(f.id)))
  );
}

export function readAttachmentCache(requestId: number | string): CachedAttachment[] {
  return readJsonArray<CachedAttachment>(cacheKey(requestId)).filter((f) => Boolean(f?.id));
}

export function writeAttachmentCache(
  requestId: number | string,
  files: CachedAttachment[]
): void {
  writeJsonArray(
    cacheKey(requestId),
    files.filter((f) => Boolean(f?.id))
  );
}

export function removeFromAttachmentCache(
  requestId: number | string,
  fileId: string
): void {
  const id = String(fileId || '');
  if (!id) return;
  writeAttachmentCache(
    requestId,
    readAttachmentCache(requestId).filter((f) => String(f.id) !== id)
  );
  writeJsonArray(
    pendingKey(requestId),
    readPendingAttachments(requestId).filter((f) => String(f.id) !== id)
  );
}

/**
 * @param listed `null` = el fetch falló (conservar caché). Array (aunque vacío) = verdad de OneDrive.
 */
export function mergeListedWithPending<T extends CachedAttachment>(
  requestId: number | string,
  listed: T[] | null,
  localPrev: T[] = []
): T[] {
  const pending = readPendingAttachments(requestId) as T[];

  if (listed === null) {
    return mergeById(localPrev, pending, readAttachmentCache(requestId)) as T[];
  }

  const listedIds = new Set(listed.map((f) => String(f.id)));
  const recentExtras = [...localPrev, ...pending].filter((f) => {
    const id = String(f?.id || '');
    return id && !listedIds.has(id) && isRecent(f, 120_000);
  }) as T[];

  const merged = mergeById(listed, recentExtras) as T[];
  writeAttachmentCache(requestId, merged);
  clearPendingAttachmentIds(
    requestId,
    listed.map((f) => String(f.id))
  );
  return merged;
}

export function hydrateAttachments(requestId: number | string): CachedAttachment[] {
  return mergeById(readAttachmentCache(requestId), readPendingAttachments(requestId));
}
