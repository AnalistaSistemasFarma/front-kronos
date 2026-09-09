/**
 * PORTAL DE TALENTO HUMANO — configuración.
 *
 * Aparte del código a propósito: sumar una empresa al grupo tiene que ser un
 * cambio de configuración, no un despliegue. Los dominios se leen del entorno
 * y solo si no viene nada se cae a la lista que confirmó Cristian Baldión el
 * 2026-09-09.
 */

/** Dominios cuyo correo entra sin que nadie lo autorice uno por uno. */
const DOMINIOS_POR_DEFECTO = [
  'gsslatam.com',
  'onelatampharma.com',
  'farmalogica.com',
  'ryanlab.com',
  'abamialabs.com',
  'meditrack.com.co',
  'kelabanalitica.com',
  'bioselect.com.co',
  'farmadosis.com.co',
];

/**
 * Los dominios del grupo, en minúsculas y sin arroba.
 *
 * `PORTAL_TH_DOMINIOS` los reemplaza por completo (separados por coma). No se
 * suman a los de por defecto: si mañana hay que QUITAR una empresa, sumar
 * dejaría el dominio viejo vivo para siempre.
 *
 * Quedaron FUERA a decisión de Cristian, aunque tengan gente en SynerLink:
 * `groupsharedservices.com` y `unidossis.com.co`. Si esas personas necesitan
 * entrar, se agregan a la lista de excepciones —no aquí—, y así queda claro
 * que son casos aparte.
 */
export function dominiosAutorizados(): string[] {
  const crudo = (process.env.PORTAL_TH_DOMINIOS ?? '').trim();
  const lista = crudo
    ? crudo.split(',').map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean)
    : DOMINIOS_POR_DEFECTO;
  return [...new Set(lista)];
}

/** El sitio de SharePoint de donde sale el contenido. */
export const SITIO_TH = process.env.PORTAL_TH_SITIO ?? 'TalentoHumano';

/**
 * El conector de SharePoint de GSS.
 *
 * POR QUÉ SE PASA POR EL CONECTOR Y NO SE LLAMA A GRAPH DIRECTO: las
 * credenciales de Microsoft que tiene este front (`MICROSOFTCLIENTID`) son del
 * tenant de **Farmalógica**, y el sitio de Talento Humano está en el de
 * **GSS** — con las de aquí, sencillamente no se ve. La alternativa era meterle
 * al front un segundo juego de credenciales, de otro tenant y con permisos
 * amplios; en vez de eso se reutiliza `mcp-sharepoint-gss`, que ya vive en
 * serfarma05, ya tiene ese acceso y es de SOLO LECTURA. El front no gana
 * ningún secreto nuevo.
 */
export const CONECTOR_SHAREPOINT_GSS =
  process.env.PORTAL_TH_CONECTOR ?? 'http://192.168.10.5:3017/mcp';

/** Carpetas dentro de la biblioteca "Documentos" del sitio. */
export const CARPETA_DOCUMENTOS = process.env.PORTAL_TH_CARPETA_DOCS ?? 'POLITICAS Y REGLAMENTOS';
export const CARPETA_IMAGENES = process.env.PORTAL_TH_CARPETA_IMGS ?? 'IMAGENES';
/**
 * Carpeta de anuncios y cumpleaños. Separada de las portadas a propósito: una
 * portada acompaña a un documento y vive con él; un anuncio va y viene.
 */
export const CARPETA_BANNERS = process.env.PORTAL_TH_CARPETA_BANNERS ?? 'BANNERS';

/**
 * Archivo con los correos autorizados que NO son de un dominio del grupo
 * —contratistas, personal sin correo corporativo—. Lo mantiene Talento Humano
 * en el mismo SharePoint: un correo por línea, y las líneas que empiezan por
 * `#` se ignoran. Si el archivo no existe, sencillamente no hay excepciones.
 */
export const ARCHIVO_EXCEPCIONES =
  process.env.PORTAL_TH_EXCEPCIONES ?? 'CORREOS AUTORIZADOS.txt';

/**
 * El subproceso que ES el permiso del módulo dentro del hub, igual que en el
 * resto de la plataforma. Se asigna desde Administración → Usuarios.
 * En minúsculas porque así se compara en la consulta.
 */
export const SUBPROCESO_PORTAL = '/process/portal-th';

/** Cuánto vive un código. Corto: es un dato que viaja por correo. */
export const CODIGO_VIGENCIA_MINUTOS = 10;
/** Intentos antes de invalidar el código. */
export const CODIGO_MAX_INTENTOS = 5;
/** Cuánto dura la sesión del portal. Una jornada. */
export const SESION_HORAS = 12;
/** Nombre de la cookie de sesión del portal. */
export const COOKIE_SESION = 'portal_th';
