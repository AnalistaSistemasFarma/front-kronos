import { NextResponse } from 'next/server';
import { getReassignmentAccess } from '../../../../../lib/requests-general/reassignmentAccess';
import { REVERT_MAX_REASON, revertReassignment } from '../../../../../lib/requests-general/reassignmentRevert';

const TAG = '[reassignment-workflow-request/revert]';

const fail = (error, status, extra = {}) => NextResponse.json({ error, ...extra }, { status });

export async function POST(req) {
  const access = await getReassignmentAccess();
  if (access.error) return fail(access.error.message, access.error.status);
  const { userId, departmentIds, session } = access;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return fail('Cuerpo inválido', 400);

  const id = Number.parseInt(body.id, 10);
  if (!Number.isInteger(id) || id <= 0) return fail('Registro inválido', 400);
  const dryRun = body.dryRun === true;
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, REVERT_MAX_REASON) : '';
  if (!dryRun && !reason) return fail('El motivo es obligatorio', 400);

  try {
    const result = await revertReassignment({
      id,
      actorId: userId,
      actorName: session?.user?.name || undefined,
      reason,
      dryRun,
      departmentIds,
      origin: 'manual',
    });
    if (!result.ok) {
      return fail(result.error, result.status, result.skipped ? { skipped: result.skipped } : {});
    }
    if (dryRun) {
      return NextResponse.json({ success: true, dryRun: true, isReturn: result.isReturn, preview: result.preview }, { status: 200 });
    }
    return NextResponse.json(
      { success: true, isReturn: result.isReturn, reverted: result.reverted, skipped: result.skipped },
      { status: 200 }
    );
  } catch (err) {
    console.error(`${TAG} Error:`, err);
    return fail('Error al deshacer la reasignación', 500);
  }
}
