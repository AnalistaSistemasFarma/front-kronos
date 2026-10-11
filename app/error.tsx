'use client';

import ErrorFallback from '../components/chunk-recovery/ErrorFallback';

export default function Error({ error }: { error: Error & { digest?: string } }) {
  return <ErrorFallback error={error} />;
}
