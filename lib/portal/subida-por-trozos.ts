/**
 * PORTAL DE TALENTO HUMANO — FORMACIÓN — subida DIRECTA del navegador a
 * SharePoint, por trozos, sin tope de tamaño.
 *
 * Pedido de Cristian Baldión (2026-10-08): "quita ese límite de peso en los
 * archivos, recuerda que todo queda en el sitio de Talento Humano". Antes el
 * archivo viajaba entero al servidor (multipart) y había un tope de 25 MB; en
 * producción, además, IIS/ARR corta los cuerpos de más de ~30 MB.
 *
 * Ahora:
 *   1. El servidor (con sesión del portal y permiso de formador) abre una
 *      upload session de Graph en FORMACION/<curso>/materiales y devuelve
 *      SOLO la `uploadUrl` (preautorizada, temporal, válida para ese archivo).
 *   2. Este módulo sube el archivo a esa URL en trozos de 10 MiB (múltiplo de
 *      320 KiB, como exige Graph), con progreso, reintento por trozo y
 *      cancelación.
 *   3. Con el `driveItem` resultante, el servidor registra el material.
 *
 * Así el archivo no pasa ni por Next ni por IIS.
 *
 * Este archivo corre en el NAVEGADOR: no importa nada de servidor ni conoce
 * ninguna credencial. A la `uploadUrl` no se le manda `Authorization` (Graph
 * la rechaza si se incluye).
 */

/** 10 MiB = 32 × 320 KiB. Graph exige múltiplos de 320 KiB y máximo 60 MiB. */
export const TAMANO_TROZO_NAVEGADOR = 320 * 1024 * 32;

/** El usuario canceló la subida. */
export class SubidaCancelada extends Error {
  constructor() {
    super('Subida cancelada.');
    this.name = 'SubidaCancelada';
  }
}

/** La subida no se pudo completar (después de los reintentos). */
export class SubidaFallida extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'SubidaFallida';
  }
}

export interface ResultadoSubida {
  driveItemId: string;
  nombre: string;
  tamano: number;
}

export interface OpcionesSubidaPorTrozos {
  archivo: Blob;
  uploadUrl: string;
  /** Debe ser múltiplo de 320 KiB. Por defecto 10 MiB. */
  tamanoTrozo?: number;
  /** Reintentos por trozo ante fallas de red, 429 o 5xx. Por defecto 4. */
  reintentos?: number;
  /** Espera base del reintento (se duplica en cada intento). Por defecto 1 s. */
  esperaBaseMs?: number;
  signal?: AbortSignal;
  onProgreso?: (subidos: number, total: number) => void;
  /** Inyectables para las pruebas. */
  fetch?: typeof fetch;
  esperar?: (ms: number) => Promise<void>;
}

const MULTIPLO = 320 * 1024;

const esperarPorDefecto = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** `["10485760-", ...]` → 10485760. */
function inicioEsperado(rangos: unknown): number | null {
  if (!Array.isArray(rangos) || typeof rangos[0] !== 'string') return null;
  const n = Number(rangos[0].split('-')[0]);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** Status que vale la pena reintentar. */
const reintentable = (status: number) => status === 429 || status >= 500;

/**
 * Sube `archivo` a la `uploadUrl` de una upload session de Graph. Devuelve
 * el driveItem creado. Si se cancela o falla definitivamente, cierra la
 * sesión (DELETE a la uploadUrl) para no dejar un archivo a medias.
 */
export async function subirPorTrozos(op: OpcionesSubidaPorTrozos): Promise<ResultadoSubida> {
  const f = op.fetch ?? fetch;
  const esperar = op.esperar ?? esperarPorDefecto;
  const trozo = op.tamanoTrozo ?? TAMANO_TROZO_NAVEGADOR;
  const reintentos = op.reintentos ?? 4;
  const esperaBase = op.esperaBaseMs ?? 1000;
  const total = op.archivo.size;
  if (trozo <= 0 || trozo % MULTIPLO !== 0) throw new Error('El tamaño del trozo debe ser múltiplo de 320 KiB.');
  if (total <= 0) throw new SubidaFallida('El archivo está vacío.');

  const cerrarSesion = () => f(op.uploadUrl, { method: 'DELETE' }).then(() => undefined, () => undefined);
  const verificarCancelado = () => {
    if (op.signal?.aborted) throw new SubidaCancelada();
  };

  /** Pregunta a Graph desde qué byte sigue (tras una falla). */
  const consultarAvance = async (): Promise<number | null> => {
    try {
      const res = await f(op.uploadUrl, { method: 'GET', signal: op.signal });
      if (!res.ok) return null;
      const data = (await res.json().catch(() => null)) as { nextExpectedRanges?: unknown } | null;
      return inicioEsperado(data?.nextExpectedRanges);
    } catch {
      return null;
    }
  };

  let inicio = 0;
  op.onProgreso?.(0, total);
  try {
    while (inicio < total) {
      verificarCancelado();
      const fin = Math.min(inicio + trozo, total);
      let intento = 0;
      // Reintento del MISMO trozo.
      for (;;) {
        let res: Response | null = null;
        let errorRed: unknown = null;
        try {
          res = await f(op.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Range': `bytes ${inicio}-${fin - 1}/${total}` },
            body: op.archivo.slice(inicio, fin),
            signal: op.signal,
          });
        } catch (e) {
          if (op.signal?.aborted) throw new SubidaCancelada();
          errorRed = e;
        }

        if (res && (res.status === 200 || res.status === 201)) {
          const item = (await res.json().catch(() => null)) as { id?: string; name?: string; size?: number } | null;
          if (!item?.id) throw new SubidaFallida('SharePoint no devolvió el archivo subido.');
          op.onProgreso?.(total, total);
          return { driveItemId: item.id, nombre: item.name ?? '', tamano: item.size ?? total };
        }
        if (res && res.status === 202) {
          const data = (await res.json().catch(() => null)) as { nextExpectedRanges?: unknown } | null;
          inicio = inicioEsperado(data?.nextExpectedRanges) ?? fin;
          op.onProgreso?.(inicio, total);
          break;
        }
        if (res && res.status === 404) {
          throw new SubidaFallida('La sesión de subida venció. Intente de nuevo.', 404);
        }
        if (res && res.status === 416) {
          // Graph ya tenía (parte de) ese rango: se resincroniza.
          const sigue = await consultarAvance();
          if (sigue === null) throw new SubidaFallida('SharePoint rechazó el rango del trozo.', 416);
          inicio = sigue;
          op.onProgreso?.(inicio, total);
          break;
        }
        if (res && !reintentable(res.status)) {
          throw new SubidaFallida(`SharePoint rechazó un trozo de la subida (${res.status}).`, res.status);
        }

        // Falla de red, 429 o 5xx: reintenta con espera creciente.
        intento += 1;
        if (intento > reintentos) {
          throw new SubidaFallida(
            res ? `Falló un trozo de la subida (${res.status}) después de varios intentos.` : 'Se perdió la conexión durante la subida.',
            res?.status
          );
        }
        const retryAfter = Number(res?.headers.get('retry-after'));
        await esperar(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : esperaBase * 2 ** (intento - 1));
        verificarCancelado();
        // Antes de repetir, se pregunta a Graph dónde quedó: si el trozo sí
        // llegó (y se perdió la respuesta), no se manda dos veces.
        const sigue = await consultarAvance();
        if (sigue !== null && sigue !== inicio) {
          inicio = sigue;
          op.onProgreso?.(inicio, total);
          break;
        }
        void errorRed;
      }
    }
    throw new SubidaFallida('La subida terminó sin que SharePoint confirmara el archivo.');
  } catch (error) {
    await cerrarSesion();
    if (op.signal?.aborted && !(error instanceof SubidaCancelada)) throw new SubidaCancelada();
    throw error;
  }
}

/* ─────────────── Flujo completo del formador (abrir + subir) ─────────────── */

export interface ArchivoSubidoAlCurso {
  driveItemId: string;
  mime: string;
}

/**
 * Pide al portal la upload session del curso y sube el archivo directo a
 * SharePoint. Devuelve lo que hay que mandar para registrar el material
 * (`POST .../materials` o `PUT .../materials/:id/file` con JSON).
 */
export async function subirMaterialDirecto(
  cursoId: number,
  archivo: File,
  opciones: Omit<OpcionesSubidaPorTrozos, 'archivo' | 'uploadUrl'> = {}
): Promise<ArchivoSubidoAlCurso> {
  const f = opciones.fetch ?? fetch;
  const mime = (archivo.type || '').toLowerCase();
  const res = await f(`/api/portal/courses/${cursoId}/materials/upload-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: archivo.name, mime, tamano: archivo.size }),
    signal: opciones.signal,
  });
  const texto = await res.text();
  let data: { uploadUrl?: string; error?: string } = {};
  try {
    data = texto ? JSON.parse(texto) : {};
  } catch {
    throw new SubidaFallida('El servicio no está disponible en este momento. Intente de nuevo en un minuto.', res.status);
  }
  if (!res.ok || !data.uploadUrl) {
    throw new SubidaFallida(data.error ?? 'No se pudo preparar la subida a SharePoint.', res.status);
  }
  const subido = await subirPorTrozos({ ...opciones, archivo, uploadUrl: data.uploadUrl });
  return { driveItemId: subido.driveItemId, mime };
}

/** "123.4 MB" para mostrar el avance. */
export function formatearBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
