import { describe, expect, it, vi } from 'vitest';
import {
  enlaceWhatsApp,
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
