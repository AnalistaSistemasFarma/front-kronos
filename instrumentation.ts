import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === 'edge') {
    const { sentryBaseOptions } = await import('./lib/sentry');
    Sentry.init(sentryBaseOptions);
  }
}

export const onRequestError = Sentry.captureRequestError;
