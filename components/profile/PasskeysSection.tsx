'use client';

import { useCallback, useEffect, useState } from 'react';
import { ActionIcon, Alert, Badge, Button, Card, Group, Loader, Stack, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconFingerprint, IconShieldCheck, IconTrash } from '@tabler/icons-react';
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';

type Resultado = { tipo: 'ok' | 'error'; mensaje: string };

interface PasskeyItem {
  id: number;
  name: string;
  deviceType: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

function fecha(value: string | null): string {
  if (!value) return 'Nunca';
  return new Date(value).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Texto para el error del navegador al crear la llave. */
function mensajeRegistro(err: unknown): string {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'NotAllowedError') return 'Se canceló o venció la confirmación con el biométrico.';
  if (name === 'InvalidStateError') return 'Este dispositivo ya está registrado.';
  return err instanceof Error ? err.message : 'No se pudo registrar el dispositivo.';
}

/**
 * Perfil → Acceso con biométrico (passkeys, 2026-10-31): registrar Face ID, huella o
 * Windows Hello para entrar sin contraseña, y eliminar dispositivos (p. ej. si se pierde
 * el celular). La cara o la huella nunca salen del dispositivo.
 */
export default function PasskeysSection({ onResultado }: { onResultado: (r: Resultado) => void }) {
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [supported, setSupported] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [items, setItems] = useState<PasskeyItem[]>([]);
  const [name, setName] = useState('');
  const [registering, setRegistering] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/passkeys', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 503) {
        setAvailable(false);
        return;
      }
      if (!res.ok) throw new Error(data.error || 'No se pudieron cargar los dispositivos');
      setAvailable(true);
      setItems(Array.isArray(data.passkeys) ? data.passkeys : []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
    void load();
  }, [load]);

  const registrar = async () => {
    setRegistering(true);
    try {
      const optRes = await fetch('/api/passkeys/register/options', { method: 'POST' });
      const optionsJSON = await optRes.json().catch(() => ({}));
      if (!optRes.ok) throw new Error(optionsJSON.error || 'No se pudo iniciar el registro');
      const response = await startRegistration({ optionsJSON });
      const res = await fetch('/api/passkeys/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response, name: name.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo registrar el dispositivo');
      setName('');
      onResultado({ tipo: 'ok', mensaje: `Listo: ya puede entrar con el biométrico de «${data.passkey?.name ?? 'este dispositivo'}».` });
      await load();
    } catch (err) {
      onResultado({ tipo: 'error', mensaje: mensajeRegistro(err) });
    } finally {
      setRegistering(false);
    }
  };

  const eliminar = async (item: PasskeyItem) => {
    if (!window.confirm(`¿Eliminar «${item.name}»? Ese dispositivo ya no podrá entrar con biométrico.`)) return;
    setDeleting(item.id);
    try {
      const res = await fetch(`/api/passkeys/${item.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo eliminar el dispositivo');
      onResultado({ tipo: 'ok', mensaje: `Se eliminó «${item.name}».` });
      await load();
    } catch (err) {
      onResultado({ tipo: 'error', mensaje: err instanceof Error ? err.message : 'Error inesperado' });
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Card withBorder padding='lg' radius='md'>
      <Title order={3} mb='md'>
        <Group gap='xs'>
          <IconFingerprint size={20} />
          Acceso con biométrico
        </Group>
      </Title>

      <Text size='sm' c='dimmed' mb='md'>
        Entre a SynerLink sin escribir la contraseña, con Face ID, la huella o Windows Hello de su
        dispositivo. Su cara o su huella nunca salen del dispositivo: SynerLink solo recibe una firma
        digital.
      </Text>

      {loading ? (
        <Group justify='center' py='md'>
          <Loader size='sm' />
        </Group>
      ) : !available ? (
        <Alert icon={<IconAlertTriangle size={16} />} color='yellow'>
          El acceso con biométrico todavía no está habilitado en este ambiente.
        </Alert>
      ) : loadError ? (
        <Alert icon={<IconAlertTriangle size={16} />} color='red'>
          {loadError}
        </Alert>
      ) : (
        <Stack gap='md'>
          {items.length === 0 ? (
            <Text size='sm'>Aún no tiene dispositivos registrados.</Text>
          ) : (
            <Stack gap='xs'>
              {items.map((item) => (
                <Group key={item.id} justify='space-between' wrap='nowrap' p='sm' style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <Group gap='xs'>
                      <IconShieldCheck size={16} color='var(--mantine-color-green-6)' />
                      <Text fw={500} size='sm' truncate>
                        {item.name}
                      </Text>
                      {item.deviceType === 'multiDevice' && (
                        <Badge size='xs' variant='light'>
                          Sincronizada
                        </Badge>
                      )}
                    </Group>
                    <Text size='xs' c='dimmed'>
                      Registrado: {fecha(item.createdAt)} · Último uso: {fecha(item.lastUsedAt)}
                    </Text>
                  </div>
                  <Tooltip label='Eliminar dispositivo'>
                    <ActionIcon
                      variant='subtle'
                      color='red'
                      loading={deleting === item.id}
                      onClick={() => void eliminar(item)}
                      aria-label={`Eliminar ${item.name}`}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              ))}
            </Stack>
          )}

          {supported ? (
            <Group align='flex-end' wrap='wrap'>
              <TextInput
                label='Nombre del dispositivo (opcional)'
                placeholder='Ej.: Mi iPhone'
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
                style={{ flex: 1, minWidth: 200 }}
              />
              <Button leftSection={<IconFingerprint size={16} />} loading={registering} onClick={() => void registrar()}>
                Activar en este dispositivo
              </Button>
            </Group>
          ) : (
            <Alert icon={<IconAlertTriangle size={16} />} color='yellow'>
              Este navegador no permite el acceso con biométrico. Use Safari en iPhone, Chrome en
              Android o un navegador actualizado en el computador.
            </Alert>
          )}
        </Stack>
      )}
    </Card>
  );
}
