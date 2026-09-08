import { Suspense } from 'react';
import { Center, Loader } from '@mantine/core';
import ChatGroups from '../../../../../../components/chat/ChatGroups';

/**
 * UN grupo abierto — /process/chat/grupo/12.
 *
 * Es el destino de la notificación push de un grupo (ver
 * lib/chat/notifyAgentReply.ts): al tocar el aviso hay que caer DENTRO del
 * grupo, no en la lista. Un id que no sea suyo abre la pantalla y el servidor
 * responde 404 al pedir el hilo, así que se ve el mensaje de "no forma parte de
 * este grupo" — el permiso lo decide el servidor, nunca el id de la URL.
 */
export const dynamic = 'force-dynamic';

export default async function ChatGroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numero = Number.parseInt(id, 10);

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
      <ChatGroups initialGroupId={Number.isInteger(numero) && numero > 0 ? numero : undefined} />
    </Suspense>
  );
}
