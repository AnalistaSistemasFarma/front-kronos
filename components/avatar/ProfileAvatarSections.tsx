'use client';

import { useEffect, useState } from 'react';
import { Alert, Avatar, Badge, Button, Card, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconMoodSmile, IconRobot } from '@tabler/icons-react';
import { AVATAR_KINDS, parseAvatarConfig, sugerenciaParaAgente } from '../../lib/avatar/compose';
import type { AvatarConfig } from '../../lib/avatar/types';
import { agentAvatarSrc, agentInitials } from '../../lib/chat/client';
import AvatarEditor, { configInicial } from './AvatarEditor';

/**
 * Secciones del Perfil para el avatar estilo Notion: la de la persona y la de
 * sus asistentes. El resultado de cada operación lo pinta la PÁGINA arriba,
 * con color (convención de SynerLink: el aviso no puede quedar enterrado).
 * Por eso aquí solo se avisa con `onResultado`.
 */

export type Resultado = { tipo: 'ok' | 'error'; mensaje: string };

async function leerError(r: Response, porDefecto: string): Promise<string> {
  const data = (await r.json().catch(() => null)) as { error?: string } | null;
  return data?.error || porDefecto;
}

/* ─────────────────────────────── Persona ─────────────────────────────── */

export function MiAvatarSection({
  onResultado,
  onImagen,
}: {
  onResultado: (r: Resultado) => void;
  /** Nueva imagen de perfil (para refrescar la vista y la sesión). */
  onImagen: (image: string | null) => void | Promise<void>;
}) {
  const [cargando, setCargando] = useState(true);
  const [disponible, setDisponible] = useState(true);
  const [guardada, setGuardada] = useState<AvatarConfig | null>(null);
  const [config, setConfig] = useState<AvatarConfig | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [quitando, setQuitando] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await fetch('/api/profile/avatar', { cache: 'no-store' });
        if (!r.ok) throw new Error(await leerError(r, 'No se pudo cargar su avatar.'));
        const data = (await r.json()) as { disponible: boolean; config: unknown };
        if (!vivo) return;
        const previa = parseAvatarConfig(data.config);
        setDisponible(data.disponible);
        setGuardada(previa);
        setConfig(previa ?? configInicial('persona'));
      } catch (e) {
        if (!vivo) return;
        setConfig(configInicial('persona'));
        onResultado({ tipo: 'error', mensaje: e instanceof Error ? e.message : 'No se pudo cargar su avatar.' });
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
    // Solo al montar: onResultado cambia en cada render del padre.
  }, []);

  const guardar = async () => {
    if (!config) return;
    setGuardando(true);
    try {
      const r = await fetch('/api/profile/avatar', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });
      if (!r.ok) throw new Error(await leerError(r, 'No se pudo guardar el avatar.'));
      const data = (await r.json()) as { image: string };
      setGuardada(config);
      await onImagen(data.image);
      onResultado({ tipo: 'ok', mensaje: 'Avatar guardado. Ya se ve en el encabezado y en el chat.' });
    } catch (e) {
      onResultado({ tipo: 'error', mensaje: e instanceof Error ? e.message : 'No se pudo guardar el avatar.' });
    } finally {
      setGuardando(false);
    }
  };

  const quitar = async () => {
    setQuitando(true);
    try {
      const r = await fetch('/api/profile/avatar', { method: 'DELETE' });
      if (!r.ok) throw new Error(await leerError(r, 'No se pudo quitar el avatar.'));
      const data = (await r.json()) as { image: string | null };
      setGuardada(null);
      await onImagen(data.image);
      onResultado({ tipo: 'ok', mensaje: 'Avatar retirado. Se restauró su foto anterior.' });
    } catch (e) {
      onResultado({ tipo: 'error', mensaje: e instanceof Error ? e.message : 'No se pudo quitar el avatar.' });
    } finally {
      setQuitando(false);
    }
  };

  const sinCambios = !!guardada && JSON.stringify(guardada) === JSON.stringify(config);

  return (
    <Card withBorder padding='lg' radius='md'>
      <Title order={3} mb='xs'>
        <Group gap='xs'>
          <IconMoodSmile size={20} />
          Mi avatar
        </Group>
      </Title>
      <Text size='sm' c='dimmed' mb='md'>
        Arme su avatar estilo Notion parte por parte o genere uno aleatorio. Al guardarlo reemplaza su foto de perfil
        en el encabezado y en el chat; puede quitarlo cuando quiera y volver a la foto anterior.
      </Text>

      {!disponible && (
        <Alert color='yellow' icon={<IconAlertTriangle size={16} />} mb='md'>
          El avatar estilo Notion aún no está habilitado en esta base de datos. Puede probar el editor, pero todavía no
          se puede guardar.
        </Alert>
      )}

      {cargando || !config ? (
        <Group justify='center' py='xl'>
          <Loader size='sm' />
        </Group>
      ) : (
        <Stack gap='md'>
          <AvatarEditor config={config} onChange={setConfig} nombreArchivo='mi-avatar' />
          <Group justify='flex-end'>
            {guardada && (
              <Button variant='default' color='red' onClick={() => void quitar()} loading={quitando}>
                Quitar avatar
              </Button>
            )}
            <Button onClick={() => void guardar()} loading={guardando} disabled={!disponible || sinCambios}>
              {sinCambios ? 'Avatar guardado' : 'Guardar avatar'}
            </Button>
          </Group>
        </Stack>
      )}
    </Card>
  );
}

/* ──────────────────────────────── Agentes ──────────────────────────────── */

interface AgenteGestionable {
  code: string;
  displayName: string;
  avatarUrl: string | null;
  avatarVersion: number | null;
  motivo: 'responsable' | 'administrador';
  config: unknown;
}

export function AvataresAgentesSection({ onResultado }: { onResultado: (r: Resultado) => void }) {
  const [agentes, setAgentes] = useState<AgenteGestionable[] | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [config, setConfig] = useState<AvatarConfig | null>(null);
  const [ocupado, setOcupado] = useState<'guardar' | 'quitar' | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch('/api/profile/avatar/agents', { cache: 'no-store' })
      .then(async (r) => (r.ok ? ((await r.json()) as { agentes: AgenteGestionable[] }).agentes : []))
      .catch(() => [])
      .then((lista) => {
        if (vivo) setAgentes(lista);
      });
    return () => {
      vivo = false;
    };
  }, []);

  // Sin asistentes a cargo, la sección no aparece.
  if (!agentes || agentes.length === 0) return null;

  const abrir = (a: AgenteGestionable) => {
    setEditando(a.code);
    setConfig(parseAvatarConfig(a.config) ?? sugerenciaParaAgente(a.displayName) ?? configInicial('animal'));
  };

  const actualizar = (code: string, cambios: Partial<AgenteGestionable>) =>
    setAgentes((prev) => (prev ?? []).map((a) => (a.code === code ? { ...a, ...cambios } : a)));

  const guardar = async (a: AgenteGestionable) => {
    if (!config) return;
    setOcupado('guardar');
    try {
      const r = await fetch(`/api/profile/avatar/agents/${encodeURIComponent(a.code)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });
      if (!r.ok) throw new Error(await leerError(r, 'No se pudo guardar el avatar del asistente.'));
      const data = (await r.json()) as { avatarUrl: string };
      actualizar(a.code, { avatarUrl: data.avatarUrl, config });
      setEditando(null);
      onResultado({ tipo: 'ok', mensaje: `Avatar de ${a.displayName} guardado. Toda la empresa lo verá en el chat.` });
    } catch (e) {
      onResultado({ tipo: 'error', mensaje: e instanceof Error ? e.message : 'No se pudo guardar el avatar del asistente.' });
    } finally {
      setOcupado(null);
    }
  };

  const quitar = async (a: AgenteGestionable) => {
    setOcupado('quitar');
    try {
      const r = await fetch(`/api/profile/avatar/agents/${encodeURIComponent(a.code)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(await leerError(r, 'No se pudo quitar el avatar del asistente.'));
      const data = (await r.json()) as { avatarUrl: string | null };
      actualizar(a.code, { avatarUrl: data.avatarUrl, config: null });
      setEditando(null);
      onResultado({ tipo: 'ok', mensaje: `Avatar de ${a.displayName} retirado. Volvió su imagen anterior.` });
    } catch (e) {
      onResultado({ tipo: 'error', mensaje: e instanceof Error ? e.message : 'No se pudo quitar el avatar del asistente.' });
    } finally {
      setOcupado(null);
    }
  };

  return (
    <Card withBorder padding='lg' radius='md'>
      <Title order={3} mb='xs'>
        <Group gap='xs'>
          <IconRobot size={20} />
          Avatar de mis asistentes
        </Group>
      </Title>
      <Text size='sm' c='dimmed' mb='md'>
        Asistentes del chat de los que usted es responsable. Su avatar puede ser un animal, un planeta, una constelación
        o una persona, estilo Notion; el cambio lo ve toda la empresa.
      </Text>

      <Stack gap='md'>
        {agentes.map((a) => (
          <Card key={a.code} withBorder radius='md' padding='md'>
            <Group justify='space-between' wrap='nowrap'>
              <Group gap='sm' wrap='nowrap'>
                <Avatar src={agentAvatarSrc(a) || undefined} alt={a.displayName} radius='xl' size={44}>
                  {agentInitials(a.displayName)}
                </Avatar>
                <div>
                  <Text fw={600}>{a.displayName}</Text>
                  <Badge size='xs' variant='light' color={a.motivo === 'responsable' ? 'teal' : 'gray'}>
                    {a.motivo === 'responsable' ? 'Usted es el responsable' : 'Como administrador'}
                  </Badge>
                </div>
              </Group>
              {editando !== a.code && (
                <Button variant='light' onClick={() => abrir(a)}>
                  Editar avatar
                </Button>
              )}
            </Group>

            {editando === a.code && config && (
              <Stack gap='md' mt='md'>
                <AvatarEditor
                  config={config}
                  onChange={setConfig}
                  tiposPermitidos={[...AVATAR_KINDS]}
                  nombreArchivo={`avatar-${a.code}`}
                />
                <Group justify='flex-end'>
                  <Button variant='subtle' color='gray' onClick={() => setEditando(null)} disabled={!!ocupado}>
                    Cancelar
                  </Button>
                  {!!a.config && (
                    <Button variant='default' onClick={() => void quitar(a)} loading={ocupado === 'quitar'}>
                      Quitar avatar
                    </Button>
                  )}
                  <Button onClick={() => void guardar(a)} loading={ocupado === 'guardar'}>
                    Guardar avatar de {a.displayName}
                  </Button>
                </Group>
              </Stack>
            )}
          </Card>
        ))}
      </Stack>
    </Card>
  );
}
