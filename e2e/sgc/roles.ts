import { expect, type APIRequestContext } from '@playwright/test';

/**
 * Roles de las e2e con firma del SGC desde las reglas del 2026-10-05
 * (demo PiSA, PR #535 y #536):
 *   - El ELABORADOR lo fija la configuración del proceso (matriz de
 *     responsables o, en su defecto, Aseguramiento de Calidad), nunca el
 *     solicitante: quien pide un documento no lo elabora.
 *   - Ni el solicitante ni el elaborador revisan ni aprueban (tampoco toman
 *     el cupo del grupo de Calidad).
 * Con los tres usuarios QA de pruebas el reparto queda así:
 *   - qa.sgc3 hace la solicitud;
 *   - qa.sgc (Aseguramiento de Calidad del SGC) es el elaborador: si la
 *     configuración eligió a otra persona, la toma con «Reasignar» (lo permite
 *     a Calidad cuando no es quien pidió). Así ninguna corrida deja tareas a
 *     personas reales (antes del ajuste quedaban abiertas en pruebas con
 *     Nicolás Rivera y María Camila Ortega como elaboradores);
 *   - qa.sgc2 revisa, aprueba y responde la verificación de Calidad (es el
 *     único QA del grupo SGC-VERIF-CALIDAD).
 * Lo que exige dos revisores distintos o un elaborador que no sea de Calidad
 * necesita un cuarto usuario QA (ver la propuesta en docs/sgc/evidencias).
 */
export const OLP = 3;
export const U1 = process.env.E2E_USER_EMAIL ?? '';
export const U2 = process.env.E2E_USER_EMAIL2 ?? '';
export const U3 = process.env.E2E_USER_EMAIL3 ?? '';

type Detail = { request: { elaboratorEmail: string; requesterEmail: string } };
type Tasks = { tasks: { idTask: number; task: string; status: string }[] };

/** Deja a `elaboratorEmail` (un QA de Calidad) como elaborador de la solicitud; `quality` es su sesión. */
export async function takeElaboration(quality: APIRequestContext, idRequest: number, elaboratorEmail: string = U1): Promise<void> {
  const want = elaboratorEmail.toLowerCase();
  const res = await quality.get(`/api/sgc/requests/${idRequest}`);
  expect(res.status(), `detalle de la solicitud ${idRequest}`).toBe(200);
  const { request } = (await res.json()) as Detail;
  expect(request.requesterEmail.toLowerCase(), 'quien pide nunca elabora').not.toBe(want);
  expect(request.elaboratorEmail.toLowerCase(), 'el elaborador nunca es el solicitante').not.toBe(request.requesterEmail.toLowerCase());
  if (request.elaboratorEmail.toLowerCase() === want) return;
  const list = await quality.get(`/api/sgc/tasks?request=${idRequest}`);
  expect(list.status()).toBe(200);
  const elab = ((await list.json()) as Tasks).tasks.find((t) => /^Elaboración/.test(t.task) && t.status === 'abierta');
  expect(elab, `tarea de Elaboración abierta de la solicitud ${idRequest}`).toBeTruthy();
  const moved = await quality.post(`/api/sgc/tasks/${elab!.idTask}/reassign`, {
    data: { toEmail: want, reason: 'Prueba e2e: Aseguramiento de Calidad (usuario QA) toma la elaboración para no asignar tareas a personas reales.' },
  });
  expect([200, 201], JSON.stringify(await moved.json().catch(() => ({})))).toContain(moved.status());
}

/** Cancela una solicitud de prueba si sigue abierta (limpieza; 409 = ya estaba cerrada). */
export async function cancelQuietly(api: APIRequestContext, idRequest: number, reason: string): Promise<void> {
  if (!idRequest) return;
  const res = await api.post(`/api/sgc/requests/${idRequest}/cancel`, { data: { reason } }).catch(() => null);
  if (res) expect([200, 403, 404, 409]).toContain(res.status());
}
