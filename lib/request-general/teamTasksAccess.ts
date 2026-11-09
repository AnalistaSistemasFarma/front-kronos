export const TEAM_TASKS_URL = '/process/request-general/team-tasks';
export const TEAM_TASKS_NAME = 'Ver tareas de mi equipo';

export function isTeamTasksSubprocess(subprocess: {
  subprocess?: string | null;
  subprocess_url?: string | null;
}): boolean {
  const url = (subprocess.subprocess_url ?? '').toLowerCase().trim();
  if (url === TEAM_TASKS_URL) return true;
  const name = (subprocess.subprocess ?? '').toLowerCase().trim();
  return name === TEAM_TASKS_NAME.toLowerCase();
}
