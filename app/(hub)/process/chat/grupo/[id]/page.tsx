import { Suspense } from 'react';
import { Center, Loader } from '@mantine/core';
import ChatWorkspace from '../../../../../../components/chat/ChatWorkspace';

/**
 * UN grupo abierto — /process/chat/grupo/12.
 *
 * Abre LA MISMA pantalla de chats con el grupo ya seleccionado, igual que
 * /process/chat/<code> hace con un asistente. Los grupos viven en la misma
 * lista que los asistentes (pedido de Nicolás, 2026-09-08: "quiero ordenar es
 * como la vista chat, pero que ahí aparezcan los grupos también"), así que esta
 * ruta no es otra pantalla: es un enlace directo a un elemento de esa lista.
 *
 * Es además el destino de la notificación push de un grupo (ver
 * lib/chat/notifyAgentReply.ts): al tocar el aviso hay que caer DENTRO del
 * grupo, no en la lista.
 *
 * Un id que no sea suyo no aparece en su bandeja, así que la pantalla se
 * comporta como si no existiera. El permiso lo decide el servidor
 * (lib/chat/groups.ts), nunca el id de la URL.
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
      <ChatWorkspace
        initialGroupId={Number.isInteger(numero) && numero > 0 ? numero : undefined}
      />
    </Suspense>
  );
}
