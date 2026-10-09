'use client';

import { useEffect, useRef, useState } from 'react';

type CountUpProps = {
  /** Valor como se muestra, p. ej. "500+" o "98%". */
  value: string;
  className?: string;
  durationMs?: number;
};

/** Cuenta desde 0 hasta el número cuando entra en pantalla (respeta "reducir movimiento"). */
export default function CountUp({ value, className, durationMs = 1600 }: CountUpProps) {
  const match = value.match(/^(\D*)(\d+)(.*)$/);
  const target = match ? Number(match[2]) : 0;
  const ref = useRef<HTMLSpanElement | null>(null);
  const [shown, setShown] = useState(match ? 0 : target);

  useEffect(() => {
    const node = ref.current;
    if (!match || !node) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof IntersectionObserver === 'undefined') {
      setShown(target);
      return;
    }
    let raf = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / durationMs);
          const eased = 1 - Math.pow(1 - t, 4);
          setShown(Math.round(target * eased));
          if (t < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.4 }
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [target, durationMs]);

  if (!match) return <span className={className}>{value}</span>;

  return (
    <span
      ref={ref}
      className={className}
      aria-label={value}
      style={{
        background: 'linear-gradient(120deg, #113562 10%, #3db6e0 100%)',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
      }}
    >
      {match[1]}
      {shown}
      {match[3]}
    </span>
  );
}
