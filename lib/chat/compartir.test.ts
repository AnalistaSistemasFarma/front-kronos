import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  armarComentarioInicial,
  destinoInicial,
  filtrarDestinos,
  hrefDestino,
  normalizarTextoCompartido,
  ordenarDestinos,
  SHARE_IDB_NAME,
  SHARE_IDB_STORE,
  SHARE_IDB_VERSION,
  SHARE_LOTE_TTL_MS,
  SHARE_MAX_FILES_STORED,
  SHARE_PAGE_PATH,
  SHARE_TARGET_ACTION,
  shareTargetManifest,
  validarCompartido,
  type DestinoCompartir,
} from './compartir';
import { MAX_CHAT_ATTACHMENT_BYTES } from './attachments';

const MB = 1024 * 1024;

function destino(p: Partial<DestinoCompartir> & Pick<DestinoCompartir, 'key' | 'tipo' | 'nombre'>): DestinoCompartir {
  return { detalle: null, avatarCode: p.key, avatarUrl: null, idConversation: null, lastMessageAt: null, ...p };
}

describe('manifiesto share_target', () => {
  it('POST multipart a la ruta interceptada, con title/text/url/files', () => {
    const st = shareTargetManifest();
    expect(st.action).toBe(SHARE_TARGET_ACTION);
    expect(st.method).toBe('POST');
    expect(st.enctype).toBe('multipart/form-data');
    expect(st.params).toMatchObject({ title: 'title', text: 'text', url: 'url' });
    const files = st.params.files as { name: string; accept: string | string[] }[];
    expect(files[0].name).toBe('files');
    expect(files[0].accept).toEqual(expect.arrayContaining(['image/*', 'video/*', 'application/pdf', '.docx', '.xlsx']));
  });
});

describe('service worker: constantes en espejo', () => {
  const fuentes: Record<string, () => string> = {
    'public/sw.js': () => readFileSync(fileURLToPath(new URL('../../public/sw.js', import.meta.url)), 'utf8'),
    'worker/index.js': () => readFileSync(fileURLToPath(new URL('../../worker/index.js', import.meta.url)), 'utf8'),
  };
  for (const [archivo, leer] of Object.entries(fuentes)) {
    it(`${archivo} usa las mismas constantes que lib/chat/compartir.ts`, () => {
      const sw = leer();
      expect(sw).toContain(`const SHARE_TARGET_ACTION = '${SHARE_TARGET_ACTION}';`);
      expect(sw).toContain(`const SHARE_PAGE_PATH = '${SHARE_PAGE_PATH}';`);
      expect(sw).toContain(`const SHARE_IDB_NAME = '${SHARE_IDB_NAME}';`);
      expect(sw).toContain(`const SHARE_IDB_STORE = '${SHARE_IDB_STORE}';`);
      expect(sw).toContain(`const SHARE_IDB_VERSION = ${SHARE_IDB_VERSION};`);
      expect(sw).toContain(`const SHARE_MAX_FILES_STORED = ${SHARE_MAX_FILES_STORED};`);
      expect(sw).toContain(`const SHARE_MAX_FILE_BYTES = ${MAX_CHAT_ATTACHMENT_BYTES / MB} * 1024 * 1024;`);
      expect(sw).toContain(`const SHARE_LOTE_TTL_MS = ${SHARE_LOTE_TTL_MS / 3_600_000} * 60 * 60 * 1000;`);
    });
  }
});

describe('texto compartido', () => {
  it('solo acepta enlaces http(s) y quita caracteres de control', () => {
    expect(normalizarTextoCompartido({ url: 'javascript:alert(1)' }).url).toBe('');
    expect(normalizarTextoCompartido({ url: 'https://gsslatam.com/x' }).url).toBe('https://gsslatam.com/x');
    expect(normalizarTextoCompartido({ text: 'hola\u0000 mundo' }).text).toBe('hola mundo');
    expect(normalizarTextoCompartido({ title: 5 }).title).toBe('');
  });

  it('no duplica el enlace que ya viene en el texto', () => {
    const t = normalizarTextoCompartido({ title: 'Nota', text: 'Mire esto https://a.co/1', url: 'https://a.co/1' });
    expect(armarComentarioInicial(t)).toBe('Nota\nMire esto https://a.co/1');
  });
});

describe('validación (mismas reglas del chat)', () => {
  it('acepta hasta 5 archivos válidos', () => {
    const v = validarCompartido([{ name: 'foto.jpg', size: 2 * MB }, { name: 'acta.pdf', size: MB }], '');
    expect(v.ok).toBe(true);
  });

  it('rechaza ejecutables, vacíos y de más de 25 MB', () => {
    const v = validarCompartido(
      [{ name: 'x.exe', size: 10 }, { name: 'vacio.txt', size: 0 }, { name: 'video.mp4', size: 30 * MB }],
      ''
    );
    expect(v.ok).toBe(false);
    expect(v.errores[0]).toMatch(/\.exe/);
    expect(v.errores[1]).toMatch(/vacío/);
    expect(v.errores[2]).toMatch(/máximo/);
  });

  it('rechaza más de 5 archivos y un envío vacío', () => {
    const seis = Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.png`, size: 10 }));
    expect(validarCompartido(seis, '').errorGeneral).toMatch(/máximo 5/);
    expect(validarCompartido([], '   ').errorGeneral).toMatch(/nada que enviar/);
    expect(validarCompartido([], 'solo texto').ok).toBe(true);
  });
});

describe('destinos', () => {
  const lista = [
    destino({ key: 'conv:9', tipo: 'grupo', nombre: 'Comité', lastMessageAt: '2026-10-22T10:00:00Z' }),
    destino({ key: 'agent:2', tipo: 'agente', nombre: 'Sirio', agentCode: 'sirio', lastMessageAt: '2026-10-22T12:00:00Z' }),
    destino({ key: 'conv:4', tipo: 'persona', nombre: 'Jorge Alba' }),
    destino({ key: 'agent:1', tipo: 'agente', nombre: 'Orus', agentCode: 'orus' }),
    destino({ key: 'conv:7', tipo: 'proyecto', nombre: 'SGC', idProject: 3 }),
  ];

  it('agentes primero y Orus arriba, aunque otro tenga actividad más reciente', () => {
    expect(ordenarDestinos(lista).map((d) => d.key)).toEqual(['agent:1', 'agent:2', 'conv:9', 'conv:4', 'conv:7']);
  });

  it('preselecciona el último usado; si no está, Orus', () => {
    expect(destinoInicial(lista, 'conv:4')?.key).toBe('conv:4');
    expect(destinoInicial(lista, 'conv:999')?.key).toBe('agent:1');
    expect(destinoInicial(lista, null)?.key).toBe('agent:1');
    expect(destinoInicial([lista[0]], null)?.key).toBe('conv:9');
    expect(destinoInicial([], null)).toBeNull();
  });

  it('busca sin tildes ni mayúsculas', () => {
    expect(filtrarDestinos(lista, 'COMITE').map((d) => d.key)).toEqual(['conv:9']);
  });

  it('lleva a la conversación correcta al enviar', () => {
    expect(hrefDestino(lista[3], 11)).toBe('/process/chat/orus');
    expect(hrefDestino(lista[0], 9)).toBe('/process/chat/grupo/9');
    expect(hrefDestino(lista[2], 4)).toBe('/process/chat/persona/4');
    expect(hrefDestino(lista[4], 7)).toBe('/process/proyectos/3?conversacion=7');
  });
});
