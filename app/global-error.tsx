'use client';

import ErrorFallback from '../components/chunk-recovery/ErrorFallback';

// En lugar del "Application error" crudo de Next mostramos la pantalla de SynerLink.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang='es'>
      <body style={{ margin: 0 }}>
        <ErrorFallback error={error} />
      </body>
    </html>
  );
}
