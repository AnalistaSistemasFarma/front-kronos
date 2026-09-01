import { getOrionConfig } from './config';
import type {
  OrionAssignSignersPayload,
  OrionCreateDocumentPayload,
  OrionDocumentResponse,
} from './types';

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
