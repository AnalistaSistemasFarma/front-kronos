'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Group, Modal, Paper, ScrollArea, Skeleton, Stack, Text, Textarea, UnstyledButton } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertTriangle, IconCheck, IconLock, IconRobot } from '@tabler/icons-react';
import AgentAvatar from '../chat/AgentAvatar';
import { CORREO_AGENTE_MAX_PREGUNTA } from '../../lib/correo/constants';
import { correoApi, type AgenteCorreo } from './correoClient';

/**
 * «Consultar a un agente» (diseño aprobado por Nicolás Rivera, 2026-10-16): la persona elige UNO de
 * SUS agentes del chat (los mismos que ve en el chat), escribe —si quiere— qué necesita, y el hilo
 * se comparte con ese agente por 24 h. Luego se abre el chat con el contexto ya enviado.
 * La decisión es de la persona: el agente solo propone.
 */
export default function ConsultarAgenteModal({
  opened,
  onClose,
  conversationId,
  asunto,
  onCompartido,
}: {
  opened: boolean;
  onClose: () => void;
  conversationId: string;
  asunto: string;
  /** Tras compartir: la página navega al chat del agente. */
  onCompartido: (r: { agente: AgenteCorreo; idChatConversation: number }) => void;
}) {
  const movil = useMediaQuery('(max-width: 36em)') ?? false;
  const [agentes, setAgentes] = useState<AgenteCorreo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elegido, setElegido] = useState<number | null>(null);
  const [pregunta, setPregunta] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setError(null);
    setPregunta('');
    let vivo = true;
    correoApi
      .agentes()
      .then((r) => {
        if (!vivo) return;
        setAgentes(r.agentes);
        setElegido(r.agentes.length === 1 ? r.agentes[0].idAgent : null);
      })
      .catch((e) => vivo && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      vivo = false;
    };
  }, [opened]);

  const compartir = async () => {
    if (!elegido) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await correoApi.compartir(conversationId, elegido, pregunta.trim());
      onCompartido({ agente: r.agente, idChatConversation: r.idChatConversation });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      fullScreen={movil}
      size='lg'
      radius='md'
      centered
      title={
        <Group gap={8}>
          <IconRobot size={20} />
          <Text fw={700}>Consultar a un agente</Text>
        </Group>
      }
      data-testid='correo-agente-modal'
    >
      <Stack gap='sm'>
        <Text size='sm' c='dimmed' lineClamp={2}>
          Hilo: <b>{asunto || '(Sin asunto)'}</b>
        </Text>
        {error && (
          <Alert color='red' icon={<IconAlertTriangle size={18} />} data-testid='correo-agente-error'>
            {error}
          </Alert>
        )}
        <Text size='sm' fw={600}>
          ¿A cuál de sus agentes le comparte este hilo?
        </Text>
        {agentes === null && !error ? (
          <Stack gap={6}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} h={56} radius='md' />
            ))}
          </Stack>
        ) : agentes && agentes.length === 0 ? (
          <Alert color='gray' data-testid='correo-agente-sin-agentes'>
            Usted no tiene agentes asignados en el chat. Pídalos a Tecnología.
          </Alert>
        ) : (
          <ScrollArea.Autosize mah={movil ? undefined : 300} type='auto'>
            <Stack gap={6} role='radiogroup' aria-label='Agentes disponibles'>
              {(agentes ?? []).map((a) => {
                const activo = elegido === a.idAgent;
                return (
                  <UnstyledButton key={a.idAgent} role='radio' aria-checked={activo} onClick={() => setElegido(a.idAgent)} data-testid='correo-agente-opcion' data-code={a.code}>
                    <Paper withBorder radius='md' p='xs' style={{ borderColor: activo ? 'var(--mantine-color-blue-6)' : undefined, background: activo ? 'var(--mantine-color-blue-light)' : undefined }}>
                      <Group wrap='nowrap' gap='sm'>
                        <AgentAvatar code={a.code} displayName={a.displayName} avatarUrl={a.avatarUrl} avatarVersion={a.avatarVersion} size={40} showStatus={false} withTooltip={false} />
                        <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                          <Text size='sm' fw={600}>
                            {a.displayName}
                          </Text>
                          {a.description && (
                            <Text size='xs' c='dimmed' lineClamp={1}>
                              {a.description}
                            </Text>
                          )}
                        </Stack>
                        {activo && <IconCheck size={18} color='var(--mantine-color-blue-6)' />}
                      </Group>
                    </Paper>
                  </UnstyledButton>
                );
              })}
            </Stack>
          </ScrollArea.Autosize>
        )}
        <Textarea
          label='¿Qué necesita del agente? (opcional)'
          placeholder='Por ejemplo: «Prepárame una respuesta formal confirmando la recepción del contrato».'
          autosize
          minRows={2}
          maxRows={6}
          maxLength={CORREO_AGENTE_MAX_PREGUNTA}
          value={pregunta}
          onChange={(e) => setPregunta(e.currentTarget.value)}
          data-testid='correo-agente-pregunta'
        />
        <Alert color='blue' variant='light' icon={<IconLock size={18} />} data-testid='correo-agente-aviso'>
          <Text size='xs'>
            El agente podrá leer <b>solo este hilo y sus adjuntos</b> durante <b>24 horas</b>. Puede proponerle una respuesta, una solicitud o una nota, pero{' '}
            <b>nada se envía ni se crea sin su confirmación</b>. Puede revocar el acceso cuando quiera desde este hilo.
          </Text>
        </Alert>
        <Group justify='flex-end' gap='xs' mt='xs'>
          <Button variant='default' onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button leftSection={<IconRobot size={16} />} onClick={compartir} loading={enviando} disabled={!elegido} data-testid='correo-agente-compartir'>
            Compartir y abrir el chat
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
