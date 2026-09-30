import type { SgcSignatureMeaning } from '../flows/definition';

/**
 * Textos de la firma electrónica PROPIA del SGC (seguros para el navegador:
 * sin dependencias de servidor).
 *
 * COPIA CONGELADA y adaptada (2026-09-30) de lib/orion/signingLegalConsent.ts
 * (GSS Firma/Orión, versión co-ley527-d2364-v1): se toma el texto de la firma
 * ELECTRÓNICA (Ley 527 de 1999, Decreto 2364 de 2012) y se ajusta a cómo firma
 * el SGC: reautenticación con la contraseña de SynerLink, significado y
 * motivo, sello de tiempo del servidor y hash del contenido. No se copia la
 * firma DIGITAL con certificado ni la huella (el SGC no las usa). Cambiar este
 * texto es un cambio controlado: sube la versión y las aceptaciones anteriores
 * quedan con la suya.
 *
 * Pendiente de validación formal por Calidad y Jurídico (supuesto del S3).
 */

export const SGC_SIGNATURE_CONSENT_VERSION = 'sgc-co-ley527-d2364-v1';

export const SGC_SIGNATURE_CONSENT = {
  title: 'Firma electrónica del Sistema de Gestión de Calidad',
  body:
    'Este documento se firma electrónicamente de conformidad con el artículo 7° de la Ley 527 de 1999 y el Decreto 2364 de 2012, que reconocen validez y fuerza probatoria a la firma electrónica cuando el método utilizado permite identificar al firmante y su consentimiento sobre el contenido, siempre que sea confiable y apropiado para el fin del documento. ' +
    'Para firmar usted confirma su identidad con su contraseña de SynerLink (no se guarda), indica el significado y el motivo de la firma, y el sistema registra la fecha y hora del servidor, la huella SHA-256 del contenido que firma y la información técnica de la sesión (IP y navegador) en el registro de auditoría inmodificable del SGC.',
  checkbox:
    'He leído y acepto firmar electrónicamente este documento. Entiendo que esta firma tiene la misma validez que una firma manuscrita y que queda vinculada al contenido que estoy firmando.',
} as const;

export const SGC_SIGNATURE_CONSENT_REQUIRED_MESSAGE = 'Debe leer y aceptar las condiciones de la firma electrónica para firmar.';

/** Método de reautenticación del S3 (decisión de Nicolás 17:24: firma propia con reautenticación y motivo). */
export const SGC_SIGNATURE_AUTH_METHOD = 'contrasena_synerlink';
export const SGC_SIGNATURE_AUTH_METHOD_LABEL = 'Contraseña de SynerLink (reautenticación al firmar)';

/** Motivos sugeridos por significado (la persona puede escribir el suyo). */
export const SGC_SIGNATURE_REASONS: Record<SgcSignatureMeaning, string[]> = {
  elaboro: ['Soy el autor del documento y lo envío a revisión.', 'Elaboré los cambios de esta versión y los envío a revisión.'],
  reviso: ['Revisé el contenido y es técnicamente correcto.', 'Revisé el documento y no tengo observaciones.'],
  aprobo: ['Apruebo el documento para su emisión.', 'Verifiqué la estructura documental y apruebo su emisión.'],
  leyo: ['Leí y entendí el documento.'],
  capacito: ['Realicé la capacitación del documento.'],
};

export const SGC_CHECK_ANSWERS = ['cumple', 'no_cumple', 'no_aplica'] as const;
export type SgcCheckAnswer = (typeof SGC_CHECK_ANSWERS)[number];

export const SGC_CHECK_ANSWER_LABELS: Record<SgcCheckAnswer, string> = {
  cumple: 'Cumple',
  no_cumple: 'No cumple',
  no_aplica: 'No aplica',
};
