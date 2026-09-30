'use client';

import { useEffect, useRef } from 'react';

/*
 * GESTO DEL USUARIO EN CURSO (2026-09-23, "hago scroll un poco hacia arriba y
 * se sube mucho"). Mientras el dedo está puesto —y durante la inercia, hasta
 * ~250 ms después del último scroll— nadie debe tocar `scrollTop` ni
 * `window.scrollTo`: en iOS el arrastre del hilo encadena rebote al documento,
 * eso dispara `visualViewport` scroll, y las correcciones (devolver el
 * documento a 0 + fijar el fondo) se sumaban al movimiento del dedo.
 */
let tocando = false;
let ultimoScrollUsuario = 0;
const QUIETUD_MS = 250;
export function usuarioInteractuando() {
  return tocando || Date.now() - ultimoScrollUsuario < QUIETUD_MS;
}

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
    let ultimoAlto = -1;
    let ultimoOffset = -1;

    const escribir = () => {
      // `Math.round` a propósito: los decimales del visual viewport hacen
      // parpadear el layout en cada micro-scroll.
      const alto = Math.round(vv.height);
      const offset = Math.round(vv.offsetTop);
      if (alto === ultimoAlto && offset === ultimoOffset) return;
      ultimoAlto = alto;
      ultimoOffset = offset;
      raiz.style.setProperty('--alto-visible', `${alto}px`);
      raiz.style.setProperty('--desplazamiento-visible', `${offset}px`);
      if (!usuarioInteractuando()) avisar.current?.();
    };

    /*
     * AGRUPADO POR CUADRO (2026-09-09, por el reporte de lentitud de Nicolás).
     *
     * `scroll` del visual viewport se dispara muchas veces por segundo con el
     * dedo puesto. Antes cada evento escribía dos variables CSS y llamaba al
     * aviso, y cada escritura invalida el diseño de todo lo que depende de
     * esas variables — que es el contenedor completo del chat. Se hacía el
     * mismo trabajo varias veces por cuadro y solo se veía el último.
     *
     * Con requestAnimationFrame se escribe UNA vez por cuadro, que es la única
     * que el usuario alcanza a ver. El resto se descarta.
     */
    let pendiente = 0;
    const actualizar = () => {
      if (pendiente) return;
      pendiente = window.requestAnimationFrame(() => {
        pendiente = 0;
        escribir();
      });
    };

    /*
     * TECLADO SIN SALTO (2026-09-23, "cuando se abre el teclado hace un salto
     * feo"). Solo en táctil: en escritorio no hay teclado virtual y nada de
     * esto corre.
     *
     * 1) `resize` se escribe EN EL MISMO EVENTO, sin esperar al rAF. Durante
     *    la animación del teclado iOS lo emite una vez por cuadro; agruparlo
     *    retrasaba un cuadro el alto nuevo, y el aviso (que fija el scroll al
     *    fondo) corría otro más tarde: el contenedor se encogía, los últimos
     *    mensajes quedaban tapados y luego "saltaban" a su sitio.
     * 2) Al enfocar la caja, iOS DESPLAZA EL DOCUMENTO para mostrarla aunque
     *    `html` tenga `overflow: hidden`; el contenedor fijo se corría y
     *    `--desplazamiento-visible` lo devolvía un cuadro después. Con el chat
     *    a pantalla completa se devuelve el documento a 0 de inmediato, así
     *    el desplazamiento se queda en 0 y no hay nada que corregir.
     */
    const tactil = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    const fijarDocumento = () => {
      if (usuarioInteractuando()) return;
      if (!raiz.classList.contains('chat-inmersivo')) return;
      if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
    };
    const alRedimensionar = () => {
      fijarDocumento();
      if (pendiente) {
        window.cancelAnimationFrame(pendiente);
        pendiente = 0;
      }
      escribir();
    };
    const alDesplazar = () => {
      fijarDocumento();
      actualizar();
    };
    const alEnfocar = () => {
      fijarDocumento();
      // Por si iOS desplaza el documento después del foco, antes del primer
      // `resize` del teclado.
      window.requestAnimationFrame(fijarDocumento);
    };

    const alTocar = () => {
      tocando = true;
      ultimoScrollUsuario = Date.now();
    };
    const alSoltar = () => {
      tocando = false;
      ultimoScrollUsuario = Date.now();
    };
    // Cualquier scroll con el dedo puesto o justo después (inercia) extiende
    // la ventana de quietud.
    const alScrollDocumento = () => {
      if (tocando || Date.now() - ultimoScrollUsuario < QUIETUD_MS) ultimoScrollUsuario = Date.now();
    };
    const opcionesPasivas = { capture: true, passive: true } as const;
    if (tactil) {
      window.addEventListener('touchstart', alTocar, opcionesPasivas);
      window.addEventListener('touchend', alSoltar, opcionesPasivas);
      window.addEventListener('touchcancel', alSoltar, opcionesPasivas);
      window.addEventListener('scroll', alScrollDocumento, opcionesPasivas);
    }

    escribir();
    vv.addEventListener('resize', tactil ? alRedimensionar : actualizar);
    vv.addEventListener('scroll', tactil ? alDesplazar : actualizar);
    if (tactil) window.addEventListener('focusin', alEnfocar);

    return () => {
      if (pendiente) window.cancelAnimationFrame(pendiente);
      vv.removeEventListener('resize', tactil ? alRedimensionar : actualizar);
      vv.removeEventListener('scroll', tactil ? alDesplazar : actualizar);
      if (tactil) {
        window.removeEventListener('focusin', alEnfocar);
        window.removeEventListener('touchstart', alTocar, opcionesPasivas);
        window.removeEventListener('touchend', alSoltar, opcionesPasivas);
        window.removeEventListener('touchcancel', alSoltar, opcionesPasivas);
        window.removeEventListener('scroll', alScrollDocumento, opcionesPasivas);
      }
      raiz.style.removeProperty('--alto-visible');
      raiz.style.removeProperty('--desplazamiento-visible');
    };
  }, []);
}
