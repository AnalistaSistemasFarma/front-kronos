'use client';

import { IconArrowLeft } from '@tabler/icons-react';
import styles from './notFound.module.css';

/** "Volver atrás": regresa a la página anterior o, si se llegó directo, al inicio. */
export default function BackButton() {
  const goBack = () => {
    if (window.history.length > 1) window.history.back();
    else window.location.href = '/';
  };

  return (
    <button type='button' className={`${styles.btn} ${styles.secondary}`} onClick={goBack}>
      <IconArrowLeft size={18} />
      Volver atrás
    </button>
  );
}
