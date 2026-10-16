'use client';

import { Toaster, resolveValue, type Toast } from 'react-hot-toast';
import { ClosureNotificationToast, type NotificationToastVariant } from './ClosureNotificationToast';

const DEFAULT_DURATION: Record<string, number> = { success: 4000, error: 6000, blank: 4500 };

function variantOf(t: Toast): NotificationToastVariant {
  if (t.type === 'error') return 'error';
  if (t.type === 'loading') return 'loading';
  if (t.type === 'blank') return 'info';
  return 'success';
}

/**
 * Toaster de la app: toast.success / error / loading / toast() se ven con la misma tarjeta que
 * el popup de cierre de solicitud; toast.custom dibuja su propio contenido.
 */
export default function AppToaster() {
  return (
    <Toaster
      position='top-right'
      gutter={12}
      toastOptions={{
        success: { duration: DEFAULT_DURATION.success },
        error: { duration: DEFAULT_DURATION.error },
        blank: { duration: DEFAULT_DURATION.blank },
      }}
    >
      {(t) =>
        t.type === 'custom' ? (
          <>{resolveValue(t.message, t)}</>
        ) : (
          <ClosureNotificationToast
            t={t}
            message={resolveValue(t.message, t)}
            duration={t.duration ?? DEFAULT_DURATION[t.type] ?? 4000}
            variant={variantOf(t)}
          />
        )
      }
    </Toaster>
  );
}
