import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { canViewItDashboard } from '../../../../../lib/it-dashboard/access';
import { findAllowedCompany } from '../../../../../lib/it-dashboard/internetDb';
import { validateSoftwareInput } from '../../../../../lib/it-dashboard/software';
import { loadSoftwareById, updateSoftware } from '../../../../../lib/it-dashboard/softwareDb';

export const dynamic = 'force-dynamic';

/** PUT /api/it-dashboard/software/[id] — edits a software or certificate. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
    if (!(await canViewItDashboard(email))) {
      return NextResponse.json({ error: 'No tiene acceso al Dashboard TI.' }, { status: 403 });
    }
    const raw = (await params).id;
    const id = /^\d+$/.test(raw ?? '') ? Number(raw) : NaN;
    if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: 'Registro inválido.' }, { status: 400 });
    if (!(await loadSoftwareById(id))) return NextResponse.json({ error: 'Registro no encontrado.' }, { status: 404 });

    const v = validateSoftwareInput(await req.json().catch(() => null));
    if (!v.ok) return NextResponse.json({ error: 'Revise los datos del software.', fields: v.errors }, { status: 400 });
    if ((await findAllowedCompany(v.value.companyId)) == null) {
      return NextResponse.json({ error: 'Empresa no encontrada.', fields: { companyId: 'Empresa no válida' } }, { status: 400 });
    }
    const item = await updateSoftware(id, v.value, email);
    return NextResponse.json({ item }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('Error PUT /api/it-dashboard/software/[id]:', err);
    return NextResponse.json({ error: 'No se pudo guardar el software.' }, { status: 500 });
  }
}
