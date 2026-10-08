import { describe, expect, it } from 'vitest';
import {
  leerReporte,
  pdfRequierePaginas,
  reglaDeRevision,
  seMarcaAlAbrir,
  tipoDeRevision,
  validarRevision,
} from '../revision-material';

// Reglas de "material revisado" (Cristian, 2026-10-08) con el ajuste del
// mismo día: documentos SIN tiempo mínimo (se marcan al abrir); video igual.
const env = {} as NodeJS.ProcessEnv;
const video = { type: 'DOCUMENT', mime: 'video/mp4' };
const pdf = { type: 'DOCUMENT', mime: 'application/pdf' };
const imagen = { type: 'DOCUMENT', mime: 'image/png' };
const word = { type: 'DOCUMENT', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

describe('tipoDeRevision', () => {
  it('clasifica por tipo y mime', () => {
    expect(tipoDeRevision({ type: 'LINK', mime: null })).toBe('enlace');
    expect(tipoDeRevision(video)).toBe('video');
    expect(tipoDeRevision(pdf)).toBe('pdf');
    expect(tipoDeRevision({ type: 'DOCUMENT', mime: 'image/png' })).toBe('imagen');
    expect(tipoDeRevision({ type: 'DOCUMENT', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).toBe('documento');
  });
});

describe('reglaDeRevision', () => {
  it('documentos sin tiempo mínimo por defecto (PDF, imagen, Office)', () => {
    expect(reglaDeRevision(pdf, 1, env).segundosMinimos).toBe(0);
    expect(reglaDeRevision(pdf, 500, env).segundosMinimos).toBe(0);
    expect(reglaDeRevision(pdf, null, env).segundosMinimos).toBe(0);
    expect(reglaDeRevision(imagen, null, env).segundosMinimos).toBe(0);
    expect(reglaDeRevision(word, null, env).segundosMinimos).toBe(0);
    expect(pdfRequierePaginas(env)).toBe(false);
  });

  it('video: 90 % por defecto', () => {
    expect(reglaDeRevision(video, null, env).fraccionVideo).toBe(0.9);
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
    expect(pdfRequierePaginas(otro)).toBe(true);
    expect(reglaDeRevision(video, null, { PORTAL_TH_REVISION_VIDEO_PCT: 'x' } as unknown as NodeJS.ProcessEnv).fraccionVideo).toBe(0.9);
  });
});

describe('seMarcaAlAbrir', () => {
  it('apertura → marca de inmediato: enlace, PDF, imagen y Office', () => {
    expect(seMarcaAlAbrir(reglaDeRevision({ type: 'LINK', mime: null }, null, env))).toBe(true);
    expect(seMarcaAlAbrir(reglaDeRevision(pdf, 40, env))).toBe(true);
    expect(seMarcaAlAbrir(reglaDeRevision(imagen, null, env))).toBe(true);
    expect(seMarcaAlAbrir(reglaDeRevision(word, null, env))).toBe(true);
  });

  it('el video NUNCA se marca solo por abrirlo', () => {
    expect(seMarcaAlAbrir(reglaDeRevision(video, null, env))).toBe(false);
  });

  it('si se configura un mínimo > 0, el documento ya no se marca al abrir', () => {
    const otro = { PORTAL_TH_REVISION_DOC_SEG: '30' } as unknown as NodeJS.ProcessEnv;
    expect(seMarcaAlAbrir(reglaDeRevision(word, null, otro))).toBe(false);
  });
});

describe('validarRevision', () => {
  const reglaVideo = reglaDeRevision(video, null, env);

  it('video visto al 90 % en tiempo real: aceptado', () => {
    expect(validarRevision(reglaVideo, { segundosVistos: 90, duracion: 100 }, 96)).toEqual({ ok: true });
  });

  it('video visto al 50 %: rechazado', () => {
    expect(validarRevision(reglaVideo, { segundosVistos: 50, duracion: 100 }, 60).ok).toBe(false);
  });

  it('video "visto" en menos tiempo del que dura: implausible', () => {
    const r = validarRevision(reglaVideo, { segundosVistos: 100, duracion: 100 }, 10);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/menos tiempo/) });
  });

  it('video sin duración o con más segundos que su duración: rechazado', () => {
    expect(validarRevision(reglaVideo, { segundosVistos: 10, duracion: 0 }, 100).ok).toBe(false);
    expect(validarRevision(reglaVideo, { segundosVistos: 500, duracion: 100 }, 600).ok).toBe(false);
  });

  it('documento: sin validación de tiempo transcurrido en el servidor', () => {
    expect(validarRevision(reglaDeRevision(pdf, 10, env), { segundosVistos: 0 }, 0)).toEqual({ ok: true });
    const conMinimo = reglaDeRevision(word, null, { PORTAL_TH_REVISION_DOC_SEG: '30' } as unknown as NodeJS.ProcessEnv);
    // Con mínimo configurado se exige el reporte del visor, pero no el reloj del servidor.
    expect(validarRevision(conMinimo, { segundosVistos: 30 }, 1)).toEqual({ ok: true });
    expect(validarRevision(conMinimo, { segundosVistos: 10 }, 60).ok).toBe(false);
  });

  it('enlace: abrirlo basta', () => {
    expect(validarRevision(reglaDeRevision({ type: 'LINK', mime: null }, null, env), { segundosVistos: 0 }, 0).ok).toBe(true);
  });
});

describe('leerReporte', () => {
  it('valida el cuerpo', () => {
    expect(leerReporte({ segundosVistos: 12.5, duracion: 30 })).toEqual({ segundosVistos: 12.5, duracion: 30 });
    expect(leerReporte({ segundosVistos: -1 })).toBeNull();
    expect(leerReporte({ segundosVistos: 'mucho' })).toBeNull();
    expect(leerReporte(null)).toBeNull();
  });
});
