import { NextResponse } from 'next/server';

type ErrorExtras = {
  status?: number;
  code?: string;
  fingerprintProfileUrl?: string | null;
  signatureProfileUrl?: string | null;
};

/** Respuesta JSON uniforme para errores lanzados con `Object.assign(new Error(), { status, code })`. */
export function orionErrorResponse(err: unknown): NextResponse {
  const extras = (err && typeof err === 'object' ? err : {}) as ErrorExtras;
  const status = Number(extras.status) || 500;
  const message = err instanceof Error ? err.message : 'Error interno';
  return NextResponse.json(
    {
      error: message,
      ...(extras.code ? { code: extras.code } : {}),
      ...(extras.fingerprintProfileUrl ? { fingerprintProfileUrl: extras.fingerprintProfileUrl } : {}),
      ...(extras.signatureProfileUrl ? { signatureProfileUrl: extras.signatureProfileUrl } : {}),
    },
    { status }
  );
}
