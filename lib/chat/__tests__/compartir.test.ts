import { describe, expect, it, vi } from 'vitest';
import {
  accionTrasErrorCompartir,
  elegirEstrategiaCompartir,
  enlaceWhatsApp,
  enlaceWhatsAppWeb,
  esEscritorio,
  type EntornoDispositivo,
  filtrarDestinos,
  mensajeReenviado,
  normalizarBusqueda,
  ordenarDestinos,
  puedeCompartirArchivo,
  tipoParaCompartir,
  type DestinoReenvio,
} from '../compartir';

/* «Compartir» del visor de adjuntos (2026-10-24): reglas puras. */

const d = (idConversation: number, tipo: DestinoReenvio['tipo'], titulo: string, detalle: string | null, lastMessageAt: string | null): DestinoReenvio => ({
  idConversation,
  tipo,
  titulo,
  detalle,
  lastMessageAt,
});

const DESTINOS = [
  d(1, 'persona', 'María José Gómez', null, '2026-10-24T10:00:00Z'),
  d(2, 'grupo', 'Cierre de mes', 'Farmalógica', '2026-10-24T12:00:00Z'),
  d(3, 'proyecto', 'SGC OLP', 'Conversación · Orus', null),
];

describe('filtrarDestinos', () => {
  it('busca sin tildes ni mayúsculas en el título y el detalle', () => {
    expect(filtrarDestinos(DESTINOS, 'gomez').map((x) => x.idConversation)).toEqual([1]);
    expect(filtrarDestinos(DESTINOS, 'FARMALOGICA').map((x) => x.idConversation)).toEqual([2]);
    expect(filtrarDestinos(DESTINOS, 'orus').map((x) => x.idConversation)).toEqual([3]);
  });

  it('filtra por tipo y, sin texto, devuelve todo', () => {
    expect(filtrarDestinos(DESTINOS, '', 'grupo').map((x) => x.idConversation)).toEqual([2]);
    expect(filtrarDestinos(DESTINOS, '  ')).toHaveLength(3);
  });
});

describe('ordenarDestinos', () => {
  it('lo más reciente primero y lo que no tiene actividad al final', () => {
    expect(ordenarDestinos(DESTINOS).map((x) => x.idConversation)).toEqual([2, 1, 3]);
  });
});

describe('enlaceWhatsApp', () => {
  it('solo lleva el nombre del archivo: ninguna URL de SynerLink ni de OneDrive', () => {
    const url = enlaceWhatsApp('Informe & cierre.xlsx');
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    const texto = decodeURIComponent(url.slice('https://wa.me/?text='.length));
    expect(texto).toBe('Le comparto el archivo «Informe & cierre.xlsx».');
    expect(texto).not.toMatch(/https?:|sharepoint|onedrive/i);
  });
});

describe('tipoParaCompartir', () => {
  it('corrige el octet-stream de los agentes por la extensión (WhatsApp exige un tipo real)', () => {
    expect(tipoParaCompartir('application/octet-stream', 'excel-prueba-visor.xlsx')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(tipoParaCompartir(null, 'video.mp4')).toBe('video/mp4');
    expect(tipoParaCompartir(null, 'raro.xyz')).toBe('application/octet-stream');
  });
});

describe('puedeCompartirArchivo', () => {
  const archivo = new File([new Uint8Array(2)], 'a.pdf', { type: 'application/pdf' });

  it('sin Web Share o sin canShare (escritorio viejo): no', () => {
    expect(puedeCompartirArchivo(undefined, archivo)).toBe(false);
    expect(puedeCompartirArchivo({ share: vi.fn() } as unknown as Navigator, archivo)).toBe(false);
  });

  it('respeta lo que diga canShare, y si lanza es no', () => {
    expect(puedeCompartirArchivo({ share: vi.fn(), canShare: () => true } as unknown as Navigator, archivo)).toBe(true);
    expect(puedeCompartirArchivo({ share: vi.fn(), canShare: () => false } as unknown as Navigator, archivo)).toBe(false);
    expect(
      puedeCompartirArchivo(
        {
          share: vi.fn(),
          canShare: () => {
            throw new TypeError('x');
          },
        } as unknown as Navigator,
        archivo
      )
    ).toBe(false);
  });
});

describe('mensajeReenviado y normalizarBusqueda', () => {
  it('arma la confirmación según el tipo de destino', () => {
    expect(mensajeReenviado('a.pdf', { tipo: 'persona', titulo: 'Laura' })).toBe('Se reenvió «a.pdf» a Laura.');
    expect(mensajeReenviado('a.pdf', { tipo: 'grupo', titulo: 'Cierre' })).toBe('Se reenvió «a.pdf» a grupo «Cierre».');
    expect(normalizarBusqueda('  Ñandú ÁRBOL ')).toBe('nandu arbol');
  });
});

/* Bug 2026-10-27: en Windows la hoja nativa salía vacía. Escritorio → Descargar + WhatsApp Web. */

const UA = {
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
  android: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

const entorno = (p: Partial<EntornoDispositivo> & { userAgent: string }): EntornoDispositivo => ({
  punteroGrueso: false,
  maxTouchPoints: 0,
  ...p,
});

describe('esEscritorio', () => {
  it('Windows (Chrome y Edge), macOS y Linux con mouse: escritorio', () => {
    expect(esEscritorio(entorno({ userAgent: UA.windowsChrome, uaDataMobile: false, uaDataPlatform: 'Windows' }))).toBe(true);
    expect(esEscritorio(entorno({ userAgent: UA.windowsEdge, uaDataMobile: false }))).toBe(true);
    expect(esEscritorio(entorno({ userAgent: UA.macSafari }))).toBe(true);
    expect(esEscritorio(entorno({ userAgent: UA.linuxFirefox }))).toBe(true);
  });

  it('Windows con pantalla táctil sigue siendo escritorio (la hoja de Windows es la que falla)', () => {
    expect(esEscritorio(entorno({ userAgent: UA.windowsEdge, uaDataMobile: false, punteroGrueso: true, maxTouchPoints: 10 }))).toBe(true);
  });

  it('celulares y tabletas: no', () => {
    expect(esEscritorio(entorno({ userAgent: UA.android, uaDataMobile: true, punteroGrueso: true, maxTouchPoints: 5 }))).toBe(false);
    expect(esEscritorio(entorno({ userAgent: UA.iphone, punteroGrueso: true, maxTouchPoints: 5 }))).toBe(false);
    // Tableta Android: Chrome dice mobile=false, pero el UA es Android.
    expect(esEscritorio(entorno({ userAgent: UA.androidTablet, uaDataMobile: false, uaDataPlatform: 'Android', punteroGrueso: true }))).toBe(false);
    // iPad con iPadOS se presenta como Macintosh, pero con pantalla táctil.
    expect(esEscritorio(entorno({ userAgent: UA.macSafari, punteroGrueso: true, maxTouchPoints: 5 }))).toBe(false);
  });

  it('userAgentData.mobile = true manda aunque el UA parezca de escritorio', () => {
    expect(esEscritorio(entorno({ userAgent: UA.linuxFirefox, uaDataMobile: true }))).toBe(false);
  });

  it('UA desconocido: decide el puntero', () => {
    expect(esEscritorio(entorno({ userAgent: 'Raro/1.0' }))).toBe(true);
    expect(esEscritorio(entorno({ userAgent: 'Raro/1.0', punteroGrueso: true }))).toBe(false);
  });
});

describe('elegirEstrategiaCompartir', () => {
  it('escritorio: siempre Descargar + WhatsApp, aunque canShare diga que sí', () => {
    expect(elegirEstrategiaCompartir({ escritorio: true, puedeArchivo: true })).toBe('descargar-whatsapp');
    expect(elegirEstrategiaCompartir({ escritorio: true, puedeArchivo: false })).toBe('descargar-whatsapp');
  });

  it('celular: hoja nativa si el archivo se puede compartir; si no, respaldo', () => {
    expect(elegirEstrategiaCompartir({ escritorio: false, puedeArchivo: true })).toBe('hoja-nativa');
    expect(elegirEstrategiaCompartir({ escritorio: false, puedeArchivo: false })).toBe('descargar-whatsapp');
  });
});

describe('accionTrasErrorCompartir', () => {
  it('cancelar la hoja (AbortError) no hace nada', () => {
    expect(accionTrasErrorCompartir(new DOMException('cancelado', 'AbortError'))).toBe('nada');
  });

  it('cualquier otro error cae a Descargar + WhatsApp', () => {
    expect(accionTrasErrorCompartir(new DOMException('no permitido', 'NotAllowedError'))).toBe('respaldo');
    expect(accionTrasErrorCompartir(new DOMException('falló', 'DataError'))).toBe('respaldo');
    expect(accionTrasErrorCompartir(new TypeError('x'))).toBe('respaldo');
    expect(accionTrasErrorCompartir(undefined)).toBe('respaldo');
    expect(accionTrasErrorCompartir('texto')).toBe('respaldo');
  });
});

describe('enlaceWhatsAppWeb', () => {
  it('abre WhatsApp Web con solo el nombre del archivo', () => {
    const url = enlaceWhatsAppWeb('Acta 1.pdf');
    expect(url.startsWith('https://web.whatsapp.com/send?text=')).toBe(true);
    const texto = decodeURIComponent(url.slice('https://web.whatsapp.com/send?text='.length));
    expect(texto).toBe('Le comparto el archivo «Acta 1.pdf».');
    expect(texto).not.toMatch(/https?:|sharepoint|onedrive/i);
  });
});
