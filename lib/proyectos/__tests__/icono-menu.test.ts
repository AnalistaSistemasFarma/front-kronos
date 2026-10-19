import { describe, expect, it } from 'vitest';
import { IconFolders, IconShoppingCart } from '@tabler/icons-react';
import { uniqueSubprocessIcons } from '../../process/processVisuals';

describe('ícono del módulo «Proyectos» en el menú', () => {
  it('es la carpeta, no el carrito de compras; «Compras» sigue con su carrito', () => {
    expect(uniqueSubprocessIcons(['Proyectos'])[0]).toBe(IconFolders);
    expect(uniqueSubprocessIcons(['Compras'])[0]).toBe(IconShoppingCart);
  });
});
