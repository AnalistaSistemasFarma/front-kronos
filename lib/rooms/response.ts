import { NextResponse } from 'next/server';
import { GraphError } from './graph';
import { BookingError } from './rules';

/** Turns a module error into a JSON response without leaking internal details. */
export function errorResponse(err: unknown, context: string): NextResponse {
  if (err instanceof BookingError) {
    const details = err.details && typeof err.details === 'object' ? err.details : {};
    return NextResponse.json({ error: err.message, ...details }, { status: err.status });
  }
  if (err instanceof GraphError) {
    console.error(`[rooms] ${context}:`, err.message);
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error(`[rooms] ${context}:`, err instanceof Error ? err.message : err);
  return NextResponse.json({ error: 'Error interno del módulo de salas.' }, { status: 500 });
}
