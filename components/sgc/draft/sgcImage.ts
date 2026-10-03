import { Node, mergeAttributes } from '@tiptap/react';

/**
 * Imagen INCRUSTADA en el borrador del editor (p. ej. el logo de un Word
 * convertido). Corrección 2026-10-03 («no carga el logo»): el editor no tenía
 * nodo de imagen y el logo se perdía. Sin dependencia nueva: nodo propio de
 * Tiptap que solo acepta imágenes incrustadas (data:image/png, jpeg o gif);
 * el servidor vuelve a limpiar el HTML con su lista blanca al guardar.
 */
export const SgcImage = Node.create({
  name: 'image',
  inline: true,
  group: 'inline',
  draggable: true,
  atom: true,
  addAttributes() {
    return { src: { default: null } };
  },
  parseHTML() {
    return [
      {
        tag: 'img[src]',
        getAttrs: (el) => (/^data:image\/(png|jpeg|jpg|gif);base64,/i.test((el as HTMLElement).getAttribute('src') ?? '') ? {} : false),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes, { style: 'max-width:100%;height:auto' })];
  },
});
