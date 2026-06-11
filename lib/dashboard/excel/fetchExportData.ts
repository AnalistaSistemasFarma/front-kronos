import { enrichTasksWithEncargadoFromRequests } from '../enrichTasksWithEncargado';
import { dedupeHelpDeskCases, type HelpDeskCase } from '../ticketAnalytics';
import type { DashboardRequest, DashboardTask } from '../types';

async function fetchExportJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (res.status === 401) {
    throw new Error('Sesión no válida. Inicia sesión de nuevo.');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Error al cargar datos (${url})`);
  }
  return res.json() as Promise<T>;
}

export async function fetchAllTasksForExport(): Promise<DashboardTask[]> {
  const result = await fetchExportJson<{ data: DashboardTask[] }>(
    '/api/requests-general/view-tasks'
  );
  return result.data ?? [];
}

export async function fetchAllRequestsForExport(): Promise<DashboardRequest[]> {
  const result = await fetchExportJson<{ data: DashboardRequest[] }>(
    '/api/requests-general/view-requests'
  );
  return result.data ?? [];
}

export async function fetchAllTicketsForExport(): Promise<HelpDeskCase[]> {
  const result = await fetchExportJson<{ data: HelpDeskCase[] }>(
    '/api/help-desk/dashboard-cases'
  );
  return dedupeHelpDeskCases(result.data ?? []);
}

export async function fetchTasksAndRequestsForExport(): Promise<{
  tasks: DashboardTask[];
  requests: DashboardRequest[];
}> {
  const [rawTasks, requests] = await Promise.all([
    fetchAllTasksForExport(),
    fetchAllRequestsForExport(),
  ]);
  const tasks = enrichTasksWithEncargadoFromRequests(rawTasks, requests);
  return { tasks, requests };
}
