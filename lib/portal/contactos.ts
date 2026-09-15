/**
 * PORTAL DE TALENTO HUMANO — Correos Corporativos con licencia activa.
 *
 * Igual criterio que `sharepoint.ts`: no se llama a Microsoft Graph directo
 * desde este front (evitaría meterle credenciales de 7 tenants distintos a
 * una sola app). Se reusan los conectores de solo lectura que ya viven en
 * serfarma05, cada uno con las credenciales de SU propio tenant, y que desde
 * 2026-09-15 tienen la herramienta `usuarios_licencia_activa` (agregada a
 * pedido de Cristian Baldión para este mismo botón).
 *
 * Empresas sin conector propio (Abamia, Meditrack, Kelab: hoy solo tienen
 * credenciales sueltas en el `.env` de su SAPSEND, sin conector HTTP propio;
 * Bioselect y Farmadosis: sin ninguna app de Azure registrada) se devuelven
 * con estado `sin_acceso` en vez de omitirse, para que quede visible qué
 * falta configurar.
 */

export interface UsuarioLicencia {
  nombre: string;
  correo: string;
}

export interface GrupoEmpresa {
  empresa: string;
  dominio: string;
  estado: 'ok' | 'sin_acceso';
  usuarios: UsuarioLicencia[];
}

interface ConectorEmpresa {
  empresa: string;
  dominio: string;
  url: string | null;
}

/** Un conector por empresa. `null` = no hay app de Azure/conector todavía. */
const EMPRESAS: ConectorEmpresa[] = [
  { empresa: 'GSS', dominio: 'gsslatam.com', url: process.env.PORTAL_TH_CONECTOR_GSS ?? 'http://192.168.10.5:3017/mcp' },
  { empresa: 'ONE LATAM PHARMA', dominio: 'onelatampharma.com', url: process.env.PORTAL_TH_CONECTOR_OLP ?? 'http://192.168.10.5:3018/mcp' },
  { empresa: 'FARMALÓGICA', dominio: 'farmalogica.com', url: process.env.PORTAL_TH_CONECTOR_FARMALOGICA ?? 'http://192.168.10.5:3019/mcp' },
  { empresa: 'RYAN', dominio: 'ryanlab.com', url: process.env.PORTAL_TH_CONECTOR_RYAN ?? 'http://192.168.10.5:3023/mcp' },
  { empresa: 'ABAMIA', dominio: 'abamialabs.com', url: process.env.PORTAL_TH_CONECTOR_ABAMIA ?? null },
  { empresa: 'MEDITRACK', dominio: 'meditrack.com.co', url: process.env.PORTAL_TH_CONECTOR_MEDITRACK ?? null },
  { empresa: 'KELAB', dominio: 'kelabanalitica.com', url: process.env.PORTAL_TH_CONECTOR_KELAB ?? null },
  { empresa: 'BIOSELECT', dominio: 'bioselect.com.co', url: null },
  { empresa: 'FARMADOSIS', dominio: 'farmadosis.com.co', url: null },
];

let contadorLlamadas = 0;

/**
 * Llama una herramienta de un conector MCP por HTTP (transporte
 * "streamable-http", sin sesión). Copia deliberada de la de `sharepoint.ts`:
 * esa apunta siempre a `CONECTOR_SHAREPOINT_GSS`, y acá hace falta la misma
 * llamada contra varias URLs distintas (una por tenant).
 */
async function llamarConector(url: string, tool: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++contadorLlamadas,
      method: 'tools/call',
      params: { name: tool, arguments: args },
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) throw new Error(`conector ${tool}: HTTP ${res.status}`);

  const texto = await res.text();
  const linea = texto
    .split('\n')
    .map((l) => l.replace(/^data:\s*/, '').trim())
    .find((l) => l.startsWith('{'));
  if (!linea) throw new Error(`conector ${tool}: respuesta vacía`);

  const sobre = JSON.parse(linea) as {
    error?: { message?: string };
    result?: { content?: { type: string; text?: string }[]; isError?: boolean };
  };
  if (sobre.error) throw new Error(`conector ${tool}: ${sobre.error.message ?? 'error'}`);

  const bloque = sobre.result?.content?.find((c) => c.type === 'text')?.text ?? '';
  if (sobre.result?.isError) throw new Error(`conector ${tool}: ${bloque.slice(0, 200)}`);
  return bloque ? JSON.parse(bloque) : null;
}

/** Cuánto se recuerda la lista antes de volver a consultar los conectores. */
const CACHE_MS = 5 * 60_000;
let cache: { cuando: number; grupos: GrupoEmpresa[] } | null = null;

/**
 * Los correos con licencia activa de M365, agrupados por empresa.
 *
 * Las llamadas a los 4 conectores existentes van en paralelo: son
 * independientes y esperarlas una detrás de otra solo haría la ventana más
 * lenta. Si uno falla (conector caído, token vencido), esa empresa queda como
 * `sin_acceso` en vez de tumbar la respuesta completa — las demás sí se ven.
 */
export async function leerCorreosCorporativos(): Promise<GrupoEmpresa[]> {
  if (cache && Date.now() - cache.cuando < CACHE_MS) return cache.grupos;

  const grupos = await Promise.all(
    EMPRESAS.map(async ({ empresa, dominio, url }): Promise<GrupoEmpresa> => {
      if (!url) return { empresa, dominio, estado: 'sin_acceso', usuarios: [] };
      try {
        const data = (await llamarConector(url, 'usuarios_licencia_activa', {})) as
          | { usuarios?: UsuarioLicencia[] }
          | null;
        return { empresa, dominio, estado: 'ok', usuarios: data?.usuarios ?? [] };
      } catch (error) {
        console.warn(`[portal] correos corporativos, ${empresa}:`, (error as Error).message);
        return { empresa, dominio, estado: 'sin_acceso', usuarios: [] };
      }
    })
  );

  cache = { cuando: Date.now(), grupos };
  return grupos;
}
