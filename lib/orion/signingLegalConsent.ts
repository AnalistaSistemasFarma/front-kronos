/**
 * Consentimiento legal de firma (Colombia) — alineado con Orion
 * `signing-legal-consent.ts` (versión co-ley527-d2364-v1).
 *
 * Copy v1: Ley 527 de 1999, Decreto 1747 de 2000 y Decreto 2364 de 2012.
 * Pendiente de validación formal por el equipo legal.
 *
 * Biometría (huella): autorización específica Ley 1581 art. 6 — dato sensible.
 */

export const SIGNING_LEGAL_CONSENT_VERSION = 'co-ley527-d2364-v1';

/** Versión de consentimiento biométrico — alineada con Orion `co-ley1581-art6-huella-v1`. */
export const BIOMETRIC_CONSENT_VERSION = 'co-ley1581-art6-huella-v1';

export type SigningLegalKind = 'ELECTRONIC' | 'DIGITAL';

export const SIGNING_LEGAL_COPY: Record<
  SigningLegalKind,
  { title: string; body: string; checkbox: string }
> = {
  ELECTRONIC: {
    title: 'Firma electrónica',
    body: 'Este documento se firma electrónicamente de conformidad con el artículo 7° de la Ley 527 de 1999 y el Decreto 2364 de 2012, que reconocen validez y fuerza probatoria a la firma electrónica cuando el método utilizado permite identificar al firmante y su consentimiento sobre el contenido, siempre que sea confiable y apropiado para el fin del documento. Se registrará evidencia de la transacción (fecha, hora e información técnica de la sesión) como parte del expediente.',
    checkbox:
      'He leído y acepto firmar electrónicamente este documento. Entiendo que esta firma tiene la misma validez legal que una firma manuscrita, y autorizo el tratamiento de mis datos de identificación para este fin.',
  },
  DIGITAL: {
    title: 'Firma digital',
    body: 'Este documento se firma digitalmente mediante un certificado digital emitido por una entidad de certificación acreditada, de conformidad con la Ley 527 de 1999 y el Decreto 1747 de 2000. La firma digital garantiza la integridad del documento y la identidad del firmante mediante criptografía de clave pública.',
    checkbox:
      'He leído y acepto firmar digitalmente este documento con un certificado de una entidad de certificación acreditada. Entiendo que esta firma tiene validez legal conforme a la Ley 527 de 1999 y el Decreto 1747 de 2000.',
  },
};

/** Autorización específica para dato biométrico (huella). */
export const BIOMETRIC_CONSENT_COPY = {
  title: 'Huella dactilar (dato biométrico)',
  body: 'La huella dactilar es un dato personal sensible conforme al artículo 6 de la Ley 1581 de 2012. Solo se solicita cuando el expediente lo exige, con la finalidad de identificar al firmante sobre este documento, y se transmite de forma cifrada al motor de firma (Orion / GSS Firma) para estamparla en la caja correspondiente. No se usa para otros fines.',
  checkbox:
    'Autorizo de forma previa, expresa e informada el tratamiento de mi huella dactilar exclusivamente para firmar este documento, conforme a la Ley 1581 de 2012.',
};

export const SIGNING_LEGAL_CONSENT_REQUIRED_MESSAGE =
  'Debe leer y aceptar las condiciones de firma para continuar.';

export const BIOMETRIC_CONSENT_REQUIRED_MESSAGE =
  'Debe autorizar el tratamiento de su huella dactilar para continuar.';
