import { NextResponse } from 'next/server';
import { listHelpDeskTechnicians } from '../../../../lib/help-desk/technicians';

function isAbortedError(error) {
  if (!error || typeof error !== 'object') return false;
  return error.name === 'AbortError' || error.message === 'aborted';
}

export async function GET() {
  try {
    const technicians = await listHelpDeskTechnicians();
    return NextResponse.json(
      technicians.map((t) => ({
        id_subprocess_user_company: t.id_subprocess_user_company,
        subprocess: t.subprocess,
        id_company_user: t.id_company_user,
        name: t.name,
      })),
      { status: 200 }
    );
  } catch (error) {
    if (isAbortedError(error)) {
      return new NextResponse(null, { status: 499 });
    }
    console.error('Error fetching subprocess users:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
