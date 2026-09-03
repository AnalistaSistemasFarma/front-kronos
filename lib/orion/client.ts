import { getOrionConfig } from './config';
import type {
  OrionAssignSignersPayload,
  OrionCreateDocumentPayload,
  OrionDocumentResponse,
} from './types';

/** Convierte rutas relativas de Orion en URL absoluta usando ORION_API_BASE_URL. */
export function resolveOrionAbsoluteUrl(urlOrPath: string | null | undefined): string | null {
  const value = String(urlOrPath || '').trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const { apiBaseUrl } = getOrionConfig();
  if (!apiBaseUrl) return null;
  return `${apiBaseUrl}${value.startsWith('/') ? value : `/${value}`}`;
}

/** URL canónica del PDF firmado en Orion (preferida sobre signedFileUrl almacenado). */
export function buildOrionSignedFileApiUrl(orionDocumentId: string): string | null {
  const id = String(orionDocumentId || '').trim();
  if (!id) return null;
  return resolveOrionAbsoluteUrl(
    `/api/integrations/synerlink/documents/${encodeURIComponent(id)}/signed-file`
  );
}

async function orionFetch<T>(
  path: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  const cfg = getOrionConfig();
  if (!cfg.apiBaseUrl || !cfg.integrationApiKey) {
    return {
      ok: false,
      status: 503,
      data: null,
      error: 'Integración Orion no configurada (ORION_API_BASE_URL / INTEGRATION_API_KEYS)',
    };
  }

  const url = `${cfg.apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.integrationApiKey}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });

  const text = await res.text();
  let data: T | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const errBody = data as { error?: string; message?: string } | null;
    return {
      ok: false,
      status: res.status,
      data,
      error: errBody?.error || errBody?.message || text || res.statusText,
    };
  }

  return { ok: true, status: res.status, data };
}

export async function getOrionDocumentByRef(
  externalRef: string
): Promise<{ ok: boolean; status: number; data: OrionDocumentResponse | null; error?: string }> {
  const encoded = encodeURIComponent(externalRef);
  return orionFetch<OrionDocumentResponse>(
    `/api/integrations/synerlink/documents/by-ref?externalRef=${encoded}`,
    { method: 'GET' }
  );
}

export async function createOrionDocument(
  payload: OrionCreateDocumentPayload
): Promise<{ ok: boolean; status: number; data: OrionDocumentResponse | null; error?: string }> {
  return orionFetch<OrionDocumentResponse>('/api/integrations/synerlink/documents', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getOrionDocument(
  orionDocumentId: string
): Promise<{ ok: boolean; status: number; data: OrionDocumentResponse | null; error?: string }> {
  return orionFetch<OrionDocumentResponse>(
    `/api/integrations/synerlink/documents/${encodeURIComponent(orionDocumentId)}`,
    { method: 'GET' }
  );
}

export async function assignOrionSigners(
  orionDocumentId: string,
  payload: OrionAssignSignersPayload
): Promise<{ ok: boolean; status: number; data: OrionDocumentResponse | null; error?: string }> {
  return orionFetch<OrionDocumentResponse>(
    `/api/integrations/synerlink/documents/${encodeURIComponent(orionDocumentId)}/signers`,
    { method: 'POST', body: JSON.stringify(payload) }
  );
}

export async function sendOrionDocument(
  orionDocumentId: string
): Promise<{ ok: boolean; status: number; data: OrionDocumentResponse | null; error?: string }> {
  return orionFetch<OrionDocumentResponse>(
    `/api/integrations/synerlink/documents/${encodeURIComponent(orionDocumentId)}/send`,
    { method: 'POST', body: JSON.stringify({}) }
  );
}

/** Firmante interno acepta y aplica su rúbrica guardada (sin embed de gestión). */
export async function acceptOrionSignerTurn(
  orionDocumentId: string,
  email: string
): Promise<{ ok: boolean; status: number; data: OrionDocumentResponse | null; error?: string }> {
  return orionFetch<OrionDocumentResponse>(
    `/api/integrations/synerlink/documents/${encodeURIComponent(orionDocumentId)}/accept-sign`,
    {
      method: 'POST',
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    }
  );
}

export async function getOrionSignatureEmbedUrl(
  email: string
): Promise<{ ok: boolean; status: number; data: { embedUrl: string; email: string } | null; error?: string }> {
  const encoded = encodeURIComponent(email.trim().toLowerCase());
  return orionFetch<{ embedUrl: string; email: string }>(
    `/api/integrations/synerlink/embed/signature-url?email=${encoded}`,
    { method: 'GET' }
  );
}

export async function loadOrionUserSignature(email: string) {
  const encoded = encodeURIComponent(email.trim().toLowerCase());
  const result = await orionFetch<{
    dataUrl?: string | null;
    method?: string | null;
    hasSignature?: boolean;
    code?: string;
    error?: string;
  }>(`/api/integrations/synerlink/user-signature?email=${encoded}`, { method: 'GET' });

  if (!result.ok) return result;

  return {
    ...result,
    data: {
      dataUrl: result.data?.dataUrl ?? null,
      method: result.data?.method ?? null,
    },
  };
}

export async function saveOrionUserSignature(
  email: string,
  signatureDataUrl: string,
  method: 'drawn' | 'uploaded' = 'drawn'
) {
  const encoded = encodeURIComponent(email.trim().toLowerCase());
  return orionFetch<{ ok: boolean; skipped?: boolean; code?: string; error?: string }>(
    `/api/integrations/synerlink/user-signature?email=${encoded}`,
    {
      method: 'POST',
      body: JSON.stringify({ signatureDataUrl, method }),
    }
  );
}

type OrionSignatureFieldInput = {
  id: string;
  signerOrder: number;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
};

/** Persiste recuadros de firma en Orion (embed API + token). */
export async function saveOrionSignatureFields(params: {
  orionDocumentId: string;
  embedToken: string;
  signatureFields: OrionSignatureFieldInput[];
}): Promise<{ ok: boolean; status: number; data: OrionDocumentResponse | null; error?: string }> {
  const qs = new URLSearchParams({
    docId: params.orionDocumentId,
    token: params.embedToken,
    action: 'signatureFields',
  });
  return orionFetch<OrionDocumentResponse>(
    `/api/integrations/synerlink/embed/document?${qs.toString()}`,
    {
      method: 'POST',
      body: JSON.stringify({ signatureFields: params.signatureFields }),
    }
  );
}

/** Descarga binaria de una URL Orion protegida (Bearer integration key). */
export async function fetchOrionProtectedFile(url: string): Promise<{
  ok: boolean;
  status: number;
  buffer: ArrayBuffer | null;
  contentType: string | null;
  error?: string;
}> {
  const cfg = getOrionConfig();
  if (!cfg.integrationApiKey) {
    return {
      ok: false,
      status: 503,
      buffer: null,
      contentType: null,
      error: 'Integración Orion no configurada',
    };
  }

  const absoluteUrl = resolveOrionAbsoluteUrl(url);
  if (!absoluteUrl) {
    return {
      ok: false,
      status: 503,
      buffer: null,
      contentType: null,
      error: 'ORION_API_BASE_URL no configurado',
    };
  }

  try {
    const res = await fetch(absoluteUrl, {
      headers: { Authorization: `Bearer ${cfg.integrationApiKey}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        status: res.status,
        buffer: null,
        contentType: null,
        error: text || res.statusText,
      };
    }
    const buffer = await res.arrayBuffer();
    return {
      ok: true,
      status: res.status,
      buffer,
      contentType: res.headers.get('content-type'),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Error de red';
    const unreachable =
      /fetch failed|ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT/i.test(message);
    return {
      ok: false,
      status: unreachable ? 503 : 502,
      buffer: null,
      contentType: null,
      error: unreachable
        ? `Motor de firma Orion no disponible (${cfg.apiBaseUrl || 'ORION_API_BASE_URL'}). Inicie Orion y vuelva a intentar.`
        : message,
    };
  }
}

/** Intenta descargar el PDF firmado usando la URL canónica y fallbacks almacenados. */
export async function fetchOrionSignedFileContent(params: {
  orionDocumentId?: string | null;
  signedFileUrl?: string | null;
}): Promise<{
  ok: boolean;
  status: number;
  buffer: ArrayBuffer | null;
  contentType: string | null;
  error?: string;
}> {
  const candidates = [
    params.orionDocumentId ? buildOrionSignedFileApiUrl(params.orionDocumentId) : null,
    resolveOrionAbsoluteUrl(params.signedFileUrl),
  ].filter((url, index, list): url is string => Boolean(url) && list.indexOf(url) === index);

  if (candidates.length === 0) {
    return {
      ok: false,
      status: 404,
      buffer: null,
      contentType: null,
      error: 'No hay URL de PDF firmado en Orion',
    };
  }

  let last = {
    ok: false,
    status: 502,
    buffer: null as ArrayBuffer | null,
    contentType: null as string | null,
    error: 'No se pudo descargar el PDF firmado desde Orion',
  };

  for (const url of candidates) {
    const result = await fetchOrionProtectedFile(url);
    if (result.ok && result.buffer) return result;
    last = {
      ...result,
      error: result.error || last.error,
    };
  }

  return last;
}
