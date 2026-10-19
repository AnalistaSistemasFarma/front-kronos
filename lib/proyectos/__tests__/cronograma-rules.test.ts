import { describe, expect, it } from 'vitest';
import {
  agruparPorDia,
  cambiosDeTarea,
  describirCambios,
  esFechaIso,
  estadoVisualTarea,
  eventosCalendario,
  fechaCortaIso,
  fechaLargaIso,
  fechasDeActividad,
  fechasDeSolicitud,
  hoyBogota,
  lunesDe,
  marcasGantt,
  normalizarTarea,
  posicionBarra,
  PX_POR_DIA,
  rangoGantt,
  type TareaValores,
} from '../cronograma-rules';

const base: TareaValores = { title: 'Radicar DIM', description: null, idResponsible: null, startDate: '2026-10-10', endDate: '2026-10-15', status: 'pendiente', progress: null, isMilestone: false };

describe('fechas', () => {
  it('valida AAAA-MM-DD reales y en rango', () => {
    expect(esFechaIso('2026-10-18')).toBe(true);
    for (const v of ['2026-02-30', '18/10/2026', '1999-12-31', '2101-01-01', 20261018, null, '2026-10-18T00:00']) expect(esFechaIso(v)).toBe(false);
  });
  it('hoy en Bogotá (UTC−5) y lunes de la semana', () => {
    expect(hoyBogota(new Date('2026-10-19T03:00:00Z'))).toBe('2026-10-18');
    expect(lunesDe('2026-10-18')).toBe('2026-10-12');
    expect(lunesDe('2026-10-12')).toBe('2026-10-12');
  });
  it('formato corto y largo en español', () => {
    expect(fechaCortaIso('2026-10-18', 2026)).toBe('18 oct.');
    expect(fechaCortaIso('2025-01-03', 2026)).toBe('3 ene. 2025');
    expect(fechaLargaIso('2026-05-13')).toBe('13 de mayo de 2026');
  });
});

describe('normalizarTarea', () => {
  it('crea con valores por defecto (fin = inicio, pendiente)', () => {
    const r = normalizarTarea({ title: '  Radicar   DIM ', startDate: '2026-10-10' }, null);
    expect(r).toEqual({ ok: true, value: { ...base, endDate: '2026-10-10' } });
  });
  it('exige título y fecha de inicio; fin ≥ inicio; avance 0–100; estado válido', () => {
    expect(normalizarTarea({ startDate: '2026-10-10' }, null).ok).toBe(false);
    expect(normalizarTarea({ title: 'x' }, null).ok).toBe(false);
    expect(normalizarTarea({ title: 'x', startDate: '2026-10-10', endDate: '2026-10-09' }, null).ok).toBe(false);
    expect(normalizarTarea({ title: 'x', startDate: '2026-10-10', progress: 101 }, null).ok).toBe(false);
    expect(normalizarTarea({ title: 'x', startDate: '2026-10-10', progress: 33.5 }, null).ok).toBe(false);
    expect(normalizarTarea({ title: 'x', startDate: '2026-10-10', status: 'cerrada' }, null).ok).toBe(false);
    expect(normalizarTarea({ title: 'x'.repeat(201), startDate: '2026-10-10' }, null).ok).toBe(false);
    expect(normalizarTarea({ title: 'x', startDate: '2026-01-01', endDate: '2030-01-01' }, null).ok).toBe(false);
  });
  it('un hito es de un día (el fin se iguala al inicio)', () => {
    const r = normalizarTarea({ title: 'Llega el barco', startDate: '2026-10-25', endDate: '2026-10-30', isMilestone: true }, null);
    expect(r.ok && r.value.endDate).toBe('2026-10-25');
  });
  it('editar: solo cambia lo que viene y valida contra lo actual', () => {
    const r = normalizarTarea({ status: 'en_curso', progress: 40 }, base);
    expect(r).toEqual({ ok: true, value: { ...base, status: 'en_curso', progress: 40 } });
    expect(normalizarTarea({ endDate: '2026-10-01' }, base).ok).toBe(false);
    expect(normalizarTarea({}, base)).toEqual({ ok: false, error: 'No hay nada que cambiar.' });
    expect(normalizarTarea({ progress: null, description: '' }, { ...base, progress: 10, description: 'x' })).toEqual({ ok: true, value: base });
  });
  it('cambios y su descripción para la auditoría', () => {
    const c = cambiosDeTarea(base, { ...base, status: 'hecha', progress: 100, idResponsible: 'u1' });
    expect(c).toEqual({ status: ['pendiente', 'hecha'], progress: [null, 100], idResponsible: [null, 'u1'] });
    expect(describirCambios(c, (id) => (id === 'u1' ? 'Silvia' : '—'))).toBe('responsable: — → Silvia; estado: Pendiente → Hecha; avance: — → 100 %');
  });
  it('una tarea pendiente o en curso con el fin vencido sale VENCIDA; hecha no', () => {
    expect(estadoVisualTarea({ status: 'en_curso', endDate: '2026-10-17' }, '2026-10-18')).toBe('vencida');
    expect(estadoVisualTarea({ status: 'hecha', endDate: '2026-10-17' }, '2026-10-18')).toBe('hecha');
    expect(estadoVisualTarea({ status: 'pendiente', endDate: '2026-10-18' }, '2026-10-18')).toBe('pendiente');
  });
});

describe('fechas de una solicitud (decisión documentada)', () => {
  const hoy = '2026-10-18';
  it('abierta: de la radicación a hoy, o a la fecha objetivo si es posterior', () => {
    expect(fechasDeSolicitud({ createdAt: '2026-10-01', resolvedAt: null, idStatus: 1, targetDate: null }, hoy)).toMatchObject({ inicio: '2026-10-01', fin: hoy, abierta: true, vencida: false, estadoVisual: 'abierta' });
    expect(fechasDeSolicitud({ createdAt: '2026-10-01', resolvedAt: null, idStatus: 1, targetDate: '2026-10-25' }, hoy)).toMatchObject({ fin: '2026-10-25', vencida: false });
  });
  it('abierta con la fecha objetivo vencida → VENCIDA y la barra llega a hoy', () => {
    expect(fechasDeSolicitud({ createdAt: '2026-10-01', resolvedAt: null, idStatus: 4, targetDate: '2026-10-10' }, hoy)).toMatchObject({ fin: hoy, vencida: true, estadoVisual: 'vencida' });
  });
  it('resuelta o cancelada: hasta date_resolution', () => {
    expect(fechasDeSolicitud({ createdAt: '2026-10-01', resolvedAt: '2026-10-09', idStatus: 2, targetDate: '2026-10-05' }, hoy)).toMatchObject({ fin: '2026-10-09', abierta: false, vencida: false, estadoVisual: 'hecha' });
    expect(fechasDeSolicitud({ createdAt: '2026-10-01', resolvedAt: null, idStatus: 3, targetDate: null }, hoy)).toMatchObject({ fin: '2026-10-01', estadoVisual: 'cancelada' });
  });
  it('actividad del workflow: de start_date al cierre, u hoy si sigue abierta', () => {
    expect(fechasDeActividad({ startDate: null, endDate: null, resolvedAt: null, idStatus: 1 }, '2026-10-01', hoy)).toMatchObject({ inicio: '2026-10-01', fin: hoy, abierta: true });
    expect(fechasDeActividad({ startDate: '2026-10-03', endDate: '2026-10-03', resolvedAt: '2026-10-04', idStatus: 2 }, '2026-10-01', hoy)).toMatchObject({ inicio: '2026-10-03', fin: '2026-10-04', abierta: false });
  });
});

describe('geometría del Gantt', () => {
  it('el rango cubre ítems y hoy, redondeado al zoom y con un mínimo', () => {
    const r = rangoGantt([{ inicio: '2026-10-10', fin: '2026-10-15' }], '2026-10-18', 'semana');
    expect(r.desde).toBe('2026-10-05');
    expect(r.dias).toBeGreaterThanOrEqual(28);
    const m = rangoGantt([{ inicio: '2026-10-10', fin: '2026-12-15' }], '2026-10-18', 'mes');
    expect(m.desde).toBe('2026-10-01');
    expect(m.hasta >= '2026-12-31').toBe(true);
    const t = rangoGantt([], '2026-10-18', 'trimestre');
    expect(t.desde).toBe('2026-10-01');
  });
  it('un rango absurdo se recorta a tres años alrededor de hoy', () => {
    const r = rangoGantt([{ inicio: '2001-01-01', fin: '2099-01-01' }], '2026-10-18', 'mes');
    expect(r.dias).toBeLessThanOrEqual(3 * 366);
    expect(r.desde <= '2026-10-18' && r.hasta >= '2026-10-18').toBe(true);
  });
  it('barra: izquierda por días desde el inicio; el fin cuenta como día completo', () => {
    expect(posicionBarra('2026-10-12', '2026-10-14', '2026-10-05', PX_POR_DIA.semana)).toEqual({ left: 7 * 34, width: 3 * 34 });
    expect(posicionBarra('2026-10-01', '2026-10-06', '2026-10-05', 10)).toEqual({ left: 0, width: 20 });
  });
  it('marcas: meses arriba; días, semanas o meses abajo', () => {
    const s = marcasGantt('2026-10-05', '2026-11-01', 'semana');
    expect(s.mayores.map((x) => x.etiqueta)).toEqual(['octubre 2026', 'noviembre 2026']);
    expect(s.menores[0]).toMatchObject({ etiqueta: 'L 5', left: 0, width: 34 });
    const t = marcasGantt('2026-10-01', '2027-06-30', 'trimestre');
    expect(t.mayores.map((x) => x.etiqueta)).toEqual(['T4 2026', 'T1 2027', 'T2 2027']);
    expect(t.menores.map((x) => x.etiqueta).slice(0, 3)).toEqual(['oct', 'nov', 'dic']);
  });
});

describe('calendario', () => {
  it('tareas: inicio y vencimiento; hito y tarea de un día, un solo evento; solicitudes: radicada, objetivo y cierre', () => {
    const ev = eventosCalendario(
      [
        { id: 1, title: 'A', startDate: '2026-10-10', endDate: '2026-10-15', status: 'en_curso', isMilestone: false },
        { id: 2, title: 'B', startDate: '2026-10-25', endDate: '2026-10-25', status: 'pendiente', isMilestone: true },
        { id: 3, title: 'C', startDate: '2026-10-20', endDate: '2026-10-20', status: 'pendiente', isMilestone: false },
      ],
      [
        { idRequest: 9, subject: 'S', createdAt: '2026-10-01', resolvedAt: '2026-10-12', idStatus: 2, targetDate: '2026-10-11' },
        { idRequest: 10, subject: 'T', createdAt: '2026-10-02', resolvedAt: null, idStatus: 1, targetDate: null },
      ],
      '2026-10-18'
    );
    expect(ev.map((e) => `${e.fecha}:${e.tipo}:${e.ref.kind}${e.ref.id}`)).toEqual([
      '2026-10-01:creada:solicitud9',
      '2026-10-02:creada:solicitud10',
      '2026-10-10:inicio:tarea1',
      '2026-10-11:objetivo:solicitud9',
      '2026-10-12:resuelta:solicitud9',
      '2026-10-15:fin:tarea1',
      '2026-10-20:fin:tarea3',
      '2026-10-25:hito:tarea2',
    ]);
    expect(ev.find((e) => e.ref.id === 1)!.estado).toBe('vencida');
    const dias = agruparPorDia(ev, '2026-10-10', '2026-10-15');
    expect(dias.map((d) => d.fecha)).toEqual(['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-15']);
  });
});
