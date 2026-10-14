import { expect, type APIRequestContext, type Browser } from '@playwright/test';
import { STORAGE_STATE_2, STORAGE_STATE_4 } from '../../playwright.config';

/**
 * S15 (DOC v7, RN 2026-10-13): ayudas de la e2e del SGC para crear una
 * solicitud documental que ELABORA qa.sgc, con cualquiera de los dos modelos
 * de roles del flujo vigente en PRUEBAS:
 *   - DOC v6 o anterior («calidad_asigna»): la crea qa.sgc4 (solo solicitante)
 *     y la matriz de responsables GC × PR se la asigna a qa.sgc;
 *   - DOC v7 («solicitante_elabora»): la crea qa.sgc (quien pide, elabora) y
 *     qa.sgc2 (grupo SGC-VERIF-CALIDAD) AUTORIZA la creación (R15).
 * Requisito del DOC v7 en PRUEBAS (R40): qa.sgc, qa.sgc2 y qa.sgc3 comparten
 * departamento en SynerLink (los firmantes son del departamento de quien
 * elabora; ver scripts/sgc/pase-s14-s19/pruebas/01-qa-departamento-pruebas.sql).
 */
export const OLP = 3;
export type SgcRoleModel = 'calidad_asigna' | 'solicitante_elabora';

export async function flowRoleModel(api: APIRequestContext): Promise<SgcRoleModel> {
  const res = await api.get(`/api/sgc/requests/form?company=${OLP}`);
  expect(res.status()).toBe(200);
  const form = (await res.json()) as { roleModel?: SgcRoleModel };
  return form.roleModel ?? 'calidad_asigna';
}

/** qa.sgc2 (Calidad) autoriza la creación de la solicitud (paso «Autorización de la creación» del DOC v7). */
export async function authorizeCreation(browser: Browser, idRequest: number): Promise<void> {
  const ctx = await browser.newContext({ storageState: STORAGE_STATE_2, locale: 'es-CO', timezoneId: 'America/Bogota' });
  try {
    const res = await ctx.request.get(`/api/sgc/tasks?request=${idRequest}`);
    expect(res.status()).toBe(200);
    const { tasks } = (await res.json()) as { tasks: { idTask: number; task: string; status: string }[] };
    const auth = tasks.find((t) => /^Autorización de la creación/.test(t.task) && t.status === 'abierta');
    expect(auth, `autorización de la creación de la solicitud ${idRequest} en la bandeja de qa.sgc2`).toBeTruthy();
    const dec = await ctx.request.post(`/api/sgc/tasks/${auth!.idTask}/decision`, { data: { decision: 'aprobar', comment: 'Creación autorizada (e2e).' } });
    expect(dec.status(), await dec.text()).toBe(200);
  } finally {
    await ctx.close();
  }
}

/**
 * Crea una solicitud documental que elabora qa.sgc (`api` es la sesión de
 * qa.sgc). Con el DOC v7 la autoriza qa.sgc2 salvo `authorize: false`.
 */
export async function createRequestElaboratedByQaSgc(
  browser: Browser,
  api: APIRequestContext,
  data: Record<string, unknown>,
  opts: { authorize?: boolean; elaboratorEmail?: string } = {}
): Promise<{ idRequest: number; roleModel: SgcRoleModel }> {
  const roleModel = await flowRoleModel(api);
  let idRequest: number;
  if (roleModel === 'solicitante_elabora') {
    const res = await api.post('/api/sgc/requests', { data: { company: OLP, ...data } });
    expect(res.status(), await res.text()).toBe(201);
    idRequest = ((await res.json()) as { idRequest: number }).idRequest;
    if (opts.authorize !== false) await authorizeCreation(browser, idRequest);
  } else {
    const ctx = await browser.newContext({ storageState: STORAGE_STATE_4, locale: 'es-CO', timezoneId: 'America/Bogota' });
    try {
      const res = await ctx.request.post('/api/sgc/requests', { data: { company: OLP, ...data } });
      expect(res.status(), await res.text()).toBe(201);
      idRequest = ((await res.json()) as { idRequest: number }).idRequest;
    } finally {
      await ctx.close();
    }
  }
  if (opts.elaboratorEmail) {
    const d = (await (await api.get(`/api/sgc/requests/${idRequest}`)).json()) as { request: { elaboratorEmail: string } };
    expect(d.request.elaboratorEmail, roleModel === 'solicitante_elabora' ? 'DOC v7: quien pide (qa.sgc) elabora' : 'la matriz de responsables (GC × PR) asigna la elaboración a qa.sgc').toBe(opts.elaboratorEmail.toLowerCase());
  }
  return { idRequest, roleModel };
}
