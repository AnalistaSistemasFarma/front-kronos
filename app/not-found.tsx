import type { Metadata } from 'next';
import Link from 'next/link';
import { IconHome } from '@tabler/icons-react';
import BackButton from '../components/not-found/BackButton';
import styles from '../components/not-found/notFound.module.css';

export const metadata: Metadata = {
  title: 'Página no encontrada · SynerLink',
  robots: { index: false },
};

/** 404 de toda la app (reemplaza "This page could not be found." de Next.js). */
export default function NotFound() {
  return (
    <div className={styles.page}>
      <div className={styles.bg} aria-hidden>
        <span className={`${styles.blob} ${styles.blobA}`} />
        <span className={`${styles.blob} ${styles.blobB}`} />
        <span className={styles.dots} />
      </div>

      <main className={styles.card}>
        <div className={styles.titlebar} aria-hidden>
          <span className={`${styles.light} ${styles.red}`} />
          <span className={`${styles.light} ${styles.yellow}`} />
          <span className={`${styles.light} ${styles.green}`} />
          <span className={styles.titlebarText}>SynerLink</span>
        </div>

        <div className={styles.body}>
          <div className={styles.orbitBox} aria-hidden>
            <div className={styles.orbit}>
              <span className={styles.sat} />
              <span className={styles.sat} />
              <span className={styles.sat} />
              <span className={styles.lost} />
            </div>
            <div className={`${styles.orbit} ${styles.orbitInner}`}>
              <span className={styles.sat} />
              <span className={styles.sat} />
            </div>
            <div className={styles.core}>SL</div>
          </div>

          <p className={styles.code} aria-hidden>
            404
          </p>
          <h1 className={styles.title}>No encontramos esta página</h1>
          <p className={styles.text}>
            Puede que la dirección esté mal escrita o que la página se haya movido. Revisa el enlace o vuelve al
            inicio.
          </p>

          <div className={styles.actions}>
            <Link href='/' className={`${styles.btn} ${styles.primary}`}>
              <IconHome size={18} />
              Ir al inicio
            </Link>
            <BackButton />
          </div>
        </div>

        <div className={styles.foot}>Group Shared Services Latinoamérica</div>
      </main>
    </div>
  );
}
