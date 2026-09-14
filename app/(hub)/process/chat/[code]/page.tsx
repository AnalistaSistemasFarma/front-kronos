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

  return (
    <Suspense
      fallback={
        <EsqueletoPantallaChat />
      }
    >
      <ChatWorkspace initialAgentCode={decodeURIComponent(code)} />
    </Suspense>
  );
}
