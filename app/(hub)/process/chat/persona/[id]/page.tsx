import { Suspense } from 'react';
import ChatWorkspace from '../../../../../../components/chat/ChatWorkspace';
import { EsqueletoPantallaChat } from '../../../../../../components/chat/ChatSkeletons';

/**
 * UNA conversación entre personas abierta — /process/chat/persona/12.
 *
 * Mismo patrón que /process/chat/grupo/[id]: abre LA MISMA pantalla de chats
 * con el hilo ya seleccionado. Es además el destino de la notificación push de
 * un mensaje directo o de un zumbido: al tocar el aviso hay que caer DENTRO de
 * la conversación, no en la lista.
 *
 * Un id que no sea suyo no aparece en su bandeja y el servidor responde 404
 * (lib/chat/people.ts, assertPeopleAccess): el permiso nunca lo decide la URL.
 */
export const dynamic = 'force-dynamic';

export default async function ChatPersonaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numero = Number.parseInt(id, 10);

  return (
    <Suspense fallback={<EsqueletoPantallaChat />}>
      <ChatWorkspace
        initialPersonaId={Number.isInteger(numero) && numero > 0 ? numero : undefined}
      />
    </Suspense>
  );
}
