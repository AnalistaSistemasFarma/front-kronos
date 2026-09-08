'use client';

import { useEffect, useRef } from 'react';

/**
 * Publica el alto REALMENTE visible de la pantalla en la variable CSS
 * `--alto-visible`, y lo mantiene al día cuando sale o se guarda el teclado.
 *
 * POR QUÉ HACE FALTA, si ya usamos `dvh`:
 * `dvh` responde a las barras del navegador que aparecen y desaparecen, pero
 * en iOS —y en varios navegadores de Android— **NO se encoge cuando sale el
 * teclado**. El teclado no cambia el viewport de diseño: lo que cambia es el
 * *visual viewport*. Resultado: el contenedor sigue midiendo la pantalla
 * completa, la caja de escribir queda por debajo del teclado y al usuario le
 * toca hacer scroll para verla. Que es exactamente lo que pasaba.
 *
 * `window.visualViewport` sí refleja el teclado, así que de ahí sale la
 * medida. En navegadores sin esa API no se escribe nada y el CSS cae a su
 * valor por defecto (`100dvh`), que es el comportamiento de antes.
 *
 * TAMBIÉN PUBLICA EL DESPLAZAMIENTO (`--desplazamiento-visible`):
 * el alto no alcanza. Cuando sale el teclado, el navegador mueve el *visual
 * viewport* hacia abajo dentro del de diseño para dejar el campo a la vista, y
 * eso es `vv.offsetTop`. Un elemento anclado arriba del viewport de diseño se
 * queda donde estaba y aparece un hueco entre la caja de escribir y el
 * teclado — justo del tamaño de ese desplazamiento. Con la variable, el
 * contenedor se corre lo mismo y queda pegado a lo que de verdad se ve.
 */
export function useAltoVisible(alCambiar?: () => void) {
  // La referencia evita reinstalar los escuchas en cada render por el cambio
  // de identidad de la función.
  const avisar = useRef(alCambiar);
  avisar.current = alCambiar;

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const raiz = document.documentElement;

    const actualizar = () => {
      // `Math.round` a propósito: los decimales del visual viewport hacen
      // parpadear el layout en cada micro-scroll.
      raiz.style.setProperty('--alto-visible', `${Math.round(vv.height)}px`);
      raiz.style.setProperty('--desplazamiento-visible', `${Math.round(vv.offsetTop)}px`);
      avisar.current?.();
    };

    actualizar();
    vv.addEventListener('resize', actualizar);
    vv.addEventListener('scroll', actualizar);

    return () => {
      vv.removeEventListener('resize', actualizar);
      vv.removeEventListener('scroll', actualizar);
      raiz.style.removeProperty('--alto-visible');
      raiz.style.removeProperty('--desplazamiento-visible');
    };
  }, []);
}
