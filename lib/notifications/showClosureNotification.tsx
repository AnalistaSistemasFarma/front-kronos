import toast from 'react-hot-toast';
import { ClosureNotificationToast } from '../../components/ui/ClosureNotificationToast';

export type ClosureEntityType = 'request' | 'ticket' | 'activity';

export interface ClosureNotificationOptions {
  type?: ClosureEntityType;
  id?: number | string;
  subject?: string;
  status?: 'resolved' | 'cancelled';
}

const CLOSURE_TOAST_DURATION = 5500;

const COPY: Record<
  ClosureEntityType,
  Record<'resolved' | 'cancelled', { title: string; message: (ref: string, subject?: string) => string }>
> = {
  request: {
    resolved: {
      title: '¡Solicitud cerrada!',
      message: (ref, subject) =>
        subject
          ? `La solicitud ${ref} «${subject}» fue resuelta correctamente.`
          : `La solicitud ${ref} fue resuelta correctamente.`,
    },
    cancelled: {
      title: 'Solicitud cancelada',
      message: (ref, subject) =>
        subject
          ? `La solicitud ${ref} «${subject}» fue cancelada.`
          : `La solicitud ${ref} fue cancelada.`,
    },
  },
  ticket: {
    resolved: {
      title: '¡Caso resuelto!',
      message: (ref, subject) =>
        subject
          ? `El caso ${ref} «${subject}» fue cerrado exitosamente.`
          : `El caso ${ref} fue cerrado exitosamente.`,
    },
    cancelled: {
      title: 'Caso cancelado',
      message: (ref, subject) =>
        subject
          ? `El caso ${ref} «${subject}» fue cancelado.`
          : `El caso ${ref} fue cancelado.`,
    },
  },
  activity: {
    resolved: {
      title: '¡Actividad completada!',
      message: (ref, subject) =>
        subject
          ? `La actividad ${ref} «${subject}» fue marcada como resuelta.`
          : `La actividad ${ref} fue marcada como resuelta.`,
    },
    cancelled: {
      title: 'Actividad cancelada',
      message: (ref, subject) =>
        subject
          ? `La actividad ${ref} «${subject}» fue cancelada.`
          : `La actividad ${ref} fue cancelada.`,
    },
  },
};

function formatRef(id?: number | string) {
  if (id === undefined || id === null || id === '') return '';
  return `#${id}`;
}

export function showClosureNotification({
  type = 'request',
  id,
  subject,
  status = 'resolved',
}: ClosureNotificationOptions) {
  const ref = formatRef(id);
  const copy = COPY[type][status];
  const title = copy.title;
  const message = copy.message(ref, subject?.trim() || undefined);

  toast.custom(
    (t) => (
      <ClosureNotificationToast
        t={t}
        title={title}
        message={message}
        duration={CLOSURE_TOAST_DURATION}
      />
    ),
    {
      duration: CLOSURE_TOAST_DURATION,
      position: 'top-right',
    }
  );
}

export function isClosedStatusId(statusId: number) {
  return statusId === 2 || statusId === 3;
}
