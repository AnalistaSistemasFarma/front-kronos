import { redirect } from 'next/navigation';
import { getRequesterPanelUrl } from '@/lib/help-desk/subprocessRoles';

/** Ruta legacy: redirige según subproceso (operador → panel, solicitante → mis tickets). */
export default function CasesByEmailRedirectPage() {
  redirect(getRequesterPanelUrl());
}
