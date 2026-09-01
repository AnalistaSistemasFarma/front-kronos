'use client';

import { ActionIcon, Tooltip } from '@mantine/core';
import { IconBell, IconBellOff, IconBellRinging } from '@tabler/icons-react';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import { usePushNotifications } from '../hooks/usePushNotifications';

export default function PushNotificationBell() {
  const { data: session } = useSession();
  const userEmail = session?.user?.email;
  const { isSupported, isAvailable, isSubscribed, permission, loading, subscribe, unsubscribe } =
    usePushNotifications(userEmail);

  if (!isSupported || !isAvailable) return null;

  const handleClick = async () => {
    if (permission === 'denied') {
      toast.error(
        'Permiso de notificaciones denegado. Habilítalo desde la configuración del navegador.',
        { duration: 5000 }
      );
      return;
    }

    if (isSubscribed) {
      const ok = await unsubscribe();
      if (ok) toast.success('Notificaciones desactivadas');
      else toast.error('No se pudieron desactivar las notificaciones');
    } else {
      const ok = await subscribe();
      if (ok) toast.success('Notificaciones activadas');
      else toast.error('No se pudieron activar las notificaciones en este entorno', { duration: 5000 });
    }
  };

  const getIcon = () => {
    if (permission === 'denied') return <IconBellOff size={18} />;
    if (isSubscribed) return <IconBellRinging size={18} />;
    return <IconBell size={18} />;
  };

  const getLabel = () => {
    if (permission === 'denied') return 'Notificaciones bloqueadas';
    if (isSubscribed) return 'Notificaciones activas (clic para desactivar)';
    return 'Activar notificaciones';
  };

  return (
    <Tooltip label={getLabel()} withArrow>
      <ActionIcon
        variant='subtle'
        color={isSubscribed ? 'blue' : 'gray'}
        onClick={handleClick}
        loading={loading}
        aria-label={getLabel()}
      >
        {getIcon()}
      </ActionIcon>
    </Tooltip>
  );
}
