'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@mantine/hooks';

/**
 * Sticker ANIMADO (WebP) que se reproduce en bucle SOLO cuando se ve
 * (2026-10-20).
 *
 * Cómo ahorra en el celular, como Telegram:
 *   - Siempre está el CUADRO FIJO (`poster`, unos pocos KB, `loading=lazy`).
 *   - El WebP animado se monta encima SOLO mientras el sticker está en
 *     pantalla (IntersectionObserver compartido). Al salir se DESMONTA: el
 *     navegador deja de decodificar cuadros y libera la memoria. Así solo se
 *     descargan los animados que de verdad se ven.
 *   - Con `prefers-reduced-motion: reduce` nunca se monta el animado: queda el
 *     cuadro fijo.
 * El animado entra con opacidad 0 y aparece al cargar: no hay parpadeo en
 * blanco entre el cuadro fijo y el primer cuadro en movimiento.
 */

type Visibilidad = (visible: boolean) => void;

// UN solo observador para todos los stickers de la página (el hilo puede
// tener decenas). El margen precarga un poco antes de que entren.
let observador: IntersectionObserver | null = null;
const escuchas = new Map<Element, Visibilidad>();

function observar(el: Element, cb: Visibilidad): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    cb(true);
    return () => {};
  }
  if (!observador) {
    observador = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) escuchas.get(e.target)?.(e.isIntersecting);
      },
      { rootMargin: '120px 0px' }
    );
  }
  escuchas.set(el, cb);
  observador.observe(el);
  return () => {
    escuchas.delete(el);
    observador?.unobserve(el);
  };
}

function StickerAnimado({
  src,
  poster,
  alt,
  title,
  size,
  className,
}: {
  src: string;
  poster: string;
  alt: string;
  title?: string;
  size: number;
  className?: string;
}) {
  const caja = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [cargado, setCargado] = useState(false);
  const sinMovimiento = useReducedMotion();

  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    return observar(el, setVisible);
  }, []);

  // Al dejar de verse se desmonta el animado; al volver tiene que cargar
  // (desde la caché) y aparecer de nuevo.
  useEffect(() => {
    if (!visible) setCargado(false);
  }, [visible]);

  const jugar = visible && !sinMovimiento;

  return (
    <span
      ref={caja}
      className={['chat-sticker-anim', className].filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
      data-animando={jugar && cargado ? 'true' : 'false'}
      title={title}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- imagen local versionada */}
      <img src={poster} alt={alt} width={size} height={size} loading='lazy' draggable={false} />
      {jugar && (
        // eslint-disable-next-line @next/next/no-img-element -- WebP animado local versionado
        <img
          src={src}
          alt=''
          aria-hidden='true'
          width={size}
          height={size}
          draggable={false}
          className={cargado ? 'chat-sticker-anim__mov chat-sticker-anim__mov--listo' : 'chat-sticker-anim__mov'}
          onLoad={() => setCargado(true)}
        />
      )}
    </span>
  );
}

export default memo(StickerAnimado);
