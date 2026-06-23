/** Evento global cuando cambian subprocesos asignados a un usuario. */
export const SUBPROCESS_ASSIGNMENTS_CHANGED = 'kronos:subprocess-assignments-changed';

export function notifySubprocessAssignmentsChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SUBPROCESS_ASSIGNMENTS_CHANGED));
}
