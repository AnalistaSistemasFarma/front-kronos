'use client';

import { useEffect, useState } from 'react';
import PantallaActualizacion from '../components/errors/PantallaActualizacion';
import { isChunkLoadError, recargarUnaVez } from '../lib/chunk-recovery';

// Reemplaza el layout raíz cuando falla algo que error.tsx no alcanza a atrapar.
// Antes mostraba <NextError statusCode={0} /> ("Application error: a client-side
// exception has occurred"); ahora, la pantalla amable de SynerLink.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const esActualizacion = isChunkLoadError(error);
  const [recargando, setRecargando] = useState(false);

  useEffect(() => {
    if (esActualizacion) {
      // Chunk viejo tras un despliegue: no es un fallo de la app. Recargamos una
      // vez; si ya se recargó hace poco, mostramos la pantalla con "Recargar".
      if (recargarUnaVez()) {
        setRecargando(true);
        return;
      }
    }
    // Sentry solo en producción; en dev no se empaqueta (ver instrumentation-client.ts).
    if (process.env.NODE_ENV === 'production') {
      void import('@sentry/nextjs').then((Sentry) => Sentry.captureException(error));
    }
  }, [error, esActualizacion]);

  return (
    <html lang='es'>
      <body style={{ margin: 0 }}>
        <PantallaActualizacion recargando={recargando} esActualizacion={esActualizacion} />
      </body>
    </html>
  );
}
