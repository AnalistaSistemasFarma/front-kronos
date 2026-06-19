'use client';

import toast from 'react-hot-toast';
import type { Toast } from 'react-hot-toast';
import { IconCircleCheck, IconX } from '@tabler/icons-react';

interface ClosureNotificationToastProps {
  t: Toast;
  title: string;
  message: string;
  duration?: number;
}

export function ClosureNotificationToast({
  t,
  title,
  message,
  duration = 5500,
}: ClosureNotificationToastProps) {
  return (
    <div
      role='status'
      aria-live='polite'
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
          style={{ background: 'rgba(255, 255, 255, 0.08)' }}
        >
          <IconCircleCheck size={20} stroke={1.75} color='#f3f4f6' />
        </div>

        <div className='min-w-0 flex-1 pt-0.5'>
          <p className='text-[15px] font-semibold leading-snug text-white'>{title}</p>
          <p className='mt-1 text-sm leading-relaxed text-gray-300'>{message}</p>
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

      <div className='h-[3px]' style={{ background: 'rgba(255, 255, 255, 0.12)' }}>
        <div
          className='closure-toast-progress h-full bg-white/70'
          style={{ animationDuration: `${duration}ms` }}
        />
      </div>
    </div>
  );
}
