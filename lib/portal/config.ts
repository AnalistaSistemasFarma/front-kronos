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
 * Archivo con los correos autorizados que NO son de un dominio del grupo
 * —contratistas, personal sin correo corporativo—. Lo mantiene Talento Humano
 * en el mismo SharePoint. Si el archivo no existe, no hay excepciones y el
 * portal sigue funcionando con los dominios.
 *
 * Es un EXCEL porque así lo creó Cristian el 2026-09-09, y tiene sentido: es
 * la herramienta con la que Talento Humano trabaja, y pedirles un .txt para
 * ahorrarme diez líneas de código sería cargarles a ellos mi comodidad. El
 * lector acepta las dos cosas —`.xlsx` y texto plano—, así que si mañana
 * cambian de formato tampoco se rompe.
 */
export const ARCHIVO_EXCEPCIONES =
  process.env.PORTAL_TH_EXCEPCIONES ?? 'USUARIOS/Cuentas Autorizadas.xlsx';

/**
 * Cuánto se recuerda la lista de excepciones antes de volver a leerla.
 *
 * Sin esto, cada intento de ingreso sería un viaje a SharePoint. Un minuto es
 * el equilibrio: agregar a alguien se refleja casi de inmediato y no se
 * castiga a quien está entrando. Cada instancia del clúster tiene la suya, y
 * no importa: es una lista de solo lectura.
 */
export const EXCEPCIONES_CACHE_MS = 60_000;

/**
 * El subproceso que ES el permiso del módulo dentro del hub, igual que en el
 * resto de la plataforma. Se asigna desde Administración → Usuarios.
 * En minúsculas porque así se compara en la consulta.
 */
export const SUBPROCESO_PORTAL = '/process/portal-th';

/**
 * Quién puede CARGAR y BORRAR los anuncios del portal.
 *
 * Cristian pidió que "únicamente yo" pueda modificarlos. Va como lista y no
 * como un solo correo para que no haya que desplegar el día que se vaya de
 * vacaciones o entre alguien más de Talento Humano. Se sobrescribe con
 * `PORTAL_TH_EDITORES` (separados por coma).
 *
 * OJO: ser editor NO es lo mismo que ser administrador de SynerLink. Un
 * administrador de la plataforma no debería poder cambiar la cartelera de
 * Talento Humano solo por serlo.
 */
export function editoresDeBanners(): string[] {
  const crudo = (process.env.PORTAL_TH_EDITORES ?? '').trim();
  const lista = crudo
    ? crudo.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean)
    : ['cristian.baldion@gsslatam.com', 'nicolas.rivera@gsslatam.com'];
  return [...new Set(lista)];
}

/** Tope de una imagen de anuncio. El navegador ya la reduce antes de subir. */
export const MAX_BANNER_BYTES = 2 * 1024 * 1024;
/** Ancho máximo al que el navegador reduce la imagen antes de subirla. */
export const BANNER_ANCHO = 1600;
/** Formatos que se aceptan. */
export const BANNER_MIMES_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'];

/** Cuánto vive un código. Corto: es un dato que viaja por correo. */
export const CODIGO_VIGENCIA_MINUTOS = 10;
/** Intentos antes de invalidar el código. */
export const CODIGO_MAX_INTENTOS = 5;
/** Cuánto dura la sesión del portal. Una jornada. */
export const SESION_HORAS = 12;
/** Nombre de la cookie de sesión del portal. */
export const COOKIE_SESION = 'portal_th';
