import type * as SentryModule from '@sentry/nextjs';
import { sentryBaseOptions } from './lib/sentry';

// Sentry solo se carga en producción. La condición va escrita en línea para que el
// compilador la resuelva y en `next dev` ni siquiera empaquete @sentry/nextjs.
const Sentry: typeof SentryModule | null =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  process.env.NODE_ENV === 'production' ? require('@sentry/nextjs') : null;

Sentry?.init(sentryBaseOptions);

export const onRouterTransitionStart: typeof SentryModule.captureRouterTransitionStart = (...args) =>
  Sentry?.captureRouterTransitionStart(...args);
