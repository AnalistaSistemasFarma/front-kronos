import type { OrionSignatureState } from './types';
import { resolveOrionPdfUrl } from './documentVersions';

export const WATERMARK_TEXT = 'SYNERLINK-VALIDO';

/**
 * Tras FIRMADO: registra la versión "SYNERLINK-VALIDO" apuntando al PDF de Orion
 * (Kronos puede estampar patrón + sello al servir; Orion aporta el PDF base).
 */
export async function ensureValidatedWatermarkVersion(params: {
  requestId: number;
  state: OrionSignatureState;
  storagePath?: string;
}): Promise<OrionSignatureState> {
  void params.requestId;
  void params.storagePath;

  const status = String(params.state.status || '').toUpperCase();
  if (status !== 'FIRMADO' && status !== 'SIGNED' && status !== 'COMPLETED') {
    return params.state;
  }

  const existing = (params.state.versions ?? []).find(
    (v) =>
      v.kind === 'validated' ||
      String(v.label || '')
        .toUpperCase()
        .includes(WATERMARK_TEXT) ||
      String(v.label || '')
        .toUpperCase()
        .includes('DOCUMENTO VALIDADO')
  );
  if (existing) {
    // Normalizar label legacy
    if (existing.label !== WATERMARK_TEXT) {
      return {
        ...params.state,
        versions: (params.state.versions ?? []).map((v) =>
          v.id === existing.id ? { ...v, label: WATERMARK_TEXT, kind: 'validated' } : v
        ),
      };
    }
    return params.state;
  }

  const sourceUrl = resolveOrionPdfUrl(params.state) || params.state.signedFileUrl;
  if (!sourceUrl) return params.state;

  return {
    ...params.state,
    versions: [
      ...(params.state.versions ?? []),
      {
        id: `validated-orion-${Date.now()}`,
        kind: 'validated' as const,
        label: WATERMARK_TEXT,
        url: sourceUrl,
        createdAt: new Date().toISOString(),
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}
