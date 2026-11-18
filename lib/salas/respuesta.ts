import { NextResponse } from 'next/server';
import { ErrorGraph } from './graph';
import { ErrorReserva } from './reglas';

/** Convierte un error del módulo en respuesta JSON, sin filtrar detalles internos. */
export function respuestaError(err: unknown, contexto: string): NextResponse {
  if (err instanceof ErrorReserva) {
    const detalle = err.detalle && typeof err.detalle === 'object' ? err.detalle : {};
    return NextResponse.json({ error: err.message, ...detalle }, { status: err.status });
  }
  if (err instanceof ErrorGraph) {
    console.error(`[salas] ${contexto}:`, err.message);
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error(`[salas] ${contexto}:`, err instanceof Error ? err.message : err);
  return NextResponse.json({ error: 'Error interno del módulo de salas.' }, { status: 500 });
}
