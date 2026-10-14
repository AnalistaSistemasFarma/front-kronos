'use client';

import { useRef } from 'react';
import gsap from 'gsap';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { IconCash, IconDeviceLaptop, IconShoppingCart, IconUsers } from '@tabler/icons-react';
import styles from './landing.module.css';

// Plugins registrados dentro del efecto (después de hidratar), igual que en LandingMotion.

/** Áreas que orbitan el núcleo SynerLink; `angle` es su punto de partida en la elipse. */
const NODES = [
  { label: 'Recursos Humanos', icon: IconUsers, angle: 218 },
  { label: 'Finanzas', icon: IconCash, angle: 322 },
  { label: 'Servicios de TI', icon: IconDeviceLaptop, angle: 38 },
  { label: 'Compras', icon: IconShoppingCart, angle: 142 },
];

/** Elipse de la órbita en % del cuadro (el SVG usa el mismo sistema: viewBox 0 0 100 100). */
const RX = 30;
const RY = 27;
/** Segundos por vuelta completa. */
const LAP = 70;
const MAX_TILT = 9;

function pointAt(angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: 50 + RX * Math.cos(a), y: 50 + RY * Math.sin(a) };
}

/**
 * Ventana estilo macOS con la constelación de SynerLink. Las áreas giran alrededor del núcleo
 * con las líneas siempre unidas a ellas; el cursor las atrae un poco y la ventana se inclina en 3D.
 */
export default function SynerLinkOrbit() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const windowRef = useRef<HTMLDivElement | null>(null);

  useGSAP(
    () => {
      gsap.registerPlugin(DrawSVGPlugin, ScrollTrigger);
      const win = windowRef.current;
      const stage = stageRef.current;
      if (!win || !stage) return;
      const q = gsap.utils.selector(stage);
      const mm = gsap.matchMedia();

      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const anchors = Array.from(stage.querySelectorAll<HTMLElement>('[data-node]'));
        const links = Array.from(stage.querySelectorAll<SVGLineElement>('[data-link]'));
        const pulses = Array.from(stage.querySelectorAll<SVGLineElement>('[data-pulse]'));

        // Entrada: la ventana se levanta, las líneas se dibujan y todo "aterriza" con rebote.
        gsap.set(win, { transformPerspective: 1400, autoAlpha: 1 });
        const intro = gsap.timeline({ delay: 0.35, defaults: { ease: 'expo.out' } });
        intro
          .from(win, { y: 90, rotationX: 28, scale: 0.86, autoAlpha: 0, duration: 1.8 })
          .from(q('[data-hub]'), { scale: 0, rotation: -45, duration: 1.4, ease: 'elastic.out(1, 0.55)' }, 0.5)
          .from(q('[data-ring-orbit]'), { scale: 0.4, autoAlpha: 0, transformOrigin: '50% 50%', duration: 1.6, stagger: 0.1 }, 0.55)
          .from(links, { drawSVG: '0%', duration: 1, stagger: 0.1, ease: 'power2.inOut', clearProps: 'strokeDasharray,strokeDashoffset' }, 0.8)
          .from(q('[data-node] > *'), { scale: 0, autoAlpha: 0, duration: 1, stagger: 0.1, ease: 'back.out(2.2)' }, 1)
          .from(pulses, { autoAlpha: 0, duration: 0.6, stagger: 0.1 }, 1.6);

        // Órbita continua. Los nodos se mueven con transform (x/y en px, sin recalcular el diseño
        // de la página) y las líneas con atributos del SVG. Solo corre mientras se ve el hero.
        const layer = stage.querySelector<HTMLElement>('[data-orbit-layer]');
        let size = layer?.offsetWidth ?? 0;
        const ro = new ResizeObserver(() => {
          size = layer?.offsetWidth ?? 0;
        });
        if (layer) ro.observe(layer);
        gsap.set(anchors, { left: 0, top: 0, xPercent: -50, yPercent: -50 });
        const setX = anchors.map((a) => gsap.quickSetter(a, 'x', 'px'));
        const setY = anchors.map((a) => gsap.quickSetter(a, 'y', 'px'));

        let visible = true;
        const watch = ScrollTrigger.create({
          trigger: stage,
          start: 'top bottom',
          end: 'bottom top',
          onToggle: (self) => {
            visible = self.isActive;
          },
        });

        const pull = { x: 0, y: 0 };
        const pullX = gsap.quickTo(pull, 'x', { duration: 1.4, ease: 'power3.out' });
        const pullY = gsap.quickTo(pull, 'y', { duration: 1.4, ease: 'power3.out' });
        let elapsed = 0;
        const tick = (_time: number, deltaMs: number) => {
          if (!visible) return;
          elapsed += Math.min(deltaMs, 50) / 1000;
          const turn = (elapsed / LAP) * 360;
          NODES.forEach((n, i) => {
            const wobble = Math.sin(elapsed * 0.9 + i * 1.7) * 1.4;
            const p = pointAt(n.angle + turn);
            const x = p.x + wobble + pull.x * (0.6 + i * 0.15);
            const y = p.y - wobble * 0.6 + pull.y * (0.6 + i * 0.15);
            setX[i]?.((x / 100) * size);
            setY[i]?.((y / 100) * size);
            links[i]?.setAttribute('x2', String(x));
            links[i]?.setAttribute('y2', String(y));
            const pulse = pulses[i];
            if (pulse) {
              // Pares: del núcleo hacia el área; impares: del área hacia el núcleo.
              pulse.setAttribute(i % 2 === 0 ? 'x2' : 'x1', String(x));
              pulse.setAttribute(i % 2 === 0 ? 'y2' : 'y1', String(y));
            }
          });
        };
        gsap.ticker.add(tick);

        // Inclinación 3D + reflejo + atracción de los nodos hacia el cursor.
        const rotX = gsap.quickTo(win, 'rotationX', { duration: 0.9, ease: 'power3.out' });
        const rotY = gsap.quickTo(win, 'rotationY', { duration: 0.9, ease: 'power3.out' });
        const hubX = gsap.quickTo(q('[data-hub]'), 'x', { duration: 1, ease: 'power3.out' });
        const hubY = gsap.quickTo(q('[data-hub]'), 'y', { duration: 1, ease: 'power3.out' });
        const onMove = (e: PointerEvent) => {
          if (e.pointerType !== 'mouse') return;
          const r = stage.getBoundingClientRect();
          const px = (e.clientX - r.left) / r.width - 0.5;
          const py = (e.clientY - r.top) / r.height - 0.5;
          rotY(px * 2 * MAX_TILT);
          rotX(-py * 2 * MAX_TILT);
          hubX(px * 14);
          hubY(py * 14);
          pullX(px * 6);
          pullY(py * 6);
          win.style.setProperty('--gx', `${((px + 0.5) * 100).toFixed(1)}%`);
          win.style.setProperty('--gy', `${((py + 0.5) * 100).toFixed(1)}%`);
        };
        const onLeave = () => {
          rotX(0);
          rotY(0);
          hubX(0);
          hubY(0);
          pullX(0);
          pullY(0);
        };
        stage.addEventListener('pointermove', onMove);
        stage.addEventListener('pointerleave', onLeave);

        return () => {
          gsap.ticker.remove(tick);
          ro.disconnect();
          watch.kill();
          stage.removeEventListener('pointermove', onMove);
          stage.removeEventListener('pointerleave', onLeave);
        };
      });
    },
    { scope: stageRef }
  );

  return (
    <div ref={stageRef} className={styles.stage}>
      <div ref={windowRef} className={styles.window}>
        <div className={styles.titlebar} aria-hidden>
          <span className={`${styles.light} ${styles.lightRed}`} />
          <span className={`${styles.light} ${styles.lightYellow}`} />
          <span className={`${styles.light} ${styles.lightGreen}`} />
          <span className={styles.titlebarText}>SynerLink</span>
        </div>

        <div
          className={styles.orbit}
          role='img'
          aria-label='SynerLink conecta Recursos Humanos, Finanzas, Servicios de TI y Compras'
        >
          <div className={styles.orbitLayer} data-orbit-layer>
            <svg className={styles.orbitSvg} viewBox='0 0 100 100' aria-hidden>
              <defs>
                <linearGradient id='synerlink-line' x1='0' y1='0' x2='1' y2='1'>
                  <stop offset='0%' stopColor='#3db6e0' />
                  <stop offset='100%' stopColor='#113562' />
                </linearGradient>
              </defs>
              <ellipse data-ring-orbit className={styles.ring} cx='50' cy='50' rx={RX} ry={RY} vectorEffect='non-scaling-stroke' />
              <ellipse data-ring-orbit className={styles.ring} cx='50' cy='50' rx={RX + 12} ry={RY + 12} vectorEffect='non-scaling-stroke' />
              {NODES.map((n, i) => {
                const p = pointAt(n.angle);
                const out = i % 2 === 0;
                return (
                  <g key={n.label}>
                    <line data-link className={styles.link} x1='50' y1='50' x2={p.x} y2={p.y} />
                    <line
                      data-pulse
                      className={styles.pulse}
                      x1={out ? 50 : p.x}
                      y1={out ? 50 : p.y}
                      x2={out ? p.x : 50}
                      y2={out ? p.y : 50}
                      pathLength={100}
                      vectorEffect='non-scaling-stroke'
                      style={{ animationDelay: `${i * -0.8}s` }}
                    />
                  </g>
                );
              })}
            </svg>

            {NODES.map((n) => {
              const Icon = n.icon;
              const p = pointAt(n.angle);
              return (
                <div key={n.label} data-node className={styles.nodeAnchor} style={{ left: `${p.x}%`, top: `${p.y}%` }}>
                  <div className={styles.node}>
                    <span className={styles.nodeIcon}>
                      <Icon size={16} stroke={2} />
                    </span>
                    {n.label}
                  </div>
                </div>
              );
            })}
          </div>

          <div className={styles.hub}>
            <div data-hub className={styles.hubInner}>
              <span className={styles.hubRing} />
              <span className={styles.hubRing} />
              <span className={styles.hubRing} />
              <div className={styles.hubCore}>
                <span className={styles.hubLetters}>SL</span>
                <span className={styles.hubName}>SynerLink</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
