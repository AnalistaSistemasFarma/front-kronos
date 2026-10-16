import { describe, expect, it } from 'vitest';
import {
  contadorVideo,
  posicionPermitida,
  progresoLectura,
  reloj,
  segundosQueSuman,
  videoCompleto,
} from '../visor-revision';

// Visor de Formación (Cristian, 2026-10-08): video sin adelantar con contador,
// PDF por páginas con barra de lectura.

describe('posicionPermitida — no se puede adelantar', () => {
  it('intento de adelantar más allá de lo visto: bloqueado (vuelve a lo visto)', () => {
    expect(posicionPermitida(90, 30)).toBe(30);
    expect(posicionPermitida(31.5, 30)).toBe(30);
  });

  it('retroceder sí se puede', () => {
    expect(posicionPermitida(10, 30)).toBe(10);
    expect(posicionPermitida(0, 30)).toBe(0);
  });

  it('el avance normal de la reproducción no se bloquea', () => {
    expect(posicionPermitida(30.5, 30)).toBe(30.5);
  });

  it('valores raros: al inicio', () => {
    expect(posicionPermitida(Number.NaN, 30)).toBe(0);
    expect(posicionPermitida(-5, 30)).toBe(0);
  });
});

describe('segundosQueSuman — el contador solo corre con reproducción real', () => {
  const normal = { velocidad: 1, visible: true, pausado: false };
  it('reproducción a 1× con la pestaña visible: suma', () => {
    expect(segundosQueSuman(0.25, normal)).toBe(0.25);
  });
  it('en pausa, con la pestaña oculta o a otra velocidad: no suma', () => {
    expect(segundosQueSuman(0.25, { ...normal, pausado: true })).toBe(0);
    expect(segundosQueSuman(0.25, { ...normal, visible: false })).toBe(0);
    expect(segundosQueSuman(0.25, { ...normal, velocidad: 2 })).toBe(0);
  });
  it('un salto (delta grande o negativo) no suma', () => {
    expect(segundosQueSuman(40, normal)).toBe(0);
    expect(segundosQueSuman(-10, normal)).toBe(0);
  });
});

describe('contador y límite del video', () => {
  it('formato "visto / duración"', () => {
    expect(contadorVideo(135, 340)).toBe('02:15 / 05:40');
    expect(contadorVideo(0, 0)).toBe('00:00 / 00:00');
    expect(reloj(3725)).toBe('1:02:05');
  });

  it('video al 100 % → completo; al 95 % → no', () => {
    expect(videoCompleto(340, 340)).toBe(true);
    expect(videoCompleto(339.7, 340)).toBe(true);
    expect(videoCompleto(323, 340)).toBe(false);
  });
});

describe('progresoLectura — barra del PDF', () => {
  it('se llena según la página máxima alcanzada', () => {
    expect(progresoLectura(1, 5)).toBe(20);
    expect(progresoLectura(3, 5)).toBe(60);
    expect(progresoLectura(5, 5)).toBe(100);
    expect(progresoLectura(9, 5)).toBe(100);
  });
  it('una página = 100 %; sin páginas = 0', () => {
    expect(progresoLectura(1, 1)).toBe(100);
    expect(progresoLectura(1, 0)).toBe(0);
  });
});
