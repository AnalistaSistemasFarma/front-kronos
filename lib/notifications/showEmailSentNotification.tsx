import toast from 'react-hot-toast';
import { ClosureNotificationToast } from '../../components/ui/ClosureNotificationToast';

const EMAIL_TOAST_DURATION = 5000;

export type EmailSentNotificationOptions = {
  /** Destinatario (email) o resumen corto. */
  to?: string | null;
  /** Nombre del documento, si aplica. */
  fileName?: string | null;
  /** Título del popup. */
  title?: string;
  /** Mensaje completo (si se omite, se arma con to/fileName). */
  message?: string;
};

/**
 * Popup de éxito al enviar correo (mismo estilo que el cierre de solicitud).
 */
export function showEmailSentNotification({
  to,
  fileName,
  title = '¡Correo enviado!',
  message,
}: EmailSentNotificationOptions = {}) {
  const parts: string[] = [];
  if (to) parts.push(`Se envió a ${to}`);
  if (fileName) parts.push(`Documento: ${fileName}`);
  const body =
    message?.trim() ||
    (parts.length > 0
      ? `${parts.join(' · ')}.`
      : 'La invitación por correo se envió correctamente.');

  toast.custom(
    (t) => (
      <ClosureNotificationToast
        t={t}
        title={title}
        message={body}
        duration={EMAIL_TOAST_DURATION}
      />
    ),
    {
      duration: EMAIL_TOAST_DURATION,
      position: 'top-right',
    }
  );
}
