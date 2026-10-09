import { describe, expect, it } from 'vitest';
import { leerReporte, reglaDeRevision, seMarcaAlAbrir, tipoDeRevision, validarRevision } from '../revision-material';

// Reglas de "material revisado" (Cristian, 2026-10-08) con los ajustes del
// mismo día: documentos SIN tiempo mínimo (se marcan al abrir), video al
// 100 % sin adelantar y PDF de varias páginas hasta la última.
const env = {} as NodeJS.ProcessEnv;
const video = { type: 'DOCUMENT', mime: 'video/mp4' };
const pdf = { type: 'DOCUMENT', mime: 'application/pdf' };
const imagen = { type: 'DOCUMENT', mime: 'image/png' };
const word = { type: 'DOCUMENT', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
const enlace = { type: 'LINK', mime: null };

describe('tipoDeRevision', () => {
  it('clasifica por tipo y mime', () => {
    expect(tipoDeRevision(enlace)).toBe('enlace');
    expect(tipoDeRevision(video)).toBe('video');
    expect(tipoDeRevision(pdf)).toBe('pdf');
    expect(tipoDeRevision(imagen)).toBe('imagen');
    expect(tipoDeRevision(word)).toBe('documento');
  });
});

describe('reglaDeRevision', () => {
  it('documentos sin tiempo mínimo por defecto (PDF, imagen, Office)', () => {
    expect(reglaDeRevision(pdf, 1, env).segundosMinimos).toBe(0);
    expect(reglaDeRevision(pdf, 500, env).segundosMinimos).toBe(0);
    expect(reglaDeRevision(pdf, null, env).segundosMinimos).toBe(0);
    expect(reglaDeRevision(imagen, null, env).segundosMinimos).toBe(0);
    expect(reglaDeRevision(word, null, env).segundosMinimos).toBe(0);
  });

  it('PDF lleva las páginas que contó el servidor', () => {
    expect(reglaDeRevision(pdf, 5, env).paginas).toBe(5);
    expect(reglaDeRevision(pdf, null, env).paginas).toBeNull();
  });

  it('video: 100 % por defecto', () => {
    expect(reglaDeRevision(video, null, env).fraccionVideo).toBe(1);
  });

  it('se sigue pudiendo configurar por entorno', () => {
    const otro = {
      PORTAL_TH_REVISION_VIDEO_PCT: '95',
      PORTAL_TH_REVISION_DOC_SEG: '45',
      PORTAL_TH_REVISION_PDF_SEG_POR_PAGINA: '6',
      PORTAL_TH_REVISION_PDF_MIN_SEG: '15',
      PORTAL_TH_REVISION_PDF_MAX_SEG: '300',
    } as unknown as NodeJS.ProcessEnv;
    expect(reglaDeRevision(video, null, otro).fraccionVideo).toBe(0.95);
    expect(reglaDeRevision(word, null, otro).segundosMinimos).toBe(45);
    expect(reglaDeRevision(pdf, 10, otro).segundosMinimos).toBe(60);
    expect(reglaDeRevision(video, null, { PORTAL_TH_REVISION_VIDEO_PCT: 'x' } as unknown as NodeJS.ProcessEnv).fraccionVideo).toBe(1);
  });
});

describe('seMarcaAlAbrir', () => {
  it('apertura → marca de inmediato: enlace, imagen, Office y PDF de 1 página', () => {
    expect(seMarcaAlAbrir(reglaDeRevision(enlace, null, env))).toBe(true);
    expect(seMarcaAlAbrir(reglaDeRevision(imagen, null, env))).toBe(true);
    expect(seMarcaAlAbrir(reglaDeRevision(word, null, env))).toBe(true);
    expect(seMarcaAlAbrir(reglaDeRevision(pdf, 1, env))).toBe(true);
  });

  it('PDF de varias páginas (o sin contar) NO se marca al abrir', () => {
    expect(seMarcaAlAbrir(reglaDeRevision(pdf, 5, env))).toBe(false);
    expect(seMarcaAlAbrir(reglaDeRevision(pdf, null, env))).toBe(false);
  });

  it('el video NUNCA se marca solo por abrirlo', () => {
    expect(seMarcaAlAbrir(reglaDeRevision(video, null, env))).toBe(false);
  });

  it('si se configura un mínimo > 0, el documento ya no se marca al abrir', () => {
    const otro = { PORTAL_TH_REVISION_DOC_SEG: '30' } as unknown as NodeJS.ProcessEnv;
    expect(seMarcaAlAbrir(reglaDeRevision(word, null, otro))).toBe(false);
  });
});

describe('validarRevision — video', () => {
  const reglaVideo = reglaDeRevision(video, null, env);

  it('video al 100 % en tiempo real: aceptado', () => {
    expect(validarRevision(reglaVideo, { segundosVistos: 100, duracion: 100 }, 101)).toEqual({ ok: true });
    // Redondeo del reproductor: una fracción de segundo por debajo también vale.
    expect(validarRevision(reglaVideo, { segundosVistos: 99.6, duracion: 100 }, 100)).toEqual({ ok: true });
  });

  it('video al 95 %: rechazado', () => {
    expect(validarRevision(reglaVideo, { segundosVistos: 95, duracion: 100 }, 120)).toEqual({
      ok: false,
      error: 'Aún no ha visto el video completo.',
    });
  });

  it('video al 50 %: rechazado', () => {
    expect(validarRevision(reglaVideo, { segundosVistos: 50, duracion: 100 }, 60).ok).toBe(false);
  });

  it('el reloj del servidor debe llegar a la duración (con pocos segundos de tolerancia)', () => {
    expect(validarRevision(reglaVideo, { segundosVistos: 100, duracion: 100 }, 96).ok).toBe(true);
    const r = validarRevision(reglaVideo, { segundosVistos: 100, duracion: 100 }, 10);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/menos tiempo/) });
  });

  it('video sin duración o con más segundos que su duración: rechazado', () => {
    expect(validarRevision(reglaVideo, { segundosVistos: 10, duracion: 0 }, 100).ok).toBe(false);
    expect(validarRevision(reglaVideo, { segundosVistos: 500, duracion: 100 }, 600).ok).toBe(false);
  });
});

describe('validarRevision — PDF y otros documentos', () => {
  it('PDF de 5 páginas: no marca hasta la página 5', () => {
    const regla = reglaDeRevision(pdf, 5, env);
    for (const pagina of [1, 2, 3, 4]) {
      expect(validarRevision(regla, { segundosVistos: 0, paginaMaxima: pagina }, 30).ok).toBe(false);
    }
    expect(validarRevision(regla, { segundosVistos: 0, paginaMaxima: 5 }, 30)).toEqual({ ok: true });
  });

  it('PDF: no vale reportar más páginas de las que tiene, ni engañar con el total del visor', () => {
    const regla = reglaDeRevision(pdf, 5, env);
    expect(validarRevision(regla, { segundosVistos: 0, paginaMaxima: 9 }, 30).ok).toBe(false);
    // Las páginas del servidor mandan sobre las que diga el navegador.
    expect(validarRevision(regla, { segundosVistos: 0, paginaMaxima: 2, paginasTotales: 2 }, 30).ok).toBe(false);
  });

  it('PDF sin páginas contadas por el servidor: usa el total del visor', () => {
    const regla = reglaDeRevision(pdf, null, env);
    expect(validarRevision(regla, { segundosVistos: 0, paginaMaxima: 3, paginasTotales: 3 }, 1).ok).toBe(true);
    expect(validarRevision(regla, { segundosVistos: 0, paginaMaxima: 2, paginasTotales: 3 }, 1).ok).toBe(false);
    expect(validarRevision(regla, { segundosVistos: 0 }, 1).ok).toBe(false);
  });

  it('documento: sin validación de tiempo transcurrido en el servidor', () => {
    expect(validarRevision(reglaDeRevision(word, null, env), { segundosVistos: 0 }, 0)).toEqual({ ok: true });
    const conMinimo = reglaDeRevision(word, null, { PORTAL_TH_REVISION_DOC_SEG: '30' } as unknown as NodeJS.ProcessEnv);
    expect(validarRevision(conMinimo, { segundosVistos: 30 }, 1)).toEqual({ ok: true });
    expect(validarRevision(conMinimo, { segundosVistos: 10 }, 60).ok).toBe(false);
  });

  it('enlace: abrirlo basta', () => {
    expect(validarRevision(reglaDeRevision(enlace, null, env), { segundosVistos: 0 }, 0).ok).toBe(true);
  });
});

describe('leerReporte', () => {
  it('valida el cuerpo', () => {
    expect(leerReporte({ segundosVistos: 12.5, duracion: 30 })).toEqual({
      segundosVistos: 12.5,
      duracion: 30,
      paginaMaxima: null,
      paginasTotales: null,
    });
    expect(leerReporte({ segundosVistos: 0, paginaMaxima: 5, paginasTotales: 5 })).toMatchObject({ paginaMaxima: 5, paginasTotales: 5 });
    expect(leerReporte({ segundosVistos: 0, paginaMaxima: 2.5 })).toBeNull();
    expect(leerReporte({ segundosVistos: -1 })).toBeNull();
    expect(leerReporte({ segundosVistos: 'mucho' })).toBeNull();
    expect(leerReporte(null)).toBeNull();
  });
});
