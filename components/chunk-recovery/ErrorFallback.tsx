'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect, useState } from 'react';
import { isChunkLoadError, tryAutoReload } from '../../lib/chunk-recovery/chunkError';
import UpdatedScreen from './UpdatedScreen';

/** Contenido común de app/error.tsx y app/global-error.tsx. */
export default function ErrorFallback({ error }: { error: Error & { digest?: string } }) {
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (!isChunkLoadError(error)) Sentry.captureException(error);
    if (tryAutoReload(error)) setReloading(true);
  }, [error]);

  return (
    <UpdatedScreen
      reloading={reloading}
      onReload={() => {
        setReloading(true);
        window.location.reload();
      }}
    />
  );
}
