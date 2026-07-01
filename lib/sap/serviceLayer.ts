import * as https from 'https';

/**
 * Cliente server-side del SAP Service Layer (OData v1).
 *
 * Centraliza Login / GET / Logout para no repetir el patron en cada route
 * (hoy esta suelto en app/api/purchase-request/*). Pensado para uso EXCLUSIVO
 * en el servidor: las credenciales nunca deben viajar al navegador.
 *
 * Los Service Layer de las empresas usan certificados autofirmados, por eso el
 * agente HTTPS deshabilita la verificacion TLS (igual que SAPSEND y el modulo
 * de compras actual).
 */

const sapAgent = new https.Agent({ rejectUnauthorized: false });

export class SapError extends Error {
  status: number;
  detail: string;
  companyId?: number;

  constructor(message: string, status: number, detail = '', companyId?: number) {
    super(message);
    this.name = 'SapError';
    this.status = status;
    this.detail = detail;
    this.companyId = companyId;
  }
}

export interface SapCredentials {
  /** Ej. https://servicelayer.gsslatam.com:50000 (con o sin barra final). */
  baseUrl: string;
  username: string;
  password: string;
  /** CompanyDB de SAP B1 (ej. FARMALOGICA_PROD). */
  companyDB: string;
}

export interface SapSession {
  sessionId: string;
  baseUrl: string;
  expiresAt: number;
}

/** Quita barras finales para construir las URLs de forma consistente. */
function normalizeBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/**
 * Inicia sesion en el Service Layer y devuelve el B1SESSION.
 * No registra credenciales en consola.
 */
export async function sapLogin(creds: SapCredentials): Promise<SapSession> {
  const baseUrl = normalizeBase(creds.baseUrl);

  const response = await fetch(`${baseUrl}/b1s/v1/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      UserName: creds.username,
      Password: creds.password,
      CompanyDB: creds.companyDB,
    }),
    // @ts-expect-error - Node.js fetch admite un agent para los certificados autofirmados
    agent: sapAgent,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new SapError(`SAP Login fallido (${response.status})`, response.status, detail);
  }

  const data = await response.json();
  const sessionId: string | undefined = data?.SessionId;
  if (!sessionId) {
    throw new SapError('SAP Login no devolvio SessionId', 502);
  }

  // SessionTimeout viene en minutos; por defecto SAP usa 30.
  const timeoutMin = typeof data?.SessionTimeout === 'number' ? data.SessionTimeout : 30;
  return {
    sessionId,
    baseUrl,
    expiresAt: Date.now() + timeoutMin * 60 * 1000,
  };
}

/**
 * GET generico al Service Layer. `path` es la ruta relativa a /b1s/v1/
 * (ej. "FAR_RegiSanitario?$top=1"). Lanza SapError(401) si la sesion expiro.
 */
export async function sapGet<T = unknown>(
  session: SapSession,
  path: string,
  extraHeaders?: Record<string, string>
): Promise<T> {
  const url = `${session.baseUrl}/b1s/v1/${path.replace(/^\/+/, '')}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `B1SESSION=${session.sessionId}`,
      ...extraHeaders,
    },
    // @ts-expect-error - Node.js fetch admite un agent
    agent: sapAgent,
  });

  if (response.status === 401) {
    throw new SapError('Sesion SAP expirada o invalida', 401);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new SapError(`SAP GET ${path} fallo (${response.status})`, response.status, detail);
  }

  return response.json() as Promise<T>;
}

/**
 * GET que recorre TODA la paginacion del Service Layer. SAP entrega por paginas
 * (PageSize por defecto = 20, sin importar el $top); este helper pide paginas
 * grandes con el header `Prefer: odata.maxpagesize` y sigue `@odata.nextLink`
 * (u `odata.nextLink`) hasta agotar el conjunto o alcanzar `cap` filas (tope de
 * seguridad). Reutilizable por todos los modulos para "ver/descargar todo".
 */
export async function sapGetAll<T = Record<string, unknown>>(
  session: SapSession,
  path: string,
  opts: { pageSize?: number; cap?: number } = {}
): Promise<T[]> {
  const pageSize = opts.pageSize ?? 500;
  const cap = opts.cap ?? 20000;
  const headers = { Prefer: `odata.maxpagesize=${pageSize}` };

  const out: T[] = [];
  let next: string | null = path.replace(/^\/+/, '');

  while (next && out.length < cap) {
    const page: { value?: T[]; 'odata.nextLink'?: string; '@odata.nextLink'?: string } =
      await sapGet(session, next, headers);
    out.push(...(page.value ?? []));
    const link = page['@odata.nextLink'] ?? page['odata.nextLink'] ?? null;
    next = link ? link.replace(/^\/+/, '') : null;
  }

  return out.slice(0, cap);
}

/**
 * POST generico al Service Layer (ej. crear un UDO). Devuelve el cuerpo de la
 * respuesta (en SAP B1, el objeto creado, con DocEntry/DocNum).
 */
export async function sapPost<T = unknown>(
  session: SapSession,
  path: string,
  body: unknown
): Promise<T> {
  const url = `${session.baseUrl}/b1s/v1/${path.replace(/^\/+/, '')}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `B1SESSION=${session.sessionId}`,
    },
    body: JSON.stringify(body),
    // @ts-expect-error - Node.js fetch admite un agent
    agent: sapAgent,
  });

  if (response.status === 401) {
    throw new SapError('Sesion SAP expirada o invalida', 401);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new SapError(`SAP POST ${path} fallo (${response.status})`, response.status, detail);
  }

  return response.json() as Promise<T>;
}

/**
 * PATCH generico al Service Layer (ej. editar un UDO o agregar lineas a una
 * coleccion hija). SAP responde 204 No Content en exito.
 *
 * `replaceCollections=true` agrega el header B1S-ReplaceCollectionsOnPatch, que
 * REEMPLAZA las colecciones hijas en vez de hacer merge/append. Para AGREGAR
 * un log a la bitacora (append), dejarlo en false.
 */
export async function sapPatch(
  session: SapSession,
  path: string,
  body: unknown,
  replaceCollections = false
): Promise<void> {
  const url = `${session.baseUrl}/b1s/v1/${path.replace(/^\/+/, '')}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Cookie: `B1SESSION=${session.sessionId}`,
  };
  if (replaceCollections) headers['B1S-ReplaceCollectionsOnPatch'] = 'true';

  const response = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
    // @ts-expect-error - Node.js fetch admite un agent
    agent: sapAgent,
  });

  if (response.status === 401) {
    throw new SapError('Sesion SAP expirada o invalida', 401);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new SapError(`SAP PATCH ${path} fallo (${response.status})`, response.status, detail);
  }
}

/** Elimina un recurso del Service Layer (DELETE entity(key)). */
export async function sapDelete(session: SapSession, path: string): Promise<void> {
  const url = `${session.baseUrl}/b1s/v1/${path.replace(/^\/+/, '')}`;

  const response = await fetch(url, {
    method: 'DELETE',
    headers: { Cookie: `B1SESSION=${session.sessionId}` },
    // @ts-expect-error - Node.js fetch admite un agent
    agent: sapAgent,
  });

  if (response.status === 401) {
    throw new SapError('Sesion SAP expirada o invalida', 401);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new SapError(`SAP DELETE ${path} fallo (${response.status})`, response.status, detail);
  }
}

/** Cierra la sesion del Service Layer. Best-effort: no lanza si falla. */
export async function sapLogout(session: SapSession): Promise<void> {
  try {
    await fetch(`${session.baseUrl}/b1s/v1/Logout`, {
      method: 'POST',
      headers: { Cookie: `B1SESSION=${session.sessionId}` },
      // @ts-expect-error - Node.js fetch admite un agent
      agent: sapAgent,
    });
  } catch {
    // El cierre de sesion no es critico para la respuesta al usuario.
  }
}
