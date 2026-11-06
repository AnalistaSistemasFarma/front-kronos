import type { Instrumentation } from 'next';

export async function register() {
  // Sentry solo en producción (lib/sentry.ts). La condición va en línea (no en una constante)
  // para que el compilador la resuelva y en `next dev` ni empaquete @sentry/nextjs.
  if (process.env.NODE_ENV === 'production' && (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === 'edge')) {
    const [Sentry, { sentryBaseOptions }] = await Promise.all([
      import('@sentry/nextjs'),
      import('./lib/sentry'),
    ]);
    Sentry.init(sentryBaseOptions);
  }

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startScheduler } = await import('./lib/scheduler/startScheduler.js');
    startScheduler();

    // Monitor del sistema (CPU, memoria, peticiones, SQL). Por defecto solo en producción.
    const { startSystemMetrics } = await import('./lib/system-metrics/collector');
    startSystemMetrics();
  }
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (process.env.NODE_ENV !== 'production') return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(...args);
};
