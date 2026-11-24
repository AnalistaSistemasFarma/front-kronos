import { xlsxAPdfConMicrosoft } from '../../../../../../lib/bitacora-proceso/office';
import { errorResponse, jsonNoStore, NO_STORE } from '../../../_lib/context';
import { armarBatchRecord } from '../../../_lib/batchRecord';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bitacora-proceso/[id]/batch-record/vista-previa?company=1 — PDF de la vista previa:
 * el MISMO .xlsx de la descarga, convertido por Microsoft (Excel Online). Primero se ve, después
 * se descarga (Nicolás, 2026-11-24). Si Microsoft no responde, 502 con el motivo: no se inventa
 * una vista previa con otro motor que podría no coincidir con lo que imprime Excel.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const r = await armarBatchRecord(request, params);
    if (r instanceof Response) return r;
    let pdf: Uint8Array;
    try {
      pdf = await xlsxAPdfConMicrosoft(new Uint8Array(r.xlsx));
    } catch (error) {
      console.error('[bitacora-proceso/batch-record] vista previa con Microsoft', error);
      const limite = /XLSPageLimitExceeded/.test(String(error));
      return jsonNoStore(
        {
          error: limite
            ? 'El archivo tiene demasiadas páginas para la vista previa de Microsoft. Elija menos bitácoras del lote.'
            : 'Microsoft no pudo generar la vista previa en este momento. Intente de nuevo en unos minutos.',
        },
        502
      );
    }
    return new Response(new Uint8Array(pdf), { status: 200, headers: { ...NO_STORE, 'Content-Type': 'application/pdf' } });
  } catch (error) {
    return errorResponse(error, 'batch-record-preview');
  }
}
