import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getNivelSalas } from '../../../../lib/salas/access';
import type { Repeticion, SolicitudReserva } from '../../../../lib/salas/reglas';
import { respuestaError } from '../../../../lib/salas/respuesta';
import { reservar } from '../../../../lib/salas/servicio';

export const dynamic = 'force-dynamic';

function texto(v: unknown, max = 2000): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function repeticion(v: unknown): Repeticion {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const tipos = ['ninguna', 'diaria', 'semanal', 'mensual', 'anual', 'especificos'] as const;
  const tipo = tipos.find((t) => t === r.tipo) ?? 'ninguna';
  return {
    tipo,
    soloHabiles: r.soloHabiles === true,
    diasSemana: Array.isArray(r.diasSemana)
      ? r.diasSemana.filter((d): d is number => Number.isInteger(d)).slice(0, 7)
      : undefined,
    hasta: texto(r.hasta, 10) || undefined,
    fechas: Array.isArray(r.fechas) ? r.fechas.map((f) => texto(f, 10)).slice(0, 400) : undefined,
  };
}

/**
 * POST /api/salas/reservas — crea una reserva simple o periódica.
 * El organizador es SIEMPRE el usuario de la sesión: el cuerpo no lo trae.
 * 409 si hay choques (con el detalle) o si la sala rechaza; 423 en modo de solo lectura.
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const nivel = await getNivelSalas(session.user.email);
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Solicitud no válida.' }, { status: 400 });
    }
    const solicitud: SolicitudReserva = {
      salaId: texto(body.salaId, 100),
      fecha: texto(body.fecha, 10),
      horaInicio: texto(body.horaInicio, 5),
      horaFin: texto(body.horaFin, 5),
      asunto: texto(body.asunto, 300),
      invitados: texto(body.invitados, 5000),
      repeticion: repeticion(body.repeticion),
    };
    const resultado = await reservar(session.user.email, nivel, solicitud);
    return NextResponse.json({ ok: true, ...resultado }, { status: 201 });
  } catch (err) {
    return respuestaError(err, 'reservar');
  }
}
