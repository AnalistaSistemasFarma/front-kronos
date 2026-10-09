import { svgToDataUri } from './compose';
import {
  PALETAS_FIGURA,
  carasDe,
  composeFiguraSvg,
  etiquetaCara,
  etiquetaExtra,
  etiquetaVariante,
  extrasDe,
  posicionCara,
  variantesDe,
  type ColorFigura,
  type FiguraConfig,
} from './figuras';

/**
 * Categorías del editor de FIGURAS (asistentes): los mismos círculos con
 * miniatura y la misma cuadrícula que el editor de Lorelei, pero con las
 * opciones de la figura: cuál, expresión, accesorio y tres colores.
 */

export type CategoriaFiguraId = 'variante' | 'cara' | 'extra' | ColorFigura;

export interface CategoriaFigura {
  id: CategoriaFiguraId;
  label: string;
  title: string;
  /** Valores posibles; null = "Ninguno" (solo en accesorio). */
  opciones: ReadonlyArray<string | null>;
  esColor: boolean;
}

const TITULO_VARIANTE: Record<FiguraConfig['kind'], string> = {
  animal: 'Animales',
  planeta: 'Planetas',
  constelacion: 'Constelaciones',
  estrella: 'Estrellas',
  robot: 'Robots',
};

export function categoriasFigura(kind: FiguraConfig['kind']): readonly CategoriaFigura[] {
  const color = (id: ColorFigura, label: string, title: string): CategoriaFigura => ({
    id,
    label,
    title,
    opciones: PALETAS_FIGURA[id].map((p) => p.color),
    esColor: true,
  });
  return [
    { id: 'variante', label: 'Figura', title: TITULO_VARIANTE[kind], opciones: variantesDe(kind), esColor: false },
    { id: 'cara', label: 'Expresión', title: 'Expresiones', opciones: carasDe(kind), esColor: false },
    { id: 'extra', label: 'Accesorio', title: 'Accesorios', opciones: [null, ...extrasDe(kind)], esColor: false },
    color('relleno', 'Relleno', 'Colores de relleno'),
    color('acento', 'Acento', 'Colores de acento'),
    color('fondo', 'Fondo', 'Fondos'),
  ];
}

export function valorFigura(config: FiguraConfig, cat: CategoriaFiguraId): string | null {
  return config[cat] ?? null;
}

export function conValorFigura(config: FiguraConfig, cat: CategoriaFiguraId, valor: string | null): FiguraConfig {
  if (cat === 'extra') return { ...config, extra: valor };
  return valor === null ? config : { ...config, [cat]: valor };
}

export function etiquetaFigura(config: FiguraConfig, cat: CategoriaFiguraId, valor: string | null): string {
  if (cat === 'extra') return etiquetaExtra(valor);
  if (valor === null) return 'Ninguno';
  if (cat === 'variante') return etiquetaVariante(config.kind, valor);
  if (cat === 'cara') return etiquetaCara(valor);
  return PALETAS_FIGURA[cat].find((p) => p.color === valor)?.label ?? '#' + valor;
}

/** Miniatura (data: URI): la figura con UNA opción cambiada; la expresión, recortada a la carita. */
export function thumbFiguraDataUri(config: FiguraConfig, cat: CategoriaFiguraId, valor: string | null): string {
  const variante = conValorFigura(config, cat, valor);
  let viewBox: string | undefined;
  if (cat === 'cara') {
    const { x, y, k } = posicionCara(variante);
    const lado = Math.max(70, 110 * k);
    viewBox = [x - lado / 2, y - lado / 2 + 8 * k, lado, lado].map((n) => Math.round(n)).join(' ');
  }
  return svgToDataUri(composeFiguraSvg(variante, { viewBox, sinFondo: cat !== 'fondo' }));
}
