import { describe, expect, it } from 'vitest';
import { leerReporte, reglaDeRevision, tipoDeRevision, validarRevision } from '../revision-material';

// Reglas de "material revisado" (Cristian, 2026-10-08).
const env = {} as NodeJS.ProcessEnv;
const video = { type: 'DOCUMENT', mime: 'video/mp4' };
const pdf = { type: 'DOCUMENT', mime: 'application/pdf' };

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
  it('PDF: tiempo proporcional a las páginas, con piso y techo', () => {
    expect(reglaDeRevision(pdf, 1, env).segundosMinimos).toBe(15);
    expect(reglaDeRevision(pdf, 10, env).segundosMinimos).toBe(60);
    expect(reglaDeRevision(pdf, 500, env).segundosMinimos).toBe(300);
    expect(reglaDeRevision(pdf, null, env).segundosMinimos).toBe(300);
  });

  it('se configura por entorno', () => {
    const otro = { PORTAL_TH_REVISION_VIDEO_PCT: '95', PORTAL_TH_REVISION_DOC_SEG: '45' } as unknown as NodeJS.ProcessEnv;
    expect(reglaDeRevision(video, null, otro).fraccionVideo).toBe(0.95);
    expect(reglaDeRevision({ type: 'DOCUMENT', mime: 'application/msword' }, null, otro).segundosMinimos).toBe(45);
    expect(reglaDeRevision(video, null, { PORTAL_TH_REVISION_VIDEO_PCT: 'x' } as unknown as NodeJS.ProcessEnv).fraccionVideo).toBe(0.9);
  });
});

describe('validarRevision', () => {
  const reglaVideo = reglaDeRevision(video, null, env);

  it('video visto ≥ 90 % en tiempo real: aceptado', () => {
    expect(validarRevision(reglaVideo, { segundosVistos: 95, duracion: 100 }, 96)).toEqual({ ok: true });
  });

  it('video con menos del 90 % visto: rechazado', () => {
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

  it('documento: exige el mínimo en el reporte y en el reloj del servidor', () => {
    const regla = reglaDeRevision(pdf, 10, env); // 60 s
    expect(validarRevision(regla, { segundosVistos: 60 }, 61)).toEqual({ ok: true });
    expect(validarRevision(regla, { segundosVistos: 30 }, 61).ok).toBe(false);
    expect(validarRevision(regla, { segundosVistos: 60 }, 20).ok).toBe(false);
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
