import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === 'edge') {
    const { sentryBaseOptions } = await import('./lib/sentry');
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

export const onRequestError = Sentry.captureRequestError;
