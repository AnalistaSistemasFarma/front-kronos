import { expect, test, type Page } from '@playwright/test';

/**
 * Portal TH · Formación · «Editar» (menú de edición oculto) e «Invitar al Curso» (Cristian Baldión, 2026-10-14).
 * Sin sesión real ni correo: las APIs del portal se simulan con `page.route`; NINGÚN correo sale. Con
 * `FORMACION_CAPTURAS=<carpeta>` guarda capturas para la revisión.
 */

const CAPTURAS = process.env.FORMACION_CAPTURAS;
const curso = { id: 2, titulo: 'INDUCCIÓN SISTEMAS', descripcion: 'Inducción del área de tecnología', activo: true, creadoPor: 'th@gsslatam.com' };
const materiales = [
  { id: 1, tipo: 'DOCUMENT', titulo: 'INDUCCIÓN SISTEMAS', orden: 0, url: null, nombreArchivo: 'INDUCCION SISTEMAS (1).mp4', mime: 'video/mp4', obligatorio: true, completadoEl: null },
  { id: 2, tipo: 'DOCUMENT', titulo: 'CAMPAÑA MALWARE', orden: 1, url: null, nombreArchivo: 'CAMPAÑA MALWARE (1).mp4', mime: 'video/mp4', obligatorio: true, completadoEl: null },
];
const ana = { correo: 'cristian.baldion@gsslatam.com', nombre: 'Cristian Baldion', inscritoEl: '2026-10-01T00:00:00Z', porcentaje: 0, materialesCompletados: [] as number[], certificado: null };

async function simularFormador(page: Page) {
  const estado = { roster: [{ ...ana }], invitaciones: [] as Record<string, unknown>[] };
  await page.route('**/api/portal/courses', (r) =>
    r.fulfill({ json: { esFormador: true, cursos: [{ ...curso, totalMateriales: 2, totalInscritos: 1, inscrito: true, porcentaje: 0, certificado: null }] } })
  );
  await page.route('**/api/portal/courses/2', (r) =>
    r.fulfill({ json: { curso, esFormador: true, puedeMarcarManual: true, porcentaje: 0, materiales, certificado: null } })
  );
  await page.route('**/api/portal/courses/2/roster', (r) => r.fulfill({ json: { estudiantes: estado.roster } }));
  await page.route('**/api/portal/courses/2/invitar', async (r) => {
    const { correo } = r.request().postDataJSON() as { correo: string };
    estado.invitaciones.push({ correo });
    if (correo.includes('gmail')) {
      return r.fulfill({ status: 422, json: { error: 'Ese correo no está autorizado para entrar al portal: debe ser de un dominio del grupo o estar en «Cuentas Autorizadas».' } });
    }
    estado.roster.push({ ...ana, correo, nombre: correo.split('@')[0].replace('.', ' ') });
    return r.fulfill({ json: { ok: true, correo, yaInscrito: false } });
  });
  return estado;
}

async function abrirCursoFormador(page: Page) {
  await page.goto('/portal/formacion');
  await page.getByRole('button', { name: 'Vista formador' }).click();
  await page.getByRole('button', { name: /INDUCCIÓN SISTEMAS/ }).click();
  await expect(page.getByRole('heading', { name: 'INDUCCIÓN SISTEMAS' })).toBeVisible();
}

test.describe('Portal TH · Formación · «Editar» e «Invitar al Curso»', () => {
  test('la ruta de invitar exige sesión', async ({ request }) => {
    expect((await request.post('/api/portal/courses/2/invitar', { data: { correo: 'ana@gsslatam.com' } })).status()).toBe(401);
  });

  test('«Vista formador»: al entrar solo se ve el nombre del curso y el progreso; «Editar» muestra todo el menú de edición', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simularFormador(page);
    await abrirCursoFormador(page);

    // Oculto: título editable, publicar, materiales y agregar material. Visible: nombre, descripción y progreso.
    await expect(page.getByRole('heading', { name: 'Progreso de los estudiantes' })).toBeVisible();
    await expect(page.getByText('Inducción del área de tecnología')).toBeVisible();
    await expect(page.getByTestId('menu-edicion')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Materiales' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '+ Agregar material' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Pasar a borrador' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Editar título y descripción' })).toHaveCount(0);
    const editar = page.getByTestId('alternar-edicion');
    await expect(editar).toHaveText('Editar');
    await expect(editar).toHaveAttribute('aria-expanded', 'false');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/80-formador-menu-oculto.png`, fullPage: true });

    // «Editar»: aparecen las opciones de edición y el progreso sigue ahí.
    await editar.click();
    await expect(editar).toHaveText('Cerrar edición');
    await expect(editar).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('menu-edicion')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Materiales' })).toBeVisible();
    await expect(page.getByText('CAMPAÑA MALWARE', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Agregar material' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pasar a borrador' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Editar título y descripción' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Progreso de los estudiantes' })).toBeVisible();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/81-formador-menu-visible.png`, fullPage: true });

    // «Cerrar edición» lo vuelve a ocultar, y también cierra el editor del título si estaba abierto.
    await page.getByRole('button', { name: 'Editar título y descripción' }).click();
    await expect(page.getByLabel('Título del curso')).toBeVisible();
    await page.getByLabel('Título del curso').press('Escape');
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await editar.click();
    await expect(page.getByTestId('menu-edicion')).toHaveCount(0);
    await expect(page.getByLabel('Título del curso')).toHaveCount(0);
  });

  test('«Invitar al Curso»: pide el correo, avisa los errores arriba y en rojo, y al enviar confirma en verde y suma a la persona', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    const estado = await simularFormador(page);
    await abrirCursoFormador(page);

    // El botón queda a la derecha del título «Progreso de los estudiantes».
    const titulo = await page.getByRole('heading', { name: 'Progreso de los estudiantes' }).boundingBox();
    const boton = page.getByTestId('invitar-curso');
    const cajaBoton = (await boton.boundingBox())!;
    expect(cajaBoton.x).toBeGreaterThan(titulo!.x + titulo!.width);
    expect(Math.abs(cajaBoton.y + cajaBoton.height / 2 - (titulo!.y + titulo!.height / 2))).toBeLessThan(24);
    await expect(boton).toHaveText('Invitar al Curso');
    await expect(page.getByTestId('invitar-form')).toHaveCount(0);

    await boton.click();
    const form = page.getByTestId('invitar-form');
    await expect(form).toBeVisible();
    await expect(form.getByTestId('invitar-correo')).toBeFocused();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/82-invitar-formulario.png`, fullPage: true });

    // Vacío: error en rojo, sin llamar al servidor.
    await form.getByTestId('invitar-enviar').click();
    await expect(form.getByTestId('invitar-aviso')).toHaveText('Escriba el correo de la persona.');
    await expect(form.getByTestId('invitar-aviso')).toHaveAttribute('data-tipo', 'error');
    expect(estado.invitaciones).toHaveLength(0);

    // Un correo que no puede entrar al portal: el servidor lo rechaza y se muestra en rojo.
    await form.getByTestId('invitar-correo').fill('alguien@gmail.com');
    await form.getByTestId('invitar-enviar').click();
    await expect(form.getByTestId('invitar-aviso')).toContainText('no está autorizado para entrar al portal');
    await expect(form.getByTestId('invitar-aviso')).toHaveAttribute('data-tipo', 'error');
    await expect(form.getByTestId('invitar-correo')).toHaveValue('alguien@gmail.com'); // no se pierde lo escrito
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/83-invitar-error.png` });

    // Un correo válido: confirma en verde, limpia el campo y la persona aparece en el progreso.
    await form.getByTestId('invitar-correo').fill('nueva.persona@gsslatam.com');
    await form.getByTestId('invitar-enviar').click();
    await expect(form.getByTestId('invitar-aviso')).toHaveText('Invitación enviada a nueva.persona@gsslatam.com. Quedó inscrita en el curso.');
    await expect(form.getByTestId('invitar-aviso')).toHaveAttribute('data-tipo', 'ok');
    await expect(form.getByTestId('invitar-correo')).toHaveValue('');
    await expect(form.getByTestId('invitar-aviso')).toBeInViewport();
    expect(estado.invitaciones).toEqual([{ correo: 'alguien@gmail.com' }, { correo: 'nueva.persona@gsslatam.com' }]);
    await expect(page.getByRole('row', { name: /nueva persona/ })).toBeVisible();
    await page.waitForTimeout(500);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/84-invitar-enviada.png`, fullPage: true });

    await form.getByRole('button', { name: 'Cerrar' }).click();
    await expect(page.getByTestId('invitar-form')).toHaveCount(0);
  });

  test('celular: «Invitar al Curso» cabe en la pantalla', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await simularFormador(page);
    await abrirCursoFormador(page);
    await page.getByTestId('invitar-curso').click();
    await expect(page.getByTestId('invitar-form')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/85-invitar-celular.png`, fullPage: true });
  });

  test('el enlace del correo abre el curso apenas carga Formación (estudiante con sesión)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.route('**/api/portal/courses', (r) =>
      r.fulfill({ json: { esFormador: false, cursos: [{ ...curso, totalMateriales: 2, totalInscritos: 1, inscrito: false, porcentaje: 0, certificado: null }] } })
    );
    await page.route('**/api/portal/courses/2', (r) =>
      r.fulfill({ json: { curso, esFormador: false, puedeMarcarManual: false, porcentaje: 0, materiales, certificado: null } })
    );
    await page.goto('/portal/formacion?curso=2');
    // Entra directo al curso: sin pasar por la lista.
    await expect(page.getByRole('button', { name: '← Volver a Formación' })).toBeVisible();
    await expect(page.getByText('INDUCCIÓN SISTEMAS').first()).toBeVisible();
    await expect(page.getByText('CAMPAÑA MALWARE', { exact: true })).toBeVisible();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/86-enlace-abre-el-curso.png` });
  });

  test('un enlace a un curso que no existe o está en borrador avisa y deja la lista de cursos', async ({ page }) => {
    await page.route('**/api/portal/courses', (r) =>
      r.fulfill({ json: { esFormador: false, cursos: [{ ...curso, totalMateriales: 2, totalInscritos: 1, inscrito: true, porcentaje: 0, certificado: null }] } })
    );
    await page.goto('/portal/formacion?curso=99');
    await expect(page.getByText('El curso al que lo invitaron ya no está disponible.')).toBeVisible();
    await expect(page.getByRole('button', { name: /INDUCCIÓN SISTEMAS/ })).toBeVisible();
    // Un valor raro en la URL se ignora: abre la lista normal, sin error.
    await page.goto('/portal/formacion?curso=2;DROP');
    await expect(page.getByText('El curso al que lo invitaron ya no está disponible.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /INDUCCIÓN SISTEMAS/ })).toBeVisible();
  });

  test('sin sesión: el enlace de la invitación invita a ingresar y vuelve al mismo curso', async ({ page }) => {
    await page.route('**/api/portal/courses', (r) => r.fulfill({ status: 401, json: { error: 'Sesión no válida.' } }));
    await page.goto('/portal/formacion?curso=2');
    await expect(page.getByText('Lo invitaron a un curso de Formación.')).toBeVisible();
    const ingresar = page.getByTestId('ingresar-invitacion');
    await expect(ingresar).toHaveText('Ingresar al portal');
    await expect(ingresar).toHaveAttribute('href', '/portal?siguiente=%2Fportal%2Fformacion%3Fcurso%3D2');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/87-invitacion-sin-sesion.png` });
    // Sin invitación: el aviso de siempre.
    await page.goto('/portal/formacion');
    await expect(page.getByText('Ingrese primero al portal')).toBeVisible();
    await expect(page.getByTestId('ingresar-invitacion')).toHaveAttribute('href', '/portal');
  });

  test('al ingresar con el código desde una invitación, regresa a Formación; una URL externa se ignora', async ({ page }) => {
    await page.route('**/api/portal/content', (r) => r.fulfill({ status: 401, json: { error: 'Sesión no válida.' } }));
    await page.route('**/api/portal/login', (r) => r.fulfill({ json: { ok: true, mensaje: 'Si su correo está autorizado, le llegará un código.' } }));
    await page.route('**/api/portal/verify', (r) => r.fulfill({ json: { ok: true } }));
    await page.route('**/api/portal/courses', (r) => r.fulfill({ status: 401, json: { error: 'x' } }));

    const ingresar = async () => {
      await page.getByPlaceholder('nombre.apellido@empresa.com').fill('nueva.persona@gsslatam.com');
      await page.getByRole('button', { name: 'Enviarme el código' }).click();
      await page.getByPlaceholder('000000').fill('123456');
      await page.getByRole('button', { name: 'Entrar' }).click();
    };

    await page.goto('/portal?siguiente=%2Fportal%2Fformacion%3Fcurso%3D2');
    await ingresar();
    await page.waitForURL('**/portal/formacion?curso=2');

    // Un destino externo NO se sigue: se queda en el portal.
    await page.goto('/portal?siguiente=https%3A%2F%2Fevil.example.com%2F');
    await ingresar();
    await page.waitForTimeout(800);
    expect(new URL(page.url()).hostname).not.toBe('evil.example.com');
    expect(new URL(page.url()).pathname).toBe('/portal');
  });
});
