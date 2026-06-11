'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { AppTheme } from '../../lib/theme/constants';

type Node = { x: number; y: number; r: number; delay: number };

/** Red molecular estilizada (alusiva a compuestos farmacéuticos) */
const MOLECULE_NODES: Node[] = [
  { x: 12, y: 22, r: 3.2, delay: 0 },
  { x: 22, y: 14, r: 2.8, delay: 0.4 },
  { x: 34, y: 20, r: 3.5, delay: 0.8 },
  { x: 48, y: 12, r: 2.6, delay: 1.2 },
  { x: 62, y: 18, r: 3.3, delay: 0.2 },
  { x: 78, y: 14, r: 2.9, delay: 0.6 },
  { x: 88, y: 28, r: 3.1, delay: 1 },
  { x: 8, y: 42, r: 2.7, delay: 1.4 },
  { x: 18, y: 52, r: 3.4, delay: 0.3 },
  { x: 32, y: 46, r: 2.5, delay: 0.7 },
  { x: 46, y: 38, r: 4, delay: 0.1 },
  { x: 58, y: 44, r: 3, delay: 0.5 },
  { x: 72, y: 40, r: 2.8, delay: 0.9 },
  { x: 84, y: 48, r: 3.2, delay: 1.3 },
  { x: 26, y: 68, r: 2.6, delay: 0.15 },
  { x: 42, y: 62, r: 3.6, delay: 0.55 },
  { x: 56, y: 70, r: 2.9, delay: 0.95 },
  { x: 70, y: 64, r: 3.1, delay: 1.35 },
  { x: 52, y: 82, r: 2.7, delay: 0.25 },
  { x: 38, y: 88, r: 3, delay: 0.65 },
  { x: 64, y: 86, r: 2.5, delay: 1.05 },
];

const MOLECULE_EDGES: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
  [5, 6],
  [0, 7],
  [7, 8],
  [8, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [12, 13],
  [8, 14],
  [14, 15],
  [15, 16],
  [16, 17],
  [15, 18],
  [18, 19],
  [16, 20],
  [10, 15],
  [11, 16],
  [4, 12],
  [2, 9],
];

type LoginPharmacyBackgroundProps = {
  theme: AppTheme;
};

export default function LoginPharmacyBackground({ theme }: LoginPharmacyBackgroundProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const isDark = theme === 'dark';

  const handlePointer = useCallback((clientX: number, clientY: number) => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (clientX - rect.left) / rect.width;
    const py = (clientY - rect.top) / rect.height;
    el.style.setProperty('--px', String(px));
    el.style.setProperty('--py', String(py));
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const onMove = (e: PointerEvent) => handlePointer(e.clientX, e.clientY);
    const onLeave = () => {
      el.style.setProperty('--px', '0.5');
      el.style.setProperty('--py', '0.5');
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerleave', onLeave);

    return () => {
      window.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [handlePointer]);

  return (
    <div
      ref={rootRef}
      className={`login-pharmacy-bg ${isDark ? 'login-pharmacy-bg--dark' : 'login-pharmacy-bg--light'}`}
      aria-hidden
    >
      <div className='login-pharmacy-bg__gradient' />

      <div className='login-pharmacy-bg__parallax'>
        <svg
          className='login-pharmacy-bg__molecule'
          viewBox='0 0 100 100'
          preserveAspectRatio='xMidYMid slice'
        >
          <g className='login-pharmacy-bg__bonds'>
            {MOLECULE_EDGES.map(([a, b], i) => {
              const n1 = MOLECULE_NODES[a];
              const n2 = MOLECULE_NODES[b];
              return (
                <line
                  key={`bond-${i}`}
                  x1={n1.x}
                  y1={n1.y}
                  x2={n2.x}
                  y2={n2.y}
                  className='login-pharmacy-bg__bond'
                />
              );
            })}
          </g>
          <g className='login-pharmacy-bg__atoms'>
            {MOLECULE_NODES.map((node, i) => (
              <circle
                key={`atom-${i}`}
                cx={node.x}
                cy={node.y}
                r={node.r}
                className='login-pharmacy-bg__atom'
                style={{ animationDelay: `${node.delay}s` }}
              />
            ))}
          </g>
        </svg>

        <div className='login-pharmacy-bg__capsules'>
          <span className='login-pharmacy-bg__capsule login-pharmacy-bg__capsule--1' />
          <span className='login-pharmacy-bg__capsule login-pharmacy-bg__capsule--2' />
          <span className='login-pharmacy-bg__capsule login-pharmacy-bg__capsule--3' />
        </div>

        <div className='login-pharmacy-bg__pulse login-pharmacy-bg__pulse--1' />
        <div className='login-pharmacy-bg__pulse login-pharmacy-bg__pulse--2' />
      </div>

      <style jsx>{`
        .login-pharmacy-bg {
          --px: 0.5;
          --py: 0.5;
          position: absolute;
          inset: 0;
          z-index: 0;
          overflow: hidden;
          pointer-events: none;
        }

        .login-pharmacy-bg__gradient {
          position: absolute;
          inset: 0;
          transition: background 0.6s ease;
        }

        .login-pharmacy-bg--light .login-pharmacy-bg__gradient {
          background:
            radial-gradient(ellipse 70% 55% at 18% 8%, rgba(17, 53, 98, 0.04), transparent 58%),
            radial-gradient(ellipse 60% 45% at 88% 92%, rgba(61, 182, 224, 0.05), transparent 52%),
            linear-gradient(165deg, #f8f9fb 0%, #f4f6f8 45%, #eef1f5 100%);
        }

        .login-pharmacy-bg--dark .login-pharmacy-bg__gradient {
          background:
            radial-gradient(ellipse 75% 55% at 15% 15%, rgba(94, 179, 232, 0.18), transparent 55%),
            radial-gradient(ellipse 65% 45% at 88% 85%, rgba(45, 212, 191, 0.1), transparent 50%),
            linear-gradient(155deg, #0a101c 0%, #121c30 35%, #152238 68%, #1a2d48 100%);
        }

        .login-pharmacy-bg__parallax {
          position: absolute;
          inset: -5%;
          transform: translate(
            calc((var(--px) - 0.5) * -28px),
            calc((var(--py) - 0.5) * -22px)
          );
          transition: transform 0.55s cubic-bezier(0.22, 1, 0.36, 1);
          will-change: transform;
        }

        .login-pharmacy-bg__molecule {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          opacity: 0.55;
        }

        .login-pharmacy-bg--light .login-pharmacy-bg__molecule {
          opacity: 0.26;
        }

        .login-pharmacy-bg--dark .login-pharmacy-bg__molecule {
          opacity: 0.75;
        }

        .login-pharmacy-bg__bond {
          stroke-width: 0.35;
          stroke-linecap: round;
          animation: bondPulse 6s ease-in-out infinite;
        }

        .login-pharmacy-bg--light .login-pharmacy-bg__parallax {
          transform: translate(
            calc((var(--px) - 0.5) * -14px),
            calc((var(--py) - 0.5) * -10px)
          );
        }

        .login-pharmacy-bg--light .login-pharmacy-bg__bond {
          stroke: rgba(17, 53, 98, 0.09);
          animation: bondPulseLight 8s ease-in-out infinite;
        }

        .login-pharmacy-bg--dark .login-pharmacy-bg__bond {
          stroke: rgba(126, 200, 239, 0.28);
        }

        .login-pharmacy-bg__atom {
          animation: atomBreath 5s ease-in-out infinite;
          transform-origin: center;
          transform-box: fill-box;
        }

        .login-pharmacy-bg--light .login-pharmacy-bg__atom {
          fill: rgba(17, 53, 98, 0.12);
          animation: atomBreathLight 7s ease-in-out infinite;
        }

        .login-pharmacy-bg--dark .login-pharmacy-bg__atom {
          fill: rgba(126, 200, 239, 0.55);
          filter: drop-shadow(0 0 6px rgba(94, 179, 232, 0.45));
        }

        .login-pharmacy-bg__capsules {
          position: absolute;
          inset: 0;
        }

        .login-pharmacy-bg__capsule {
          position: absolute;
          width: 52px;
          height: 20px;
          border-radius: 999px;
          opacity: 0.2;
          animation: capsuleDrift 18s ease-in-out infinite;
        }

        .login-pharmacy-bg__capsule::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          border: 1px solid rgba(255, 255, 255, 0.35);
        }

        .login-pharmacy-bg__capsule::after {
          content: '';
          position: absolute;
          top: 2px;
          bottom: 2px;
          left: 50%;
          width: 1px;
          transform: translateX(-50%);
          background: rgba(255, 255, 255, 0.45);
        }

        .login-pharmacy-bg--light .login-pharmacy-bg__capsule {
          background: linear-gradient(
            90deg,
            rgba(17, 53, 98, 0.14) 50%,
            rgba(92, 118, 140, 0.12) 50%
          );
          opacity: 0.35;
        }

        .login-pharmacy-bg--light .login-pharmacy-bg__capsule::before {
          border-color: rgba(17, 53, 98, 0.08);
        }

        .login-pharmacy-bg--light .login-pharmacy-bg__capsule::after {
          background: rgba(17, 53, 98, 0.1);
        }

        .login-pharmacy-bg--dark .login-pharmacy-bg__capsule {
          background: linear-gradient(90deg, rgba(94, 179, 232, 0.5) 50%, rgba(45, 212, 191, 0.45) 50%);
          opacity: 0.28;
          filter: drop-shadow(0 0 12px rgba(94, 179, 232, 0.25));
        }

        .login-pharmacy-bg__capsule--1 {
          top: 18%;
          left: 8%;
          animation-delay: 0s;
          transform: rotate(-18deg);
        }

        .login-pharmacy-bg__capsule--2 {
          top: 62%;
          right: 10%;
          width: 44px;
          height: 17px;
          animation-delay: -6s;
          transform: rotate(22deg);
        }

        .login-pharmacy-bg__capsule--3 {
          bottom: 14%;
          left: 22%;
          width: 38px;
          height: 15px;
          animation-delay: -11s;
          transform: rotate(-8deg);
        }

        .login-pharmacy-bg__pulse {
          position: absolute;
          border-radius: 50%;
          border: 1px solid transparent;
          animation: carePulse 4.5s ease-out infinite;
        }

        .login-pharmacy-bg--light .login-pharmacy-bg__pulse {
          display: none;
        }

        .login-pharmacy-bg--dark .login-pharmacy-bg__pulse {
          border-color: rgba(94, 179, 232, 0.4);
        }

        .login-pharmacy-bg__pulse--1 {
          width: 120px;
          height: 120px;
          top: 28%;
          right: 18%;
        }

        .login-pharmacy-bg__pulse--2 {
          width: 90px;
          height: 90px;
          bottom: 22%;
          right: 32%;
          animation-delay: -2.2s;
        }

        @keyframes atomBreathLight {
          0%,
          100% {
            transform: scale(1);
            opacity: 0.7;
          }
          50% {
            transform: scale(1.08);
            opacity: 0.9;
          }
        }

        @keyframes bondPulseLight {
          0%,
          100% {
            opacity: 0.55;
          }
          50% {
            opacity: 0.85;
          }
        }

        @keyframes atomBreath {
          0%,
          100% {
            transform: scale(1);
            opacity: 0.85;
          }
          50% {
            transform: scale(1.18);
            opacity: 1;
          }
        }

        @keyframes bondPulse {
          0%,
          100% {
            opacity: 0.65;
          }
          50% {
            opacity: 1;
          }
        }

        @keyframes capsuleDrift {
          0%,
          100% {
            translate: 0 0;
          }
          33% {
            translate: 12px -18px;
          }
          66% {
            translate: -8px 10px;
          }
        }

        @keyframes carePulse {
          0% {
            transform: scale(0.6);
            opacity: 0.55;
          }
          70% {
            transform: scale(1.4);
            opacity: 0;
          }
          100% {
            transform: scale(1.4);
            opacity: 0;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .login-pharmacy-bg__parallax {
            transform: none !important;
            transition: none;
          }

          .login-pharmacy-bg__atom,
          .login-pharmacy-bg__bond,
          .login-pharmacy-bg__capsule,
          .login-pharmacy-bg__pulse {
            animation: none !important;
          }
        }

        @media (max-width: 768px) {
          .login-pharmacy-bg__capsule {
            width: 36px;
            height: 14px;
          }

          .login-pharmacy-bg__pulse {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
