import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === 'edge') {
    const { sentryBaseOptions } = await import('./lib/sentry');
    Sentry.init(sentryBaseOptions);
  }

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startScheduler } = await import('./lib/scheduler/startScheduler.js');
    startScheduler();
  }
}

export const onRequestError = Sentry.captureRequestError;
