/**
 * SEGREGACIÓN DE FUNCIONES del flujo documental — funciones PURAS.
 *
 * Regla base (2026-10-05): quien hace la solicitud no la elabora ni la firma;
 * quien elabora no revisa ni aprueba su propio documento.
 *
 * EXCEPCIÓN PARA CALIDAD (RN de Nicolás, 2026-10-13, solicitud #1 de OLP):
 * a las personas con el permiso de Aseguramiento de Calidad del SGC de la
 * empresa se les permite:
 *   1. ELABORAR aunque ellas mismas hayan hecho la solicitud;
 *   2. ser REVISORAS aunque hayan hecho la solicitud;
 *   3. REVISAR el documento que ellas mismas elaboraron, solo si la empresa
 *      lo habilita (ajuste «Calidad revisa lo que elabora», APAGADO por
 *      defecto; lo cambia Calidad en Configuración del SGC y queda auditado).
 * La APROBACIÓN no cambia: solo cargos autorizados, nunca quien elaboró ni
 * quien hizo la solicitud. Para quien no es de Calidad no cambia nada.
 */

export interface SgcSegregationContext {
  requesterEmail: string;
  elaboratorEmail: string;
  /** Personas con el permiso de Aseguramiento de Calidad del SGC en la empresa (en minúscula). */
  quality: ReadonlySet<string>;
  /** Ajuste de la empresa (punto 3): Calidad puede revisar lo que elaboró. */
  qualitySelfReview: boolean;
}

/** Tipo de paso de firmantes según su significado de firma. */
export type SgcSignerStepKind = 'revision' | 'aprobacion' | 'otro';

export function signerStepKind(step: { assignment?: string | null; signatureMeaning?: string | null } | null | undefined): SgcSignerStepKind {
  if (!step || step.assignment !== 'firmantes') return 'otro';
  if (step.signatureMeaning === 'reviso') return 'revision';
  if (step.signatureMeaning === 'aprobo') return 'aprobacion';
  return 'otro';
}

const low = (e: string | null | undefined) => (e ?? '').trim().toLowerCase();

/** Contexto ESTRICTO (sin excepción): el comportamiento del 2026-10-05. */
export function strictSegregation(requesterEmail: string, elaboratorEmail: string): SgcSegregationContext {
  return { requesterEmail, elaboratorEmail, quality: new Set(), qualitySelfReview: false };
}

/** (1) ¿Puede quedar como elaborador quien hizo la solicitud? Solo si es de Calidad. */
export function requesterMayElaborate(email: string, requesterEmail: string, quality: ReadonlySet<string>): boolean {
  const e = low(email);
  return e !== low(requesterEmail) || quality.has(e);
}

/**
 * Motivo por el que la persona NO puede ser firmante del paso por segregación
 * (solicitante o elaborador de la solicitud), o null si puede.
 */
export function signerSegregationDenial(email: string, kind: SgcSignerStepKind, stepName: string, ctx: SgcSegregationContext): string | null {
  const e = low(email);
  const isQuality = ctx.quality.has(e);
  if (e === low(ctx.elaboratorEmail)) {
    // (3) Solo en revisión, solo Calidad y solo si la empresa lo habilitó.
    if (!(kind === 'revision' && isQuality && ctx.qualitySelfReview)) return `El elaborador no puede ser firmante de ${stepName} de su propio documento.`;
  }
  if (e === low(ctx.requesterEmail)) {
    // (2) Solo en revisión y solo Calidad.
    if (!(kind === 'revision' && isQuality)) return `Quien hizo la solicitud no puede ser firmante de ${stepName} de su propia solicitud.`;
  }
  return null;
}

/** (3) ¿El elaborador puede DECIDIR (firmar «Revisó») en este paso? */
export function elaboratorMayReview(kind: SgcSignerStepKind, ctx: SgcSegregationContext): boolean {
  return kind === 'revision' && ctx.qualitySelfReview && ctx.quality.has(low(ctx.elaboratorEmail));
}

/** Personas (solicitante y/o elaborador) que la excepción deja ser REVISORAS en esta solicitud. */
export function reviewExemptions(ctx: SgcSegregationContext): string[] {
  const out = new Set<string>();
  for (const e of [low(ctx.requesterEmail), low(ctx.elaboratorEmail)]) {
    if (e && signerSegregationDenial(e, 'revision', 'la revisión', ctx) === null) out.add(e);
  }
  return [...out];
}
