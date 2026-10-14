import type { SgcSignatureMeaning } from '../flows/definition';

/**
 * S14 (R25, reunión con Calidad OLP del 2026-10-13): «la firma guardada
 * aparece en un paso y no en el otro». El servidor ya estampaba igual en los
 * dos caminos (la tarea y Autorizaciones usan el mismo signTask), pero el
 * formulario no mostraba qué se iba a estampar. Desde el S14 el formulario de
 * firma, en TODOS los pasos con firma en el documento, muestra la firma
 * registrada y validada que se estampará, o avisa que no la hay — y la
 * verificación de Calidad (R20) dice que no va en el documento.
 * Función pura: decide qué mostrar.
 */
export type SgcStampPreview =
  | { kind: 'none' }
  | { kind: 'trazo'; title: string; body: string; imagePng: string }
  | { kind: 'sin_trazo'; title: string; body: string }
  | { kind: 'verificacion'; title: string; body: string };

const PLACED: readonly SgcSignatureMeaning[] = ['elaboro', 'reviso', 'aprobo'];

export function sgcStampPreviewOf(
  meaning: SgcSignatureMeaning,
  isQualityVerification: boolean,
  own: { active: { imagePng: string | null } | null; pending: { imagePng: string | null } | null } | null
): SgcStampPreview {
  if (isQualityVerification) {
    return {
      kind: 'verificacion',
      title: 'Verificación de Calidad',
      body: 'Es una lista de chequeo: queda en SynerLink (historial y auditoría) y no se estampa como firma en el documento.',
    };
  }
  if (!PLACED.includes(meaning) || !own) return { kind: 'none' };
  if (own.active?.imagePng) {
    return { kind: 'trazo', title: 'Firma que se estampará en el documento', body: 'Es su firma registrada y validada por Aseguramiento de Calidad.', imagePng: own.active.imagePng };
  }
  return {
    kind: 'sin_trazo',
    title: 'Firma que se estampará en el documento',
    body: own.pending
      ? 'Su firma registrada aún está pendiente de validación de Calidad: el documento llevará su nombre en lugar del trazo. La firma electrónica se registra igual.'
      : 'No tiene una firma registrada y validada: el documento llevará su nombre en lugar del trazo. La firma electrónica se registra igual.',
  };
}
