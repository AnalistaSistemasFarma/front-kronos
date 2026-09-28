import type { Instrumentation } from 'next';

// Sentry solo se habilita en producción (lib/sentry.ts): en `next dev` ni se carga.
const sentryActive = process.env.NODE_ENV === 'production';

export async function register() {
  if (!sentryActive) return;
  if (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === 'edge') {
    const [Sentry, { sentryBaseOptions }] = await Promise.all([
      import('@sentry/nextjs'),
      import('./lib/sentry'),
    ]);
    Sentry.init(sentryBaseOptions);
  }
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!sentryActive) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(...args);
};
