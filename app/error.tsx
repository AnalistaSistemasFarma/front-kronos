'use client';

import { useEffect, useState } from 'react';
import PantallaActualizacion from '../components/errors/PantallaActualizacion';
import { isChunkLoadError, recargarUnaVez } from '../lib/chunk-recovery';

// Límite de error de todas las rutas (dentro del layout raíz). Ver global-error.tsx.
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
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

  return <PantallaActualizacion recargando={recargando} esActualizacion={esActualizacion} onReintentar={reset} />;
}
