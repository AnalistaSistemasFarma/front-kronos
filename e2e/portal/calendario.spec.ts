import { expect, test, type Page } from '@playwright/test';

/**
 * Portal TH · ventana principal · CALENDARIO y eventos del día (Cristian Baldión, 2026-10-09).
 *
 * Sin sesión real: las APIs del portal se simulan con `page.route`. La fecha se fija en el 9 de octubre de
 * 2026 (viernes, hora de Colombia) para que el resultado no dependa del día en que corra. Con
 * `FORMACION_CAPTURAS=<carpeta>` guarda capturas para la revisión.
 */

const CAPTURAS = process.env.FORMACION_CAPTURAS;
const HOY = '2026-10-09T10:00:00-05:00';

interface Evento { id: number; fecha: string; titulo: string; descripcion: string | null; tipo: 'empresa' }

async function preparar(page: Page, opciones: { editor: boolean }) {
  const estado = {
    eventos: [{ id: 1, fecha: '2026-10-20', titulo: 'Capacitación en trabajo seguro', descripcion: 'Sala 2, 8:00 a. m.', tipo: 'empresa' }] as Evento[],
    siguienteId: 2,
    creados: [] as Record<string, unknown>[],
    quitados: [] as number[],
  };
  await page.clock.setFixedTime(new Date(HOY));
  await page.route('**/api/portal/content', (r) =>
    r.fulfill({ json: { email: 'colaborador@gsslatam.com', documentos: [], banners: [], puedeEditar: opciones.editor } })
  );
  await page.route('**/api/portal/eventos?**', (r) => {
    const u = new URL(r.request().url());
    const desde = u.searchParams.get('desde')!;
    const hasta = u.searchParams.get('hasta')!;
    return r.fulfill({ json: { eventos: estado.eventos.filter((e) => e.fecha >= desde && e.fecha <= hasta), puedeEditar: opciones.editor } });
  });
  await page.route('**/api/portal/eventos', async (r) => {
    if (r.request().method() !== 'POST') return r.fallback();
    const cuerpo = r.request().postDataJSON() as { fecha: string; titulo: string; descripcion: string | null };
    estado.creados.push(cuerpo);
    const e: Evento = { id: estado.siguienteId++, fecha: cuerpo.fecha, titulo: cuerpo.titulo, descripcion: cuerpo.descripcion, tipo: 'empresa' };
    estado.eventos.push(e);
    return r.fulfill({ status: 201, json: { ok: true, evento: e } });
  });
  await page.route('**/api/portal/eventos/*', async (r) => {
    const id = Number(r.request().url().split('/').pop());
    estado.quitados.push(id);
    estado.eventos = estado.eventos.filter((e) => e.id !== id);
    return r.fulfill({ json: { ok: true } });
  });
  return estado;
}

test.describe('Portal TH · calendario de la ventana principal', () => {
  test('las rutas reales de eventos exigen sesión', async ({ request }) => {
    expect((await request.get('/api/portal/eventos?desde=2026-10-01&hasta=2026-10-31')).status()).toBe(401);
    expect((await request.post('/api/portal/eventos', { data: { fecha: '2026-10-20', titulo: 'X' } })).status()).toBe(401);
    expect((await request.delete('/api/portal/eventos/1')).status()).toBe(401);
  });

  test('escritorio: calendario ARRIBA a la izquierda, sobre los botones, con el recuadro de eventos debajo', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await preparar(page, { editor: false });
    await page.goto('/portal');
    const cal = page.getByTestId('portal-calendario');
    await expect(cal).toBeVisible();

    // Orden y posición: calendario → recuadro de eventos → botones de navegación, en la columna izquierda.
    const caja = async (loc: ReturnType<Page['locator']>) => (await loc.boundingBox())!;
    const calendario = await caja(cal.getByLabel('Calendario', { exact: true }));
    const eventos = await caja(page.getByTestId('calendario-eventos'));
    const nav = await caja(page.getByRole('navigation', { name: 'Secciones del portal' }));
    expect(calendario.y).toBeLessThan(eventos.y);
    expect(eventos.y).toBeLessThan(nav.y);
    expect(Math.abs(calendario.x - nav.x)).toBeLessThan(2); // misma columna
    expect(calendario.x).toBeLessThan(300); // a la izquierda
    // El contenido (anuncios, políticas) queda a la derecha de la columna.
    const contenido = await caja(page.locator('.portal-th__contenido'));
    expect(contenido.x).toBeGreaterThan(calendario.x + calendario.width);

    // Hoy: viernes 9 de octubre de 2026, marcado y elegido; no tiene eventos y avisa el próximo.
    await expect(page.getByTestId('mes-titulo')).toHaveText('octubre 2026');
    const hoy = page.locator('[data-fecha="2026-10-09"]');
    await expect(hoy).toHaveAttribute('aria-current', 'date');
    await expect(hoy).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('eventos-titulo')).toHaveText('viernes, 9 de octubre de 2026');
    await expect(page.getByTestId('sin-eventos')).toContainText('No hay eventos para este día.');
    await expect(page.getByTestId('sin-eventos')).toContainText('Próximo: 12 de octubre de 2026 — Día de la Diversidad Étnica y Cultural.');
    // Sin permiso para editar: no hay botón de agregar.
    await expect(page.getByTestId('evento-agregar')).toHaveCount(0);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/50-calendario-escritorio.png` });

    // Festivo: lunes 12 de octubre.
    await page.locator('[data-fecha="2026-10-12"]').click();
    await expect(page.getByTestId('eventos-titulo')).toHaveText('lunes, 12 de octubre de 2026');
    await expect(page.getByTestId('evento-item')).toHaveCount(1);
    await expect(page.getByTestId('evento-item')).toContainText('Día de la Diversidad Étnica y Cultural');
    await expect(page.getByTestId('evento-item')).toContainText('Festivo');
    await expect(page.locator('[data-fecha="2026-10-12"]')).toHaveClass(/portal-th__cal-dia--festivo/);

    // Evento de la empresa (viene de la API) con su descripción.
    await page.locator('[data-fecha="2026-10-20"]').click();
    await expect(page.getByTestId('evento-item')).toContainText('Capacitación en trabajo seguro');
    await expect(page.getByTestId('evento-item')).toContainText('Sala 2, 8:00 a. m.');
    await expect(page.getByTestId('quitar-evento')).toHaveCount(0); // quien no edita no puede quitar
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/51-calendario-evento-empresa.png` });

    // Fecha laboral y conmemoración de ese mes: 31 de enero (otro mes) y navegación entre meses.
    await page.getByTestId('mes-siguiente').click();
    await expect(page.getByTestId('mes-titulo')).toHaveText('noviembre 2026');
    await page.locator('[data-fecha="2026-11-02"]').click();
    await expect(page.getByTestId('evento-item')).toContainText('Día de Todos los Santos');
    await page.locator('[data-fecha="2026-11-16"]').click();
    await expect(page.getByTestId('evento-item')).toContainText('Independencia de Cartagena');
    await page.getByTestId('mes-anterior').click();
    await page.getByTestId('mes-anterior').click();
    await expect(page.getByTestId('mes-titulo')).toHaveText('septiembre 2026');
    await page.locator('[data-fecha="2026-09-19"]').click();
    await expect(page.getByTestId('evento-item')).toContainText('Día del Amor y la Amistad');
    await expect(page.getByTestId('evento-item')).toContainText('Fecha importante');

    // "Hoy" regresa al mes y al día actuales.
    await page.getByTestId('calendario-hoy').click();
    await expect(page.getByTestId('mes-titulo')).toHaveText('octubre 2026');
    await expect(page.getByTestId('eventos-titulo')).toHaveText('viernes, 9 de octubre de 2026');
  });

  test('un día con festivo y evento de la empresa muestra primero el festivo; diciembre trae las fechas laborales', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    const estado = await preparar(page, { editor: false });
    estado.eventos.push({ id: 9, fecha: '2026-12-08', titulo: 'Cierre de año de Talento Humano', descripcion: null, tipo: 'empresa' });
    await page.goto('/portal');
    for (let i = 0; i < 2; i++) await page.getByTestId('mes-siguiente').click();
    await expect(page.getByTestId('mes-titulo')).toHaveText('diciembre 2026');
    await page.locator('[data-fecha="2026-12-08"]').click();
    const items = page.getByTestId('evento-item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('Día de la Inmaculada Concepción');
    await expect(items.nth(1)).toContainText('Cierre de año de Talento Humano');
    await page.locator('[data-fecha="2026-12-20"]').click();
    await expect(page.getByTestId('evento-item')).toContainText('Límite para pagar la prima de servicios (segundo semestre)');
    await expect(page.getByTestId('evento-item')).toContainText('Fecha laboral');
    await page.locator('[data-fecha="2026-12-25"]').click();
    await expect(page.getByTestId('evento-item')).toContainText('Navidad');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/52-calendario-diciembre.png` });
    // Cambio de año: enero de 2027 trae sus festivos (Reyes: lunes 11).
    await page.getByTestId('mes-siguiente').click();
    await expect(page.getByTestId('mes-titulo')).toHaveText('enero 2027');
    await page.locator('[data-fecha="2027-01-11"]').click();
    await expect(page.getByTestId('evento-item')).toContainText('Día de los Reyes Magos');
  });

  test('editor: agrega un evento (aviso verde ARRIBA y a la vista) y lo quita con confirmación', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    const estado = await preparar(page, { editor: true });
    await page.goto('/portal');
    await page.locator('[data-fecha="2026-10-22"]').click();
    await page.getByTestId('evento-agregar').click();
    const form = page.getByTestId('evento-form');
    await expect(form).toBeVisible();

    // Sin título: aviso rojo arriba y no se envía nada.
    await form.getByTestId('evento-guardar').click();
    await expect(page.getByTestId('calendario-aviso')).toContainText('Escriba el título del evento.');
    await expect(page.getByTestId('calendario-aviso')).toHaveClass(/portal-th__cal-aviso--error/);
    expect(estado.creados).toHaveLength(0);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/53-calendario-editor-error.png` });

    await form.getByTestId('evento-titulo').fill('Jornada de salud ocupacional');
    await form.getByTestId('evento-descripcion').fill('Auditorio principal');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/54-calendario-editor-formulario.png` });
    await form.getByTestId('evento-guardar').click();
    await expect(page.getByTestId('calendario-aviso')).toContainText('Evento agregado: Jornada de salud ocupacional.');
    await expect(page.getByTestId('calendario-aviso')).toHaveClass(/portal-th__cal-aviso--ok/);
    await expect(page.getByTestId('calendario-aviso')).toBeInViewport();
    expect(estado.creados).toEqual([{ fecha: '2026-10-22', titulo: 'Jornada de salud ocupacional', descripcion: 'Auditorio principal' }]);
    await expect(page.getByTestId('evento-item')).toContainText('Jornada de salud ocupacional');
    // El día ya tiene su punto naranja de "Empresa".
    await expect(page.locator('[data-fecha="2026-10-22"] .portal-th__cal-punto--empresa')).toHaveCount(1);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/55-calendario-editor-agregado.png` });

    // Quitar: pide confirmación; "No" cancela, "Quitar" borra.
    await page.getByTestId('quitar-evento').click();
    await page.getByRole('button', { name: 'No', exact: true }).click();
    await expect(page.getByTestId('evento-item')).toHaveCount(1);
    expect(estado.quitados).toEqual([]);
    await page.getByTestId('quitar-evento').click();
    await page.getByTestId('confirmar-quitar').click();
    await expect(page.getByTestId('calendario-aviso')).toContainText('Evento quitado: Jornada de salud ocupacional.');
    await expect(page.getByTestId('sin-eventos')).toBeVisible();
    expect(estado.quitados).toEqual([2]);
  });

  test('celular: el calendario viene plegado, se despliega y entra en la pantalla sin desplazamiento horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await preparar(page, { editor: false });
    await page.goto('/portal');
    const alternar = page.getByTestId('calendario-alternar');
    await expect(alternar).toBeVisible();
    await expect(alternar).toContainText('viernes, 9 de octubre de 2026');
    await expect(alternar).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByLabel('Calendario', { exact: true })).toBeHidden();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/56-calendario-celular-plegado.png` });

    await alternar.click();
    await expect(alternar).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByLabel('Calendario', { exact: true })).toBeVisible();
    await page.locator('[data-fecha="2026-10-12"]').click();
    await expect(page.getByTestId('evento-item')).toContainText('Día de la Diversidad Étnica y Cultural');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/57-calendario-celular-desplegado.png`, fullPage: true });
  });
});
