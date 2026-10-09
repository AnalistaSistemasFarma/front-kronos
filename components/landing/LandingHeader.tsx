'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader } from '@mantine/core';
import { IconArrowRight } from '@tabler/icons-react';
import styles from './landing.module.css';

const NAV = [
  { href: '#services', label: 'Servicios' },
  { href: '#benefits', label: 'Beneficios' },
  { href: '#about', label: 'Nosotros' },
  { href: '#contact', label: 'Contacto' },
];

/** Barra flotante: transparente arriba y "vidrio" de macOS al bajar. */
export default function LandingHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [goingToLogin, setGoingToLogin] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    // Al volver con "Atrás" (página restaurada de caché) el botón no debe quedar en "Cargando…".
    const onPageShow = () => setGoingToLogin(false);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  return (
    <div className={styles.headerWrap}>
      <header className={`${styles.header} ${scrolled ? styles.headerScrolled : ''}`}>
        <Link href='/' aria-label='Inicio'>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src='/Logo_Principal.svg' alt='ServiciosCompartidos Logo' className={styles.logo} />
        </Link>

        <nav className={styles.nav} aria-label='Secciones'>
          {NAV.map((item) => (
            <a key={item.href} href={item.href} className={styles.navLink}>
              {item.label}
            </a>
          ))}
        </nav>

        {/* Muestra que está cargando: si el login tarda (p. ej. compilando en local) el clic
            no parece "muerto". */}
        <Link
          href='/login'
          onClick={(e) => {
            // Ctrl/Cmd/Shift o clic medio abren otra pestaña: esta página no navega.
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            setGoingToLogin(true);
          }}
          aria-busy={goingToLogin}
          className={`${styles.btn} ${styles.btnSmall} ${styles.btnPrimary}`}
        >
          {goingToLogin ? 'Cargando…' : 'Iniciar Sesión'}
          {goingToLogin ? <Loader size={14} color='currentColor' /> : <IconArrowRight size={16} />}
        </Link>
      </header>
    </div>
  );
}
