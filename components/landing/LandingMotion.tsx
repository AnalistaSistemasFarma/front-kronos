'use client';

import { useRef, type ReactNode } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
import { useGSAP } from '@gsap/react';
import styles from './landing.module.css';

// Los plugins se registran dentro del efecto (después de hidratar): ScrollTrigger toca el estilo
// del <body> al iniciar y, si lo hace antes, React marca una diferencia de hidratación.

/**
 * Coreografía de la landing con GSAP. Las piezas se marcan con atributos `data-*` en la página
 * (que sigue siendo de servidor) y aquí se animan:
 * - data-hero / data-hero-title / data-hero-text / data-hero-actions: entrada del hero.
 * - data-split: títulos que se revelan palabra por palabra al entrar en pantalla.
 * - data-fade: aparece subiendo. data-card / data-benefit / data-stat: entradas en grupo.
 * - data-bv*: el panel de beneficios se arma pieza por pieza. data-cta: la tarjeta crece al llegar.
 * - data-magnetic: botones que siguen un poco al cursor.
 * Con "reducir movimiento" activado no se anima nada y todo queda visible.
 */
export default function LandingMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement | null>(null);

  useGSAP(
    () => {
      gsap.registerPlugin(ScrollTrigger, SplitText, DrawSVGPlugin);
      const mm = gsap.matchMedia();

      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const q = gsap.utils.selector(root);

        // Barra de progreso de lectura.
        gsap.to(q('[data-progress]'), {
          scaleX: 1,
          ease: 'none',
          scrollTrigger: { start: 0, end: 'max', scrub: 0.4 },
        });

        // ───── Hero: entrada ─────
        const title = q('[data-hero-title]')[0];
        const text = q('[data-hero-text]')[0];
        const intro = gsap.timeline({ defaults: { ease: 'expo.out' } });
        gsap.set(q('[data-hero]'), { autoAlpha: 1 });

        intro.from(q('[data-hero-eyebrow]'), { y: 24, autoAlpha: 0, scale: 0.9, duration: 1 }, 0.1);
        if (title) {
          SplitText.create(title, {
            type: 'lines,words',
            mask: 'lines',
            linesClass: 'll',
            wordsClass: 'lw',
            onSplit: (self) =>
              intro.from(
                self.words,
                { yPercent: 115, rotate: 6, transformOrigin: '0% 100%', duration: 1.4, stagger: 0.07 },
                0.2
              ),
          });
        }
        if (text) {
          SplitText.create(text, {
            type: 'lines',
            mask: 'lines',
            linesClass: 'll',
            onSplit: (self) =>
              intro.from(self.lines, { yPercent: 100, duration: 1.2, stagger: 0.08 }, 0.65),
          });
        }
        // Se anima el contenedor: los botones tienen su propio efecto magnético (x/y) y chocarían.
        intro.from(
          q('[data-hero-actions]'),
          { y: 30, autoAlpha: 0, scale: 0.94, duration: 1.2, ease: 'back.out(1.8)' },
          0.9
        );

        // ───── Hero: profundidad al hacer scroll ─────
        const hero = q('[data-hero-section]')[0] as HTMLElement | undefined;
        if (hero) {
          const st = { trigger: hero, start: 'top top', end: 'bottom top', scrub: true };
          gsap.to(q('[data-hero-copy]'), { yPercent: -18, autoAlpha: 0.2, ease: 'none', scrollTrigger: st });
          gsap.to(q('[data-hero-visual]'), { yPercent: -8, scale: 0.94, ease: 'none', scrollTrigger: st });
          q('[data-depth]').forEach((el) => {
            const depth = Number((el as HTMLElement).dataset.depth) || 1;
            gsap.to(el, { yPercent: 30 * depth, ease: 'none', scrollTrigger: st });
          });

          // Luz que sigue al cursor dentro del hero.
          const glow = q('[data-hero-glow]')[0];
          if (glow) {
            const gx = gsap.quickTo(glow, 'x', { duration: 1.2, ease: 'power3.out' });
            const gy = gsap.quickTo(glow, 'y', { duration: 1.2, ease: 'power3.out' });
            const onMove = (e: PointerEvent) => {
              const r = hero.getBoundingClientRect();
              gx(e.clientX - r.left);
              gy(e.clientY - r.top);
            };
            hero.addEventListener('pointermove', onMove);
            return () => hero.removeEventListener('pointermove', onMove);
          }
        }
      });

      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const q = gsap.utils.selector(root);

        // ───── Títulos de sección: palabra por palabra ─────
        q('[data-split]').forEach((el) => {
          SplitText.create(el, {
            type: 'lines,words',
            mask: 'lines',
            linesClass: 'll',
            wordsClass: 'lw',
            autoSplit: true,
            onSplit: (self) =>
              gsap.from(self.words, {
                yPercent: 110,
                rotate: 5,
                transformOrigin: '0% 100%',
                duration: 1.3,
                ease: 'expo.out',
                stagger: 0.06,
                scrollTrigger: { trigger: el, start: 'top 88%' },
              }),
          });
        });

        // ───── Apariciones genéricas ─────
        gsap.set(q('[data-fade]'), { autoAlpha: 0, y: 40 });
        ScrollTrigger.batch(q('[data-fade]'), {
          start: 'top 90%',
          once: true,
          onEnter: (els) =>
            gsap.to(els, { autoAlpha: 1, y: 0, duration: 1.2, ease: 'expo.out', stagger: 0.1 }),
        });

        // ───── Empresas: el mosaico se arma desde la casa matriz hacia afuera ─────
        const companies = q('[data-company]');
        if (companies.length) {
          gsap.from(companies, {
            y: 70,
            scale: 0.9,
            autoAlpha: 0,
            duration: 1.3,
            ease: 'expo.out',
            stagger: { each: 0.09, from: 'start' },
            scrollTrigger: { trigger: companies[0], start: 'top 85%' },
          });
        }

        // ───── Tarjetas de servicios: caen en 3D ─────
        const cards = q('[data-card]');
        if (cards.length) {
          gsap.from(cards, {
            y: 110,
            rotationX: -50,
            transformPerspective: 1100,
            transformOrigin: '50% 0%',
            autoAlpha: 0,
            duration: 1.6,
            ease: 'expo.out',
            stagger: 0.12,
            scrollTrigger: { trigger: cards[0], start: 'top 88%' },
          });
        }

        // ───── Beneficios ─────
        const benefits = q('[data-benefit]');
        if (benefits.length) {
          const tl = gsap.timeline({ scrollTrigger: { trigger: benefits[0], start: 'top 85%' } });
          // clearProps: al terminar, el efecto hover de CSS (desplazarse) vuelve a funcionar.
          tl.from(benefits, {
            x: -60,
            autoAlpha: 0,
            duration: 1.1,
            ease: 'expo.out',
            stagger: 0.08,
            clearProps: 'transform',
          });
          tl.from(
            q('[data-benefit] [data-check]'),
            { scale: 0, rotate: -120, duration: 0.8, ease: 'back.out(2.5)', stagger: 0.08 },
            0.15
          );
        }

        // ───── Panel de beneficios: se arma pieza por pieza ─────
        const bv = q('[data-bv]')[0];
        if (bv) {
          const tl = gsap.timeline({
            defaults: { ease: 'expo.out' },
            scrollTrigger: { trigger: bv, start: 'top 80%' },
          });
          tl.from(bv, { y: 60, rotationX: 18, transformPerspective: 1200, autoAlpha: 0, duration: 1.4 })
            .from(q('[data-bv-panel]'), { y: 30, autoAlpha: 0, duration: 1, stagger: 0.12 }, 0.25)
            .from(
              q('[data-bv-bar]'),
              { scaleY: 0, transformOrigin: '50% 100%', duration: 0.9, stagger: 0.06, ease: 'power3.out' },
              0.5
            )
            .from(q('[data-bv-ring]'), { strokeDashoffset: 100, duration: 1.6, ease: 'power2.inOut' }, 0.55)
            .from(q('[data-bv-line]'), { drawSVG: '0%', duration: 1.5, ease: 'power2.inOut' }, 0.65)
            .from(q('[data-bv-area]'), { autoAlpha: 0, duration: 1 }, 1.3)
            .from(
              q('[data-bv-badge]'),
              { scale: 0.6, autoAlpha: 0, duration: 0.8, stagger: 0.1, ease: 'back.out(2.2)' },
              1.1
            )
            .from(q('[data-bv-float]'), { y: 30, scale: 0.8, autoAlpha: 0, duration: 1, ease: 'back.out(2)' }, 1.3);

          // Profundidad al hacer scroll: el panel y la etiqueta flotante se desplazan distinto.
          const st = { trigger: bv, start: 'top bottom', end: 'bottom top', scrub: 1 };
          gsap.fromTo(q('[data-bv-float]'), { yPercent: 40 }, { yPercent: -60, ease: 'none', scrollTrigger: st });
        }

        // ───── Cifras ─────
        const stats = q('[data-stat]');
        if (stats.length) {
          gsap.from(stats, {
            y: 80,
            scale: 0.88,
            autoAlpha: 0,
            duration: 1.3,
            ease: 'expo.out',
            stagger: 0.12,
            scrollTrigger: { trigger: stats[0], start: 'top 88%' },
          });
        }

        // ───── Llamado a la acción: crece y se redondea al llegar ─────
        const cta = q('[data-cta]')[0];
        if (cta) {
          gsap.fromTo(
            cta,
            { scale: 0.86, borderRadius: 90, yPercent: 8 },
            {
              scale: 1,
              borderRadius: 36,
              yPercent: 0,
              ease: 'none',
              scrollTrigger: { trigger: cta, start: 'top bottom', end: 'center 60%', scrub: 1 },
            }
          );
        }

        // ───── Botones magnéticos ─────
        const cleanups: Array<() => void> = [];
        q('[data-magnetic]').forEach((el) => {
          const btn = el as HTMLElement;
          const mx = gsap.quickTo(btn, 'x', { duration: 0.6, ease: 'power3.out' });
          const my = gsap.quickTo(btn, 'y', { duration: 0.6, ease: 'power3.out' });
          const onMove = (e: PointerEvent) => {
            if (e.pointerType !== 'mouse') return;
            const r = btn.getBoundingClientRect();
            mx((e.clientX - (r.left + r.width / 2)) * 0.3);
            my((e.clientY - (r.top + r.height / 2)) * 0.4);
          };
          const onLeave = () => gsap.to(btn, { x: 0, y: 0, duration: 1, ease: 'elastic.out(1, 0.4)' });
          btn.addEventListener('pointermove', onMove);
          btn.addEventListener('pointerleave', onLeave);
          cleanups.push(() => {
            btn.removeEventListener('pointermove', onMove);
            btn.removeEventListener('pointerleave', onLeave);
          });
        });
        return () => cleanups.forEach((fn) => fn());
      });
    },
    { scope: root }
  );

  return (
    <div ref={root} className={styles.page}>
      <div data-progress className={styles.progress} aria-hidden />
      {children}
    </div>
  );
}
