import { Suspense } from 'react';
import { Center, Loader } from '@mantine/core';
import ChatGroups from '../../../../../components/chat/ChatGroups';

/**
 * Grupos del chat — /process/chat/grupos.
 *
 * No es un subproceso-permiso propio: el permiso sigue siendo el del módulo
 * (`/process/chat`). Un grupo se ve si uno es integrante, y eso lo resuelve el
 * servidor en cada llamada (lib/chat/groups.ts). Si alguien abre esta URL sin
 * el módulo, la pantalla lo dice y no hay nada que ver.
 */
export const dynamic = 'force-dynamic';

export default function ChatGroupsPage() {
  return (
    <Suspense
      fallback={
        <div className='app-page-shell app-page-shell--fill min-h-screen'>
          <Center py='xl'>
            <Loader size='sm' />
          </Center>
        </div>
      }
    >
      <ChatGroups />
    </Suspense>
  );
}
