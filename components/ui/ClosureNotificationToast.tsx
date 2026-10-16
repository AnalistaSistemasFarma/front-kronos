'use client';

import type { ReactNode } from 'react';
import toast from 'react-hot-toast';
import type { Toast } from 'react-hot-toast';
import { IconAlertTriangle, IconCircleCheck, IconInfoCircle, IconLoader2, IconX } from '@tabler/icons-react';

export type NotificationToastVariant = 'success' | 'error' | 'info' | 'loading';

interface ClosureNotificationToastProps {
  t: Toast;
  title?: string;
  message: ReactNode;
  duration?: number;
  variant?: NotificationToastVariant;
}

const ACCENT: Record<NotificationToastVariant, { icon: string; ring: string; bar: string }> = {
  success: { icon: '#f3f4f6', ring: 'rgba(255, 255, 255, 0.08)', bar: 'rgba(255, 255, 255, 0.7)' },
  error: { icon: '#fca5a5', ring: 'rgba(248, 113, 113, 0.16)', bar: 'rgba(248, 113, 113, 0.85)' },
  info: { icon: '#93c5fd', ring: 'rgba(96, 165, 250, 0.16)', bar: 'rgba(147, 197, 253, 0.85)' },
  loading: { icon: '#f3f4f6', ring: 'rgba(255, 255, 255, 0.08)', bar: 'transparent' },
};

/** Popup estándar de SynerLink (arriba a la derecha): tarjeta oscura, ícono, texto y barra de tiempo. */
export function ClosureNotificationToast({
  t,
  title,
  message,
  duration = 5500,
  variant = 'success',
}: ClosureNotificationToastProps) {
  const accent = ACCENT[variant];
  const showProgress = variant !== 'loading' && Number.isFinite(duration) && duration > 0;
  const icon =
    variant === 'loading' ? (
      <IconLoader2 size={20} stroke={1.75} color={accent.icon} className='animate-spin' />
    ) : variant === 'error' ? (
      <IconAlertTriangle size={20} stroke={1.75} color={accent.icon} />
    ) : variant === 'info' ? (
      <IconInfoCircle size={20} stroke={1.75} color={accent.icon} />
    ) : (
      <IconCircleCheck size={20} stroke={1.75} color={accent.icon} />
    );

  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      aria-live={variant === 'error' ? 'assertive' : 'polite'}
      className='pointer-events-auto overflow-hidden rounded-xl shadow-2xl'
      style={{
        minWidth: 320,
        maxWidth: 420,
        background: 'linear-gradient(145deg, #2a2f3a 0%, #1f2430 100%)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        opacity: t.visible ? 1 : 0,
        transform: t.visible ? 'translateY(0) scale(1)' : 'translateY(-8px) scale(0.98)',
        transition: 'opacity 0.35s ease, transform 0.35s ease',
      }}
    >
      <div className='flex items-start gap-3 p-4 pr-3'>
        <div
          className='mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full'
          style={{ background: accent.ring }}
        >
          {icon}
        </div>

        <div className='min-w-0 flex-1 pt-0.5' style={{ overflowWrap: 'anywhere' }}>
          {title ? (
            <>
              <p className='text-[15px] font-semibold leading-snug text-white'>{title}</p>
              <div className='mt-1 text-sm leading-relaxed text-gray-300'>{message}</div>
            </>
          ) : (
            <div className='pt-1.5 text-sm font-medium leading-relaxed text-white'>{message}</div>
          )}
        </div>

        <button
          type='button'
          onClick={() => toast.dismiss(t.id)}
          className='shrink-0 rounded-md p-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white'
          aria-label='Cerrar notificación'
        >
          <IconX size={16} />
        </button>
      </div>

      {showProgress ? (
        <div className='h-[3px]' style={{ background: 'rgba(255, 255, 255, 0.12)' }}>
          <div
            className='closure-toast-progress h-full'
            style={{ animationDuration: `${duration}ms`, background: accent.bar }}
          />
        </div>
      ) : null}
    </div>
  );
}
