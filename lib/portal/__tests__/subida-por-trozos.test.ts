import { describe, expect, it, vi } from 'vitest';
import {
  SubidaCancelada,
  SubidaFallida,
  TAMANO_TROZO_NAVEGADOR,
  formatearBytes,
  subirMaterialDirecto,
  subirPorTrozos,
} from '../subida-por-trozos';

/**
 * SUBIDOR POR TROZOS del navegador (Formación → SharePoint, sin tope de peso).
 *
 * Se protege: trozos múltiplos de 320 KiB con Content-Range correcto, sin
 * Authorization; progreso; reintento del trozo ante 5xx/red retomando donde
 * Graph dice que quedó; cancelación (cierra la sesión); y fallas definitivas.
 */

const KIB320 = 320 * 1024;
const URL_SESION = 'https://gsslatam.sharepoint.com/_api/v2.0/uploadSession?token=xyz';

/** Simula una upload session de Graph que guarda cuántos bytes recibió. */
function sesionGraph(total: number, opciones: { fallarPrimeros?: number; statusFalla?: number; perderRespuesta?: boolean } = {}) {
  let recibido = 0;
  let fallas = opciones.fallarPrimeros ?? 0;
  const llamadas: { metodo: string; rango?: string; auth?: string | null; largo?: number }[] = [];
  const f = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const metodo = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    if (metodo === 'GET') {
      llamadas.push({ metodo });
      return Response.json({ nextExpectedRanges: [`${recibido}-`] });
    }
    if (metodo === 'DELETE') {
      llamadas.push({ metodo });
      return new Response(null, { status: 204 });
    }
    const rango = headers.get('content-range') ?? '';
    const cuerpo = init?.body as Blob;
    llamadas.push({ metodo, rango, auth: headers.get('authorization'), largo: cuerpo.size });
    const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(rango)!;
    const [ini, fin] = [Number(m[1]), Number(m[2])];
    if (fallas > 0) {
      fallas -= 1;
      if (opciones.perderRespuesta) {
        recibido = fin + 1; // el trozo llegó, pero la respuesta se perdió
        throw new TypeError('Failed to fetch');
      }
      return new Response(null, { status: opciones.statusFalla ?? 503 });
    }
    if (ini !== recibido) return new Response(null, { status: 416 });
    recibido = fin + 1;
    if (recibido >= total) return Response.json({ id: '01ITEM', name: 'video.mp4', size: total }, { status: 201 });
    return Response.json({ nextExpectedRanges: [`${recibido}-`] }, { status: 202 });
  });
  return { f, llamadas, recibido: () => recibido };
}

const blob = (bytes: number) => new Blob([new Uint8Array(bytes)]);
const sinEspera = async (_ms: number): Promise<void> => undefined;

describe('subirPorTrozos', () => {
  it('trozo por defecto de 10 MiB, múltiplo de 320 KiB', () => {
    expect(TAMANO_TROZO_NAVEGADOR).toBe(10 * 1024 * 1024);
    expect(TAMANO_TROZO_NAVEGADOR % KIB320).toBe(0);
  });

  it('sube en trozos con Content-Range correcto, sin Authorization, y reporta progreso', async () => {
    const total = KIB320 * 2 + 1000;
    const g = sesionGraph(total);
    const progreso: number[] = [];
    const r = await subirPorTrozos({
      archivo: blob(total),
      uploadUrl: URL_SESION,
      tamanoTrozo: KIB320,
      fetch: g.f,
      onProgreso: (s) => progreso.push(s),
    });
    expect(r).toEqual({ driveItemId: '01ITEM', nombre: 'video.mp4', tamano: total });
    const puts = g.llamadas.filter((l) => l.metodo === 'PUT');
    expect(puts.map((p) => p.rango)).toEqual([
      `bytes 0-${KIB320 - 1}/${total}`,
      `bytes ${KIB320}-${2 * KIB320 - 1}/${total}`,
      `bytes ${2 * KIB320}-${total - 1}/${total}`,
    ]);
    expect(puts.every((p) => p.auth === null)).toBe(true);
    expect(progreso).toEqual([0, KIB320, 2 * KIB320, total]);
  });

  it('un archivo grande (simulado de 2 GB declarado) no tiene tope: solo cuenta trozos', async () => {
    // No se crean 2 GB en memoria: basta con comprobar que no hay validación de tamaño.
    const total = KIB320 * 3;
    const g = sesionGraph(total);
    await expect(
      subirPorTrozos({ archivo: blob(total), uploadUrl: URL_SESION, tamanoTrozo: KIB320, fetch: g.f })
    ).resolves.toMatchObject({ tamano: total });
  });

  it('ante un 503 reintenta el mismo trozo y termina', async () => {
    const total = KIB320 * 2;
    const g = sesionGraph(total, { fallarPrimeros: 2, statusFalla: 503 });
    const esperar = vi.fn(sinEspera);
    const r = await subirPorTrozos({ archivo: blob(total), uploadUrl: URL_SESION, tamanoTrozo: KIB320, fetch: g.f, esperar });
    expect(r.driveItemId).toBe('01ITEM');
    expect(esperar).toHaveBeenCalledTimes(2);
    expect(esperar.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000]);
  });

  it('si se perdió la respuesta pero el trozo llegó, no lo reenvía: retoma donde Graph dice', async () => {
    const total = KIB320 * 2;
    const g = sesionGraph(total, { fallarPrimeros: 1, perderRespuesta: true });
    await subirPorTrozos({ archivo: blob(total), uploadUrl: URL_SESION, tamanoTrozo: KIB320, fetch: g.f, esperar: sinEspera });
    const puts = g.llamadas.filter((l) => l.metodo === 'PUT').map((p) => p.rango);
    expect(puts).toEqual([`bytes 0-${KIB320 - 1}/${total}`, `bytes ${KIB320}-${total - 1}/${total}`]);
  });

  it('agotados los reintentos, falla y cierra la sesión (DELETE)', async () => {
    const total = KIB320;
    const g = sesionGraph(total, { fallarPrimeros: 99, statusFalla: 500 });
    await expect(
      subirPorTrozos({ archivo: blob(total), uploadUrl: URL_SESION, tamanoTrozo: KIB320, fetch: g.f, esperar: sinEspera, reintentos: 2 })
    ).rejects.toBeInstanceOf(SubidaFallida);
    expect(g.llamadas.filter((l) => l.metodo === 'PUT')).toHaveLength(3);
    expect(g.llamadas.at(-1)?.metodo).toBe('DELETE');
  });

  it('un 4xx no reintentable (p. ej. 403) falla de una vez', async () => {
    const g = sesionGraph(KIB320, { fallarPrimeros: 1, statusFalla: 403 });
    const esperar = vi.fn(sinEspera);
    await expect(
      subirPorTrozos({ archivo: blob(KIB320), uploadUrl: URL_SESION, tamanoTrozo: KIB320, fetch: g.f, esperar })
    ).rejects.toMatchObject({ status: 403 });
    expect(esperar).not.toHaveBeenCalled();
  });

  it('sesión vencida (404): mensaje claro', async () => {
    const g = sesionGraph(KIB320, { fallarPrimeros: 1, statusFalla: 404 });
    await expect(
      subirPorTrozos({ archivo: blob(KIB320), uploadUrl: URL_SESION, tamanoTrozo: KIB320, fetch: g.f })
    ).rejects.toThrow(/venció/);
  });

  it('cancelar a mitad: lanza SubidaCancelada y cierra la sesión', async () => {
    const total = KIB320 * 3;
    const g = sesionGraph(total);
    const control = new AbortController();
    const p = subirPorTrozos({
      archivo: blob(total),
      uploadUrl: URL_SESION,
      tamanoTrozo: KIB320,
      fetch: g.f,
      signal: control.signal,
      onProgreso: (s) => {
        if (s === KIB320) control.abort();
      },
    });
    await expect(p).rejects.toBeInstanceOf(SubidaCancelada);
    expect(g.llamadas.filter((l) => l.metodo === 'PUT')).toHaveLength(1);
    expect(g.llamadas.at(-1)?.metodo).toBe('DELETE');
  });

  it('rechaza un trozo que no sea múltiplo de 320 KiB y un archivo vacío', async () => {
    const g = sesionGraph(10);
    await expect(subirPorTrozos({ archivo: blob(10), uploadUrl: URL_SESION, tamanoTrozo: 1000, fetch: g.f })).rejects.toThrow(/320 KiB/);
    await expect(subirPorTrozos({ archivo: blob(0), uploadUrl: URL_SESION, fetch: g.f })).rejects.toThrow(/vacío/);
  });
});

describe('subirMaterialDirecto', () => {
  it('pide la sesión al portal (nombre, mime, tamaño) y sube a la uploadUrl', async () => {
    const total = KIB320;
    const g = sesionGraph(total);
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === '/api/portal/courses/7/materials/upload-session') {
        return Response.json({ uploadUrl: URL_SESION });
      }
      return g.f(url, init);
    });
    const archivo = new File([new Uint8Array(total)], 'Productos que realiza Farmalógica.mp4', { type: 'video/mp4' });
    const r = await subirMaterialDirecto(7, archivo, { fetch: f, tamanoTrozo: KIB320 });
    expect(r).toEqual({ driveItemId: '01ITEM', mime: 'video/mp4' });
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({
      nombre: 'Productos que realiza Farmalógica.mp4',
      mime: 'video/mp4',
      tamano: total,
    });
  });

  it('muestra el error del portal (p. ej. formato no admitido) sin subir nada', async () => {
    const f = vi.fn(async () => Response.json({ error: 'Formato no admitido (application/zip).' }, { status: 400 }));
    const archivo = new File(['x'], 'a.zip', { type: 'application/zip' });
    await expect(subirMaterialDirecto(7, archivo, { fetch: f })).rejects.toThrow('Formato no admitido (application/zip).');
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('formatearBytes', () => {
  it('KB, MB y GB', () => {
    expect(formatearBytes(2048)).toBe('2 KB');
    expect(formatearBytes(150 * 1024 * 1024)).toBe('150.0 MB');
    expect(formatearBytes(3 * 1024 * 1024 * 1024)).toBe('3.00 GB');
  });
});
