'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionIcon, Flex, Text } from '@mantine/core';
import { IconArrowLeft, IconArrowRight } from '@tabler/icons-react';
import {
  detailHref,
  findNavPosition,
  loadRequestListNav,
  saveLastViewed,
  type NavItem,
  type RequestListNavState,
} from '../../lib/requests-general/requestListNav';

/**
 * «Anterior / Siguiente» del detalle de solicitudes y tareas, igual que en el detalle de
 * Tickets: recorre la lista que el usuario tenía en pantalla (la guarda la lista al abrir).
 * Si el elemento no viene de una lista (correo, notificación), no se muestra.
 */
export function RequestListNavigator({ kind, id }: NavItem) {
  const router = useRouter();
  const [nav, setNav] = useState<RequestListNavState | null>(null);

  useEffect(() => {
    const loaded = loadRequestListNav();
    setNav(loaded);
    if (loaded && findNavPosition(loaded.items, { kind, id })) saveLastViewed({ kind, id });
  }, [kind, id]);

  const position = nav ? findNavPosition(nav.items, { kind, id }) : null;
  if (!nav || !position) return null;

  const go = (item: NavItem | null) => {
    if (!item) return;
    router.push(detailHref(item, nav.origin));
  };

  return (
    <Flex justify='space-between' align='center' mt='4' data-testid='request-list-navigator'>
      <ActionIcon
        variant='subtle'
        size='lg'
        onClick={() => go(position.prev)}
        disabled={!position.prev}
        aria-label='Anterior'
        title='Anterior'
      >
        <IconArrowLeft size={24} />
      </ActionIcon>

      <Text size='sm' c='gray.6' aria-live='polite'>
        {`${position.index + 1} de ${position.total}`}
      </Text>

      <ActionIcon
        variant='subtle'
        size='lg'
        onClick={() => go(position.next)}
        disabled={!position.next}
        aria-label='Siguiente'
        title='Siguiente'
      >
        <IconArrowRight size={24} />
      </ActionIcon>
    </Flex>
  );
}
