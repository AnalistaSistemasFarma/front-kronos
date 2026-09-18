'use client';

import {
  ActionIcon,
  Alert,
  Button,
  CopyButton,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { IconCheck, IconCopy, IconMail, IconRefresh } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';

type SignerRow = {
  email: string;
  name: string | null;
  order: number | null;
  type: string;
  status: string | null;
  signUrl: string | null;
  inviteUrl: string | null;
  inviteSentAt: string | null;
  inviteExpiresAt: string | null;
  cardCode: string | null;
};

type Props = {
  opened: boolean;
  onClose: () => void;
  requestId: number;
  fileId: string;
  fileName?: string | null;
};

export default function OrionFirmantesInviteModal({
  opened,
  onClose,
  requestId,
  fileId,
  fileName,
}: Props) {
  const [signers, setSigners] = useState<SignerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/integrations/orion/signer-invites?requestId=${requestId}&fileId=${encodeURIComponent(fileId)}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudieron cargar firmantes');
      setSigners((data.signers || []) as SignerRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [fileId, requestId]);

  useEffect(() => {
    if (opened) void load();
  }, [opened, load]);

  const ensureUrl = async (email: string) => {
    setBusyEmail(email);
    setError(null);
    try {
      const res = await fetch('/api/integrations/orion/signer-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, fileId, email, action: 'url' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo generar la URL');
      if (data.inviteUrl) {
        setUrls((prev) => ({ ...prev, [email]: (data.shareUrl || data.signUrl || data.inviteUrl) as string }));
      }
      return (data.shareUrl || data.signUrl || data.inviteUrl) as string | undefined;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
      return undefined;
    } finally {
      setBusyEmail(null);
    }
  };

  const sendMail = async (email: string) => {
    setBusyEmail(email);
    setError(null);
    try {
      const res = await fetch('/api/integrations/orion/signer-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, fileId, email, action: 'send' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo enviar el correo');
      if (data.inviteUrl || data.shareUrl) {
        setUrls((prev) => ({
          ...prev,
          [email]: (data.shareUrl || data.signUrl || data.inviteUrl) as string,
        }));
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusyEmail(null);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={fileName ? `Firmantes · ${fileName}` : 'Firmantes'}
      size='lg'
    >
      <Stack gap='md'>
        {error ? (
          <Alert color='red' variant='light'>
            {error}
          </Alert>
        ) : null}
        {loading ? <Text size='sm'>Cargando…</Text> : null}
        {!loading && signers.length === 0 ? (
          <Text size='sm' c='dimmed'>
            No hay firmantes asignados.
          </Text>
        ) : null}
        {signers.map((s) => {
          const isExternal = String(s.type).toLowerCase() === 'external';
          const url = urls[s.email] || s.signUrl || s.inviteUrl || '';
          return (
            <Stack
              key={`${s.order}-${s.email}`}
              gap={6}
              p='sm'
              style={{ border: '1px solid var(--app-border)', borderRadius: 8 }}
            >
              <Group justify='space-between' wrap='nowrap'>
                <div style={{ minWidth: 0 }}>
                  <Text size='sm' fw={700} lineClamp={1}>
                    {s.order != null ? `${s.order}. ` : ''}
                    {s.name || s.email}
                  </Text>
                  <Text size='xs' c='dimmed' lineClamp={1}>
                    {s.email}
                    {isExternal ? ' · Socio externo' : ' · Interno'}
                    {s.status ? ` · ${s.status}` : ''}
                  </Text>
                </div>
              </Group>
              {isExternal ? (
                <>
                  <Group gap='xs' align='flex-end' wrap='nowrap'>
                    <TextInput
                      label='URL de firma'
                      value={url}
                      readOnly
                      style={{ flex: 1 }}
                      placeholder='Genere la URL para compartirla'
                    />
                    <Tooltip label='Generar / renovar URL'>
                      <ActionIcon
                        variant='light'
                        loading={busyEmail === s.email}
                        onClick={() => void ensureUrl(s.email)}
                        mb={2}
                      >
                        <IconRefresh size={16} />
                      </ActionIcon>
                    </Tooltip>
                    {url ? (
                      <CopyButton value={url}>
                        {({ copied, copy }) => (
                          <Tooltip label={copied ? 'Copiado' : 'Copiar'}>
                            <ActionIcon variant='light' color={copied ? 'teal' : 'blue'} onClick={copy} mb={2}>
                              {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </CopyButton>
                    ) : null}
                  </Group>
                  <Button
                    size='xs'
                    leftSection={<IconMail size={14} />}
                    loading={busyEmail === s.email}
                    onClick={() => void sendMail(s.email)}
                  >
                    Enviar al correo
                  </Button>
                  {s.inviteSentAt ? (
                    <Text size='xs' c='dimmed'>
                      Último envío: {new Date(s.inviteSentAt).toLocaleString('es-CO')}
                    </Text>
                  ) : null}
                </>
              ) : (
                <Text size='xs' c='dimmed'>
                  Firmante interno: firma desde SynerLink / Autorizaciones.
                </Text>
              )}
            </Stack>
          );
        })}
      </Stack>
    </Modal>
  );
}
