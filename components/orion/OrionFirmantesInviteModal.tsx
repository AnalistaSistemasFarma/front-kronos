'use client';

import {
  ActionIcon,
  Alert,
  Badge,
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
import { showEmailSentNotification } from '../../lib/notifications/showEmailSentNotification';
import toast from 'react-hot-toast';

type SignerRow = {
  email: string;
  name: string | null;
  order: number | null;
  type: string;
  status: string | null;
  signUrl: string | null;
  inviteUrl: string | null;
  shareUrl?: string | null;
  shareSource?: 'orion' | 'synerlink' | null;
  inviteSentAt: string | null;
  inviteExpiresAt: string | null;
  cardCode: string | null;
  isExternal?: boolean;
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
  const [sources, setSources] = useState<Record<string, 'orion' | 'synerlink' | null>>({});
  const [orionSynced, setOrionSynced] = useState<boolean | null>(null);
  const [orionError, setOrionError] = useState<string | null>(null);
  const [missingOrionUrl, setMissingOrionUrl] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/integrations/orion/signer-invites?requestId=${requestId}&fileId=${encodeURIComponent(fileId)}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudieron cargar firmantes');
      const rows = (data.signers || []) as SignerRow[];
      setSigners(rows);
      setOrionSynced(typeof data.orionSynced === 'boolean' ? data.orionSynced : null);
      setOrionError(typeof data.orionError === 'string' ? data.orionError : null);
      setMissingOrionUrl(Array.isArray(data.missingOrionUrl) ? data.missingOrionUrl : []);
      const nextUrls: Record<string, string> = {};
      const nextSources: Record<string, 'orion' | 'synerlink' | null> = {};
      for (const s of rows) {
        const u = String(s.shareUrl || s.inviteUrl || s.signUrl || '').trim();
        // Solo mostrar URL Orion /sign/… (nunca /firma/externa).
        if (u && /\/sign\/[^/?#]+/i.test(u) && !/\/firma\/externa\//i.test(u)) {
          nextUrls[s.email] = u;
          if (s.order != null) nextUrls[`${s.email}#${s.order}`] = u;
        }
        nextSources[s.email] = s.shareSource === 'orion' ? 'orion' : null;
      }
      setUrls(nextUrls);
      setSources(nextSources);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [fileId, requestId]);

  useEffect(() => {
    if (opened) void load();
  }, [opened, load]);

  const ensureUrl = async (email: string, order?: number | null) => {
    setBusyEmail(email);
    setError(null);
    try {
      const res = await fetch('/api/integrations/orion/signer-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          fileId,
          email,
          order: order ?? undefined,
          action: 'url',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo obtener la URL');
      const next = String(data.shareUrl || data.signUrl || data.inviteUrl || '').trim();
      const key = order != null ? `${email}#${order}` : email;
      if (next && /\/sign\/[^/?#]+/i.test(next) && !/\/firma\/externa\//i.test(next)) {
        setUrls((prev) => ({ ...prev, [email]: next, [key]: next }));
      }
      if (data.shareSource === 'orion') {
        setSources((prev) => ({ ...prev, [email]: 'orion' }));
      }
      if (typeof data.orionSynced === 'boolean') setOrionSynced(data.orionSynced);
      if (data.orionError) setOrionError(String(data.orionError));
      return next || undefined;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
      return undefined;
    } finally {
      setBusyEmail(null);
    }
  };

  const sendMail = async (email: string, order?: number | null) => {
    setBusyEmail(email);
    setError(null);
    try {
      const res = await fetch('/api/integrations/orion/signer-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          fileId,
          email,
          order: order ?? undefined,
          action: 'send',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo enviar el correo');
      const next = String(data.shareUrl || data.signUrl || data.inviteUrl || '').trim();
      if (next) setUrls((prev) => ({ ...prev, [email]: next }));
      if (data.shareSource) {
        setSources((prev) => ({ ...prev, [email]: data.shareSource }));
      }
      showEmailSentNotification({
        to: email,
        fileName: fileName || null,
        title: '¡Correo enviado!',
        message: `La URL de firma se envió a ${email}.${
          fileName ? ` Documento: ${fileName}.` : ''
        }`,
      });
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusyEmail(null);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={fileName ? `Invitar a firmar · ${fileName}` : 'Invitar a firmar'}
      size='lg'
    >
      <Stack gap='md'>
        <Text size='sm' c='dimmed'>
          La URL es el enlace público de <strong>Orion</strong> (<code>/sign/…</code>), el mismo
          que genera GSS Firma. Tras asignar firmantes y enviar a firma, pulse renovar si está vacío.
        </Text>

        {orionSynced === true ? (
          <Alert color='teal' variant='light'>
            Sincronizado con Orion. Las URLs corresponden al documento en GSS Firma.
          </Alert>
        ) : null}
        {orionSynced === false || orionError ? (
          <Alert color='orange' variant='light'>
            {orionError ||
              'No hay sync con Orion. Envíe el documento a firma para que Orion cree los enlaces /sign/{token}.'}
          </Alert>
        ) : null}
        {missingOrionUrl.length > 0 ? (
          <Alert color='yellow' variant='light'>
            Sin URL Orion aún: {missingOrionUrl.join(', ')}. Tras “Enviar a firma”, pulse renovar.
          </Alert>
        ) : null}

        {error ? (
          <Alert color='red' variant='light'>
            {error}
          </Alert>
        ) : null}
        {loading ? <Text size='sm'>Sincronizando con Orion…</Text> : null}
        {!loading && !error && signers.length === 0 ? (
          <Text size='sm' c='dimmed'>
            No hay firmantes asignados. Primero prepare el documento y asigne firmantes.
          </Text>
        ) : null}

        {signers.map((s) => {
          const isExternal = String(s.type).toLowerCase() === 'external' || s.isExternal;
          const orderKey = s.order != null ? `${s.email}#${s.order}` : s.email;
          const rawUrl =
            urls[orderKey] || urls[s.email] || s.shareUrl || s.inviteUrl || s.signUrl || '';
          const url =
            rawUrl &&
            /\/sign\/[^/?#]+/i.test(rawUrl) &&
            !/\/firma\/externa\//i.test(rawUrl)
              ? rawUrl
              : '';
          const source = url ? 'orion' : null;
          const busyKey = orderKey;
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
                {source === 'orion' ? (
                  <Badge size='sm' color='teal' variant='light'>
                    Orion
                  </Badge>
                ) : source === 'synerlink' ? (
                  <Badge size='sm' color='gray' variant='light'>
                    Respaldo SynerLink
                  </Badge>
                ) : null}
              </Group>
              <Group gap='xs' align='flex-end' wrap='nowrap'>
                <TextInput
                  label='URL de firma (Orion /sign/…)'
                  value={url}
                  readOnly
                  style={{ flex: 1 }}
                  placeholder='URL Orion /sign/… — pulse renovar'
                />
                <Tooltip label='Sincronizar / renovar desde Orion'>
                  <ActionIcon
                    variant='light'
                    loading={busyEmail === s.email || busyEmail === busyKey}
                    onClick={() => void ensureUrl(s.email, s.order)}
                    mb={2}
                  >
                    <IconRefresh size={16} />
                  </ActionIcon>
                </Tooltip>
                {url ? (
                  <CopyButton value={url}>
                    {({ copied, copy }) => (
                      <Tooltip label={copied ? 'Copiado' : 'Copiar'}>
                        <ActionIcon
                          variant='light'
                          color={copied ? 'teal' : 'blue'}
                          onClick={copy}
                          mb={2}
                        >
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
                loading={busyEmail === s.email || busyEmail === busyKey}
                disabled={!url}
                onClick={() => void sendMail(s.email, s.order)}
              >
                Enviar URL al correo
              </Button>
              {s.inviteSentAt ? (
                <Text size='xs' c='dimmed'>
                  Último envío: {new Date(s.inviteSentAt).toLocaleString('es-CO')}
                </Text>
              ) : null}
            </Stack>
          );
        })}
      </Stack>
    </Modal>
  );
}
