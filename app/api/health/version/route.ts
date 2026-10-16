import { NextResponse } from 'next/server';

// Identificador del build que está sirviendo este proceso. Lo usa
// components/errors/RecuperacionActualizacion.tsx para saber si el servidor ya
// tiene una versión nueva. Bajo /api/health/ para que IIS lo deje pasar incluso
// con la página de mantenimiento activa. Sin datos sensibles.
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    { buildId: process.env.APP_BUILD_ID ?? null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
