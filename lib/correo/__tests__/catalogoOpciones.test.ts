import { describe, expect, it } from 'vitest';
import { categoriaDeProceso, etiquetaProceso, opcionesCategorias, opcionesProcesos, opcionesProcesosAgrupadas } from '../../../components/correo/catalogoOpciones';

// Cascada Categoría → Proceso de la simulación del Correo (igual que «Nueva solicitud»).
const categorias = [
  { id: 5, categoria: 'Jurídica' },
  { id: 6, categoria: 'Tesorería' },
  { id: 7, categoria: 'Sin procesos' },
];
const procesos = [
  { id: 10, nombre: 'Contratos', descripcion: 'Elaboración y revisión', idCategoria: 5 },
  { id: 20, nombre: 'Poderes', idCategoria: 5 },
  { id: 30, nombre: 'Solicitud de Pago', idCategoria: 6 },
];

describe('Correo · cascada Categoría → Proceso', () => {
  it('todas las categorías de la empresa y, por categoría, solo sus procesos', () => {
    expect(opcionesCategorias(categorias).map((o) => o.label)).toEqual(['Jurídica', 'Tesorería', 'Sin procesos']);
    expect(opcionesProcesos(procesos, 5)).toEqual([
      { value: '10', label: 'Contratos - Elaboración y revisión' },
      { value: '20', label: 'Poderes' },
    ]);
    expect(opcionesProcesos(procesos, 7)).toEqual([]);
    expect(opcionesProcesos(procesos, null)).toEqual([]);
  });

  it('proceso por defecto: agrupado por categoría, sin grupos vacíos', () => {
    expect(opcionesProcesosAgrupadas(categorias, procesos).map((g) => [g.group, g.items.length])).toEqual([
      ['Jurídica', 2],
      ['Tesorería', 1],
    ]);
  });

  it('la sugerencia (proceso) fija su categoría', () => {
    expect(categoriaDeProceso(procesos, 30)).toBe(6);
    expect(categoriaDeProceso(procesos, 99)).toBeNull();
    expect(categoriaDeProceso(procesos, null)).toBeNull();
    expect(etiquetaProceso({ nombre: 'X', descripcion: null })).toBe('X');
  });
});
