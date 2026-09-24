'use client';

import { useEffect, useRef, type CSSProperties } from 'react';

type Props = {
  arriving: boolean;
  open: boolean;
  onOpen: () => void;
};

/** Tilt a pantalla completa: el cursor en cualquier punto mueve la carta. */
export default function ValentineEnvelope({ arriving, open, onOpen }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const ready = !arriving && !open;

  useEffect(() => {
    if (open || arriving) return;

    const onMove = (e: PointerEvent) => {
      const el = stageRef.current;
      if (!el) return;
      const cx = e.clientX;
      const cy = e.clientY;
      if (rafRef.current) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = 0;
        const px = cx / window.innerWidth - 0.5;
        const py = cy / window.innerHeight - 0.5;
        el.style.setProperty('--vw-tilt-x', `${12 - py * 22}deg`);
        el.style.setProperty('--vw-tilt-y', `${px * 28}deg`);
      });
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    };
  }, [arriving, open]);

  const stageClass = [
    'vw-envelope-stage',
    arriving ? 'vw-envelope-stage--arrive' : '',
    ready ? 'vw-envelope-stage--idle' : '',
    open ? 'vw-envelope-stage--opening' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={stageRef}
      className={stageClass}
      style={{ '--vw-tilt-x': '10deg', '--vw-tilt-y': '-8deg' } as CSSProperties}
    >
      <div className={open ? 'vw-envelope vw-envelope--open' : 'vw-envelope'}>
        <div className='vw-envelope__shadow' aria-hidden />
        <div className='vw-envelope__body'>
          <div className='vw-envelope__letter' aria-hidden>
            <span className='vw-envelope__letter-inner'>
              Tu dosis
              <br />
              te espera ♥
            </span>
          </div>
          <div className='vw-envelope__pocket' aria-hidden />
          <div className='vw-envelope__flap' />
          <button
            type='button'
            className='vw-envelope__seal'
            onClick={ready ? onOpen : undefined}
            disabled={!ready}
            aria-label='Abrir el sobre'
          >
            ♥
          </button>
          <div className='vw-envelope__label'>
            Dosis de Amor
            <br />y Amistad
          </div>
        </div>
        {ready ? (
          <button
            type='button'
            className='vw-envelope__cta'
            onClick={onOpen}
            aria-label='Abrir carta de Dosis de Amor y Amistad'
          />
        ) : null}
      </div>
      {arriving ? (
        <p className='vw-envelope__hint'>Llegando tu dosis…</p>
      ) : ready ? (
        <p className='vw-envelope__hint'>Mueve el cursor · toca el sello para sacar la carta</p>
      ) : (
        <p className='vw-envelope__hint'>Sacando la carta…</p>
      )}
    </div>
  );
}
