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
      avisar.current?.();
    };

    actualizar();
    vv.addEventListener('resize', actualizar);
    vv.addEventListener('scroll', actualizar);

    return () => {
      vv.removeEventListener('resize', actualizar);
      vv.removeEventListener('scroll', actualizar);
      raiz.style.removeProperty('--alto-visible');
    };
  }, []);
}
