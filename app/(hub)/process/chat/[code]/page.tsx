import { Suspense } from 'react';
import ChatWorkspace from '../../../../../components/chat/ChatWorkspace';
import { EsqueletoPantallaChat } from '../../../../../components/chat/ChatSkeletons';

/**
 * Chat directo con UN agente — /process/chat/orus.
 *
 * Esa ruta es el subproceso-permiso del agente (agent.id_subprocess, ver
 * lib/chat/access.ts y prisma/seeds/chat-agents.sql). El hub de procesos
 * navega al `subprocess_url` del subproceso asignado, así que si esta página
 * no existiera, hacer clic en "Asistente Orus" daría 404.
 *
 * Abre la misma pantalla con el agente ya seleccionado. Si el usuario NO tiene
 * permiso sobre ese agente, /api/chat/access sencillamente no lo devuelve y la
 * pantalla se comporta como si no existiera: el permiso lo decide el servidor,
 * nunca el `code` de la URL.
 */
export const dynamic = 'force-dynamic';

export default async function AgentChatPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const clave = decodeURIComponent(code);

  // '/process/chat/personas' es el subproceso del PILOTO de mensajes entre
  // personas, no un asistente: el hub navega aquí al tocar su tarjeta, así que
  // se abre la pantalla de chats con el buscador de personas a la vista.
  if (clave.toLowerCase() === 'personas') {
    return (
      <Suspense fallback={<EsqueletoPantallaChat />}>
        <ChatWorkspace abrirBuscadorPersonas />
      </Suspense>
    );
  }

  return (
    <Suspense
      fallback={
        <EsqueletoPantallaChat />
      }
    >
      <ChatWorkspace initialAgentCode={clave} />
    </Suspense>
  );
}
