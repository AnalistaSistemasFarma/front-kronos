/**

 * Permiso de gestión de firma digital (Orion / GSS Firma).

 *

 * No es un “rol coordinador”: es un subproceso asignable en

 * Administración → Usuarios. El permiso es de la PERSONA (válido en cualquier

 * empresa/solicitud); la empresa del selector del admin solo es el canal de

 * guardado del modelo subprocess_user_company.

 *

 * Quien lo tenga puede:

 * - Ver la categoría FIRMA al crear solicitudes

 * - Crear/cargar PDF, ubicar firmas, asignar firmantes y enviar

 *

 * URL estable (permiso; no abre página en el hub).

 */



export const ORION_FIRMA_MANAGE_URL = '/process/firma/manage';

export const ORION_FIRMA_MANAGE_NAME = 'Firma digital';



/** Categoría o proceso de solicitud de firma (UI / gates de creación). */

export function isFirmaRequestCategoryOrProcess(

  category?: string | null,

  process?: string | null

): boolean {

  return /FIRMA/i.test(String(category || '')) || /FIRMA/i.test(String(process || ''));

}



/** Subproceso de permiso (oculto en el hub de Procesos). */

export function isOrionFirmaManageSubprocess(subprocess: {

  subprocess?: string | null;

  subprocess_url?: string | null;

}): boolean {

  const url = String(subprocess.subprocess_url || '')

    .toLowerCase()

    .trim();

  if (url === ORION_FIRMA_MANAGE_URL.toLowerCase()) return true;

  if (url.includes('/firma/manage')) return true;



  const name = String(subprocess.subprocess || '')

    .toLowerCase()

    .trim();

  return (

    name === 'firma digital' ||

    name === 'permiso de firma' ||

    name.includes('firma digital')

  );

}


