'use client';

import type { PointerEvent } from 'react';
import gsap from 'gsap';
import {
  IconBuilding,
  IconCalculator,
  IconCash,
  IconCreditCard,
  IconDeviceLaptop,
  IconReportAnalytics,
  IconScale,
  IconTool,
  IconUsers,
} from '@tabler/icons-react';
import styles from './landing.module.css';

const SERVICES = [
  {
    title: 'GSS',
    description: 'Casa matriz que opera los servicios compartidos para las empresas del grupo.',
    icon: IconBuilding,
    tint: 'linear-gradient(140deg, #5ac8fa, #113562)',
  },
  {
    title: 'Finanzas y reporte',
    description: 'Informes financieros y seguimiento de los resultados del negocio.',
    icon: IconReportAnalytics,
    tint: 'linear-gradient(140deg, #3db6e0, #1c5a94)',
  },
  {
    title: 'Contabilidad',
    description: 'Registro contable, cierres y cumplimiento de la información financiera.',
    icon: IconCalculator,
    tint: 'linear-gradient(140deg, #2a8fc6, #0b2442)',
  },
  {
    title: 'Capital de trabajo',
    description: 'Programación de pagos, flujo de caja y disponibilidad de recursos.',
    icon: IconCash,
    tint: 'linear-gradient(140deg, #7dd3f0, #113562)',
  },
  {
    title: 'Crédito y cartera',
    description: 'Gestión de crédito, cobro y seguimiento de la cartera de clientes.',
    icon: IconCreditCard,
    tint: 'linear-gradient(140deg, #5ac8fa, #1c5a94)',
  },
  {
    title: 'Talento humano',
    description: 'Gestión de las personas, desde el ingreso hasta su desarrollo.',
    icon: IconUsers,
    tint: 'linear-gradient(140deg, #3db6e0, #0b2442)',
  },
  {
    title: 'Jurídico',
    description: 'Acompañamiento en contratos, documentos y actuaciones del grupo.',
    icon: IconScale,
    tint: 'linear-gradient(140deg, #2a8fc6, #113562)',
  },
  {
    title: 'Tecnología',
    description: 'Plataformas, soporte e infraestructura para la operación diaria.',
    icon: IconDeviceLaptop,
    tint: 'linear-gradient(140deg, #7dd3f0, #1c5a94)',
  },
  {
    title: 'Técnica',
    description: 'Soporte de equipos, activos y la operación técnica del día a día.',
    icon: IconTool,
    tint: 'linear-gradient(140deg, #5ac8fa, #0b2442)',
  },
];

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** La luz sigue al cursor y la tarjeta se inclina hacia él. */
function onPointerMove(e: PointerEvent<HTMLElement>) {
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  el.style.setProperty('--mx', `${x}px`);
  el.style.setProperty('--my', `${y}px`);
  if (e.pointerType !== 'mouse' || prefersReducedMotion()) return;
  gsap.to(el, {
    rotationY: (x / rect.width - 0.5) * 14,
    rotationX: -(y / rect.height - 0.5) * 14,
    y: -8,
    transformPerspective: 900,
    duration: 0.6,
    ease: 'power3.out',
    overwrite: 'auto',
  });
  gsap.to(el.querySelector('[data-card-icon]'), {
    x: (x / rect.width - 0.5) * 16,
    y: (y / rect.height - 0.5) * 16,
    duration: 0.6,
    ease: 'power3.out',
    overwrite: 'auto',
  });
}

function onPointerLeave(e: PointerEvent<HTMLElement>) {
  const el = e.currentTarget;
  gsap.to(el, { rotationX: 0, rotationY: 0, y: 0, duration: 1.1, ease: 'elastic.out(1, 0.5)', overwrite: 'auto' });
  gsap.to(el.querySelector('[data-card-icon]'), { x: 0, y: 0, duration: 1.1, ease: 'elastic.out(1, 0.5)', overwrite: 'auto' });
}

export default function ServiceCards() {
  return (
    <div className={styles.services}>
      {SERVICES.map((s) => {
        const Icon = s.icon;
        return (
          <div key={s.title} data-card>
            <article className={styles.card} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
              <span data-card-icon className={styles.cardIcon} style={{ background: s.tint }}>
                <Icon size={26} stroke={1.8} />
              </span>
              <h3 className={styles.cardTitle}>{s.title}</h3>
              <p className={styles.cardText}>{s.description}</p>
            </article>
          </div>
        );
      })}
    </div>
  );
}
