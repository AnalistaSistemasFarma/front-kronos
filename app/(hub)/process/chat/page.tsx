import { Suspense } from 'react';
import { Center, Loader } from '@mantine/core';
import ChatWorkspace from '../../../../components/chat/ChatWorkspace';

/**
 * Módulo "Asistentes IA" — página de chats.
 *
 * Esta URL es además el SUBPROCESO que otorga el acceso al módulo
 * (CHAT_MODULE_URL en lib/chat/access.ts), así que al asignarla desde
 * /process/administration/users el usuario ve la tarjeta en el hub y esta
 * pantalla queda accesible. El permiso real lo resuelve el servidor en cada
 * llamada a /api/chat/*; aquí solo se pinta lo que la API deja ver.
 *
 * ChatWorkspace usa `useSearchParams` (?agent=orus), que en el App Router
 * exige un límite de Suspense.
 */
export const dynamic = 'force-dynamic';

export default function ChatPage() {
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
      <ChatWorkspace />
    </Suspense>
  );
}
