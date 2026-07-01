import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getCompanyAccessForUser } from '../../../../lib/organigrama/access';
import { isReparentSafe } from '../../../../lib/organigrama/tree';
import { prisma } from '../../../../lib/prisma';

/**
 * Edita UNA relacion de jerarquia (fila cargo_jerarquia) de una empresa.
 *
 * Cambios soportados (ambos opcionales, al menos uno):
 *   - idCargoPadre: number | null  -> reasigna el jefe (null = raiz)
 *   - aproximada:   boolean        -> alterna la marca de relacion aproximada
 *
 * Validaciones de seguridad:
 *   - El usuario debe tener acceso al organigrama de la empresa.
 *   - La fila debe existir y pertenecer a esa empresa.
 *   - El nuevo padre (si se da) debe existir como cargo y estar ASIGNADO en la
 *     misma empresa (no se permite apuntar a un cargo fuera del organigrama de
 *     la empresa).
 *   - La reasignacion no puede crear un ciclo (un cargo no puede ser su propio
 *     ancestro).
 *
 * POST body: { companyId, idCargoJerarquia, idCargoPadre?, aproximada? }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Cuerpo invalido' }, { status: 400 });
    }

    const companyId = Number(body.companyId);
    const idCargoJerarquia = Number(body.idCargoJerarquia);
    if (!Number.isInteger(companyId) || companyId <= 0) {
      return NextResponse.json({ error: 'companyId invalido' }, { status: 400 });
    }
    if (!Number.isInteger(idCargoJerarquia) || idCargoJerarquia <= 0) {
      return NextResponse.json({ error: 'idCargoJerarquia invalido' }, { status: 400 });
    }

    // Validacion de acceso a la empresa.
    const access = await getCompanyAccessForUser(session.user.email, companyId);
    if (!access) {
      return NextResponse.json(
        { error: 'No tiene acceso al organigrama de esta empresa' },
        { status: 403 }
      );
    }

    // La fila debe existir y pertenecer a la empresa.
    const row = await prisma.cargoJerarquia.findUnique({
      where: { id_cargo_jerarquia: idCargoJerarquia },
    });
    if (!row || row.id_company !== companyId) {
      return NextResponse.json(
        { error: 'La relacion no existe en esta empresa' },
        { status: 404 }
      );
    }

    const data: { id_cargo_padre?: number | null; aproximada?: boolean } = {};

    // --- Reasignacion de jefe (opcional) ---
    if ('idCargoPadre' in body) {
      const raw = body.idCargoPadre;
      let nuevoPadre: number | null;
      if (raw === null || raw === '' || raw === undefined) {
        nuevoPadre = null;
      } else {
        nuevoPadre = Number(raw);
        if (!Number.isInteger(nuevoPadre) || nuevoPadre <= 0) {
          return NextResponse.json({ error: 'idCargoPadre invalido' }, { status: 400 });
        }
      }

      if (nuevoPadre != null) {
        // El padre debe estar asignado en la jerarquia de ESTA empresa.
        const padreEnEmpresa = await prisma.cargoJerarquia.findFirst({
          where: { id_company: companyId, id_cargo: nuevoPadre },
          select: { id_cargo_jerarquia: true },
        });
        if (!padreEnEmpresa) {
          return NextResponse.json(
            { error: 'El cargo jefe no esta asignado en el organigrama de esta empresa' },
            { status: 400 }
          );
        }

        const safe = await isReparentSafe(companyId, row.id_cargo, nuevoPadre);
        if (!safe) {
          return NextResponse.json(
            { error: 'La reasignacion crearia un ciclo (un cargo no puede ser su propio jefe ni descendiente)' },
            { status: 400 }
          );
        }
      }

      data.id_cargo_padre = nuevoPadre;
    }

    // --- Marca aproximada (opcional) ---
    if ('aproximada' in body) {
      if (typeof body.aproximada !== 'boolean') {
        return NextResponse.json({ error: 'aproximada debe ser booleano' }, { status: 400 });
      }
      data.aproximada = body.aproximada;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No hay cambios para aplicar' }, { status: 400 });
    }

    const updated = await prisma.cargoJerarquia.update({
      where: { id_cargo_jerarquia: idCargoJerarquia },
      data,
    });

    return NextResponse.json({
      ok: true,
      node: {
        idCargoJerarquia: updated.id_cargo_jerarquia,
        idCargo: updated.id_cargo,
        idCargoPadre: updated.id_cargo_padre,
        aproximada: updated.aproximada,
      },
    });
  } catch (error) {
    console.error('Error updating organigrama:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
