'use client';

import { useMemo } from 'react';

const GLYPHS = ['♥', '♡', '❤', '💕', '💗'];

type Props = {
  count?: number;
};

export default function ValentineHearts({ count = 18 }: Props) {
  const hearts = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        left: `${(i * 37 + 11) % 100}%`,
        delay: `${(i % 10) * 0.55}s`,
        duration: `${9 + (i % 7)}s`,
        size: `${0.75 + (i % 5) * 0.22}rem`,
        glyph: GLYPHS[i % GLYPHS.length],
      })),
    [count]
  );

  return (
    <div className='vw-hearts' aria-hidden>
      {hearts.map((h) => (
        <span
          key={h.id}
          className='vw-heart-float'
          style={{
            left: h.left,
            animationDelay: h.delay,
            animationDuration: h.duration,
            fontSize: h.size,
          }}
        >
          {h.glyph}
        </span>
      ))}
    </div>
  );
}
