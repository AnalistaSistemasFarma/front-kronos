'use client';

import { useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Modal,
  Stack,
  Text,
} from '@mantine/core';
import { IconAlertTriangle, IconCamera, IconCheck } from '@tabler/icons-react';
import AgentAvatar from './AgentAvatar';
import {
  AVATAR_LADO,
  AVATAR_MIMES_PERMITIDOS,
  MAX_AVATAR_BYTES,
  describeAgentStatus,
  type ChatAgentDto,
  type ChatStatusDto,
} from '../../lib/chat/client';

/**
 * DETALLE DE UN ASISTENTE — quién es, dónde está y, si usted es
 * administrador, su foto.
 *
 * Pedido de Nicolás (2026-09-09): "cuando le dé click a Orus o a la foto de
 * perfil debería ver el detalle del agente, y en ese detalle poderle cambiar
 * la imagen". Se abre desde el ENCABEZADO de la conversación —el nombre y la
 * foto—, igual que en WhatsApp se toca el contacto para ver su ficha. Tocar la
 * tarjeta de la lista sigue abriendo el chat, que es lo que uno espera de una
 * lista de conversaciones.
 */
export default function AgentDetailModal({
  agent,
  status,
  puedeEditar,
  abierto,
  onCerrar,
  onFotoCambiada,
}: {
  agent: ChatAgentDto | null;
  status: ChatStatusDto | null;
  /** Solo un administrador puede cambiar la foto. La reja real está en el
   *  endpoint; esto decide únicamente si se pinta el botón. */
  puedeEditar: boolean;
  abierto: boolean;
  onCerrar: () => void;
  /** Avisa la versión nueva para refrescar la imagen sin recargar la página. */
  onFotoCambiada: (idAgent: number, version: number) => void;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  if (!agent) return null;
  const view = describeAgentStatus(status);

  /**
   * Reduce la imagen a un cuadrado de 512 px ANTES de subirla.
   *
   * En el navegador y no en el servidor por una razón práctica: redimensionar
   * en Node pediría una dependencia nativa (sharp), y aquí el `canvas` ya
   * está. Recorta al centro para no deformar caras — una foto apaisada
   * estirada a cuadrado se ve mal— y sale en JPEG al 88 %, que para 512 px
   * son unas decenas de kilobytes.
   *
   * El tope de tamaño se revisa IGUAL en el servidor: una validación que solo
   * vive en el cliente no es una validación.
   */
  const aCuadrado = (archivo: File): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(archivo);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const lado = Math.min(img.width, img.height);
        const lienzo = document.createElement('canvas');
        lienzo.width = AVATAR_LADO;
        lienzo.height = AVATAR_LADO;
        const ctx = lienzo.getContext('2d');
        if (!ctx) {
          reject(new Error('El navegador no pudo procesar la imagen.'));
          return;
        }
        ctx.drawImage(
          img,
          (img.width - lado) / 2,
          (img.height - lado) / 2,
          lado,
          lado,
          0,
          0,
          AVATAR_LADO,
          AVATAR_LADO
        );
        lienzo.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo convertir la imagen.'))),
          'image/jpeg',
          0.88
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Ese archivo no parece una imagen.'));
      };
      img.src = url;
    });

  const subir = async (archivo: File) => {
    setError(null);
    setListo(false);

    if (!AVATAR_MIMES_PERMITIDOS.includes((archivo.type || '').toLowerCase())) {
      setError('Use una imagen JPG, PNG o WebP.');
      return;
    }

    setSubiendo(true);
    try {
      const cuadrada = await aCuadrado(archivo);
      if (cuadrada.size > MAX_AVATAR_BYTES) {
        throw new Error('La imagen quedó muy grande incluso después de reducirla.');
      }

      const cuerpo = new FormData();
      cuerpo.append('file', new File([cuadrada], `${agent.code}.jpg`, { type: 'image/jpeg' }));

      const res = await fetch(`/api/chat/agents/${encodeURIComponent(agent.code)}/avatar`, {
        method: 'POST',
        body: cuerpo,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `No se pudo guardar (${res.status}).`);

      onFotoCambiada(agent.idAgent, Number(data?.avatarVersion) || Date.now());
      setListo(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubiendo(false);
      if (entrada.current) entrada.current.value = '';
    }
  };

  return (
    <Modal
      opened={abierto}
      onClose={onCerrar}
      title={`Detalle de ${agent.displayName}`}
      radius='lg'
      centered
      classNames={{ content: 'chat-surface' }}
    >
      <Stack gap='md'>
        <Group gap='md' wrap='nowrap' align='flex-start'>
          <AgentAvatar
            code={agent.code}
            displayName={agent.displayName}
            avatarUrl={agent.avatarUrl}
            avatarVersion={agent.avatarVersion}
            status={status}
            size={72}
            withTooltip={false}
          />
          <Box style={{ minWidth: 0 }}>
            <Text fw={700}>{agent.displayName}</Text>
            {agent.handle && (
              <Text size='sm' className='chat-text-muted'>
                {agent.handle}
              </Text>
            )}
            <Text size='xs' className='chat-text-muted'>
              {view.label}
            </Text>
          </Box>
        </Group>

        {agent.description && <Text size='sm'>{agent.description}</Text>}

        <Box>
          <Text size='xs' fw={600} mb={4}>
            {agent.companies.length === 1 ? 'Empresa' : 'Empresas'}
          </Text>
          <Group gap={6}>
            {agent.companies.map((c) => (
              <Badge key={c.idCompany} size='sm' variant='light' color={c.isPrimary ? 'blue' : 'gray'}>
                {c.companyName}
              </Badge>
            ))}
          </Group>
        </Box>

        {puedeEditar && (
          <Box>
            <Text size='xs' fw={600} mb={4}>
              Foto
            </Text>
            <Text size='xs' className='chat-text-muted' mb='xs'>
              Se recorta al centro y se guarda en {AVATAR_LADO}×{AVATAR_LADO}. La ve todo el que
              tenga este asistente.
            </Text>

            {/* ETIQUETA, no un botón que llame a click() por programa: abrir el
                selector de archivos desde JavaScript es frágil en el celular
                —se pierde el gesto y no pasa nada—. Es la misma razón por la
                que el clip del compositor se hizo así. */}
            <Button
              component='label'
              htmlFor={`avatar-${agent.code}`}
              variant='light'
              size='xs'
              radius='md'
              leftSection={<IconCamera size={14} />}
              loading={subiendo}
            >
              Cambiar la foto
              <input
                ref={entrada}
                id={`avatar-${agent.code}`}
                type='file'
                accept={AVATAR_MIMES_PERMITIDOS.join(',')}
                style={{ display: 'block', width: 0, height: 0, opacity: 0 }}
                onChange={(event) => {
                  const archivo = event.currentTarget.files?.[0];
                  if (archivo) void subir(archivo);
                }}
              />
            </Button>

            {listo && (
              <Alert mt='xs' color='green' radius='md' icon={<IconCheck size={16} />} p='xs'>
                <Text size='xs'>Foto actualizada.</Text>
              </Alert>
            )}
            {error && (
              <Alert mt='xs' color='red' radius='md' icon={<IconAlertTriangle size={16} />} p='xs'>
                <Text size='xs'>{error}</Text>
              </Alert>
            )}
          </Box>
        )}
      </Stack>
    </Modal>
  );
}
