'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Text,
  Textarea,
} from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconSend, IconX } from '@tabler/icons-react';
import { MAX_USER_MESSAGE_CHARS } from '../../lib/chat/constants';
import type { ChatAgentDto } from '../../lib/chat/client';

/**
 * MENSAJE MASIVO a varios asistentes de una sola vez.
 *
 * Pedido de Nicolás (2026-09-08), para bajar directivas a toda la flota sin
 * escribirle a cada agente. Solo lo ven los administradores.
 *
 * La lista de destinatarios son LOS AGENTES QUE EL USUARIO VE, no una lista
 * escrita: así un agente sembrado hoy entra al masivo hoy, sin tocar código.
 *
 * Tres decisiones de esta ventana, todas por la misma razón —un masivo no se
 * puede deshacer—:
 *   1. Dice a cuántos y a quiénes va ANTES de mandar.
 *   2. Advierte que pone a trabajar a todos a la vez (eso cuesta).
 *   3. Al terminar informa agente por agente, y si alguno falló lo dice en vez
 *      de dar por bueno el envío completo.
 */

type Resultado = {
  enviados: { idAgent: number; displayName: string }[];
  fallidos: { idAgent: number; displayName: string; error: string }[];
  total: number;
};

export default function ChatBroadcastModal({
  opened,
  onClose,
  agents,
  onEnviado,
}: {
  opened: boolean;
  onClose: () => void;
  agents: ChatAgentDto[];
  /** Se llama al terminar, para que la bandeja se refresque. */
  onEnviado?: () => void;
}) {
  const [texto, setTexto] = useState('');
  const [excluidos, setExcluidos] = useState<Set<number>>(new Set());
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  // Al abrir se limpia todo: una ventana que recuerda el mensaje anterior es
  // una invitación a reenviar por error algo que ya se mandó.
  useEffect(() => {
    if (!opened) return;
    setTexto('');
    setExcluidos(new Set());
    setEnviando(false);
    setError(null);
    setResultado(null);
  }, [opened]);

  const destinatarios = useMemo(
    () => agents.filter((a) => !excluidos.has(a.idAgent)),
    [agents, excluidos]
  );

  const demasiadoLargo = texto.length > MAX_USER_MESSAGE_CHARS;
  const puedeEnviar =
    texto.trim().length > 0 && destinatarios.length > 0 && !enviando && !demasiadoLargo;

  const alternar = (idAgent: number) => {
    setExcluidos((previo) => {
      const siguiente = new Set(previo);
      if (siguiente.has(idAgent)) siguiente.delete(idAgent);
      else siguiente.add(idAgent);
      return siguiente;
    });
  };

  const enviar = async () => {
    if (!puedeEnviar) return;
    setEnviando(true);
    setError(null);
    try {
      const respuesta = await fetch('/api/chat/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: texto,
          // Solo se manda la selección cuando de verdad se excluyó a alguien;
          // si van todos, se omite y el servidor resuelve la lista vigente.
          ...(excluidos.size > 0 ? { idAgents: destinatarios.map((a) => a.idAgent) } : {}),
        }),
      });
      const datos = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok && respuesta.status !== 207) {
        setError(datos?.error || 'No se pudo enviar el mensaje masivo.');
        return;
      }
      setResultado({
        enviados: datos.enviados ?? [],
        fallidos: datos.fallidos ?? [],
        total: datos.total ?? destinatarios.length,
      });
      onEnviado?.();
    } catch {
      setError('No se pudo enviar el mensaje masivo.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title='Enviar un mensaje a varios asistentes'
      size='lg'
      radius='md'
      centered
    >
      {resultado ? (
        <Stack gap='sm'>
          {resultado.fallidos.length === 0 ? (
            <Alert color='green' icon={<IconCheck size={18} />} radius='md'>
              Entregado a <b>{resultado.enviados.length}</b>{' '}
              {resultado.enviados.length === 1 ? 'asistente' : 'asistentes'}. Cada uno le responde
              en su propia conversación.
            </Alert>
          ) : (
            <Alert color='yellow' icon={<IconAlertTriangle size={18} />} radius='md'>
              Entregado a <b>{resultado.enviados.length}</b> de <b>{resultado.total}</b>. Revise
              los que no recibieron: a esos <b>no</b> les llegó nada.
            </Alert>
          )}

          {resultado.fallidos.length > 0 && (
            <div>
              <Text size='sm' fw={600} mb={4}>
                No recibieron
              </Text>
              <Stack gap={2}>
                {resultado.fallidos.map((f) => (
                  <Group key={f.idAgent} gap={6} wrap='nowrap'>
                    <IconX size={14} color='var(--mantine-color-red-filled)' />
                    <Text size='sm'>
                      {f.displayName} — {f.error}
                    </Text>
                  </Group>
                ))}
              </Stack>
            </div>
          )}

          <Group justify='flex-end'>
            <Button onClick={onClose}>Cerrar</Button>
          </Group>
        </Stack>
      ) : (
        <Stack gap='sm'>
          <Textarea
            value={texto}
            onChange={(event) => setTexto(event.currentTarget.value)}
            placeholder='Escriba la directiva o el mensaje que quiere que reciban todos…'
            autosize
            minRows={4}
            maxRows={12}
            error={demasiadoLargo ? 'El mensaje es demasiado largo.' : undefined}
            data-autofocus
          />

          <div>
            <Text size='sm' fw={600} mb={4}>
              Va a llegarles a {destinatarios.length} de {agents.length}
            </Text>
            <Text size='xs' c='dimmed' mb={6}>
              Destilde a quien quiera dejar por fuera. La lista es la de sus asistentes: cuando se
              agregue uno nuevo, entra aquí solo.
            </Text>
            <ScrollArea.Autosize mah={190}>
              <Stack gap={4}>
                {agents.map((a) => (
                  <Checkbox
                    key={a.idAgent}
                    checked={!excluidos.has(a.idAgent)}
                    onChange={() => alternar(a.idAgent)}
                    label={
                      <Text size='sm'>
                        {a.displayName}
                        {a.companies?.[0]?.companyName ? (
                          <Text span size='xs' c='dimmed'>
                            {' '}
                            · {a.companies[0].companyName}
                          </Text>
                        ) : null}
                      </Text>
                    }
                  />
                ))}
              </Stack>
            </ScrollArea.Autosize>
          </div>

          <Alert color='yellow' icon={<IconAlertTriangle size={18} />} radius='md' py={8}>
            <Text size='xs'>
              Al enviar, los {destinatarios.length} asistentes se ponen a trabajar al mismo tiempo,
              y eso consume. <b>No se puede deshacer.</b>
            </Text>
          </Alert>

          {error && (
            <Alert color='red' radius='md' py={8}>
              <Text size='xs'>{error}</Text>
            </Alert>
          )}

          <Group justify='space-between'>
            <Text size='xs' c={demasiadoLargo ? 'red' : 'dimmed'}>
              {texto.length.toLocaleString('es-CO')} /{' '}
              {MAX_USER_MESSAGE_CHARS.toLocaleString('es-CO')}
            </Text>
            <Group gap='xs'>
              <Button variant='subtle' color='gray' onClick={onClose} disabled={enviando}>
                Cancelar
              </Button>
              <Button
                leftSection={<IconSend size={16} />}
                onClick={() => void enviar()}
                loading={enviando}
                disabled={!puedeEnviar}
              >
                Enviar a {destinatarios.length}
              </Button>
            </Group>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
