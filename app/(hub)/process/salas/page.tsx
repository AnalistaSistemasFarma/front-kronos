'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Breadcrumbs,
  Button,
  Card,
  Flex,
  Group,
  Loader,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconCalendarEvent,
  IconCalendarPlus,
  IconCheck,
  IconChevronRight,
  IconDoor,
  IconLock,
  IconRefresh,
  IconRepeat,
  IconTrash,
} from '@tabler/icons-react';
import BookingDrawer, { type RoomOption } from '../../../../components/rooms/BookingDrawer';
import { formatTime12h } from '../../../../lib/rooms/dates';

/**
 * Rooms module (/process/salas): daily occupancy of the meeting rooms,
 * bookings (single and recurring) and cancellation. Replaces the
 * salas.gsslatam.com dashboard using SynerLink login and permissions.
 *
 * Permissions (lib/rooms/permissions.ts): '/process/salas' view,
 * '/process/salas/reservar' book and cancel own, '/process/salas/admin'
 * cancel others'. Graph only runs on the server (app/api/rooms/**).
 * The URL stays in Spanish because it is the menu route users see.
 */

type Level = 'view' | 'book' | 'admin';

interface ModuleConfig {
  level: Level | null;
  configured?: boolean;
  readOnly?: boolean;
  readOnlyMessage?: string;
  today?: string;
  rooms?: RoomOption[];
}

interface RoomEvent {
  id: string;
  startTime: string;
  endTime: string;
  subject: string;
  organizer: string | null;
  isPrivate: boolean;
  isSeries: boolean;
  cancellable: boolean;
}

interface RoomOccupancy {
  id: string;
  name: string;
  events: RoomEvent[];
  error: string | null;
}

interface Notice {
  color: 'green' | 'red' | 'yellow';
  text: string;
}

interface PendingCancel {
  room: RoomOccupancy;
  event: RoomEvent;
}

function longDate(date: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

/** Is the meeting happening right now? (today only) */
function isOngoing(e: RoomEvent, isToday: boolean): boolean {
  if (!isToday) return false;
  const now = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Bogota',
  }).format(new Date());
  return e.startTime <= now && now < e.endTime;
}

export default function RoomsPage() {
  const { data: session } = useSession();
  const [config, setConfig] = useState<ModuleConfig | null>(null);
  const [date, setDate] = useState('');
  const [occupancy, setOccupancy] = useState<RoomOccupancy[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [drawer, setDrawer] = useState<{ open: boolean; room: string | null }>({ open: false, room: null });
  const [pendingCancel, setPendingCancel] = useState<PendingCancel | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        const res = await fetch('/api/rooms/config', { cache: 'no-store' });
        if (!res.ok) throw new Error('No se pudo verificar el acceso al módulo.');
        const json = (await res.json()) as ModuleConfig;
        setConfig(json);
        if (json.today) setDate(json.today);
        if (!json.level) setLoading(false);
      } catch (err) {
        setConfig({ level: null });
        setNotice({ color: 'red', text: err instanceof Error ? err.message : 'Error inesperado.' });
        setLoading(false);
      }
    })();
  }, [session]);

  const load = useCallback(async (day: string) => {
    if (!day) return;
    setRefreshing(true);
    try {
      const res = await fetch(`/api/rooms/occupancy?date=${encodeURIComponent(day)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'No se pudo cargar la ocupación.');
      setOccupancy(json.rooms ?? []);
    } catch (err) {
      setNotice({ color: 'red', text: err instanceof Error ? err.message : 'Error inesperado.' });
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (config?.level && config.configured && date) void load(date);
    else if (config?.level && config.configured === false) setLoading(false);
  }, [config, date, load]);

  const confirmCancel = async (scope: 'day' | 'series') => {
    if (!pendingCancel) return;
    setCancelling(true);
    try {
      const q = new URLSearchParams({ room: pendingCancel.room.id, date, scope });
      const res = await fetch(`/api/rooms/bookings/${encodeURIComponent(pendingCancel.event.id)}?${q}`, {
        method: 'DELETE',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ color: res.status === 423 ? 'yellow' : 'red', text: json.error ?? 'No se pudo cancelar.' });
      } else {
        setNotice({
          color: 'green',
          text: scope === 'series' ? 'Se canceló toda la serie.' : 'Se canceló la reunión de este día.',
        });
        void load(date);
      }
    } catch {
      setNotice({ color: 'red', text: 'No se pudo conectar con el servidor.' });
    } finally {
      setCancelling(false);
      setPendingCancel(null);
    }
  };

  const breadcrumbItems = [
    { title: 'Procesos', href: '/process' },
    { title: 'Salas', href: '#' },
  ].map((item, index) =>
    item.href !== '#' ? (
      <Link key={index} href={item.href} passHref>
        <Anchor component="span" size="sm">
          {item.title}
        </Anchor>
      </Link>
    ) : (
      <Text key={index} component="span" size="sm" c="dimmed">
        {item.title}
      </Text>
    )
  );

  if (!config || (loading && config.level && occupancy.length === 0 && !notice)) {
    return (
      <Group justify="center" mt="xl">
        <Loader />
      </Group>
    );
  }

  if (!config.level) {
    return (
      <Alert color="red" title="Salas" mt="md">
        {notice?.text ?? 'No tiene acceso a este módulo.'}
      </Alert>
    );
  }

  const userCanBook = config.level === 'book' || config.level === 'admin';
  const today = config.today ?? date;
  const isToday = date === today;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <Card shadow="sm" p="xl" radius="md" withBorder mb="md">
          <Breadcrumbs separator={<IconChevronRight size={16} />} className="mb-4">
            {breadcrumbItems}
          </Breadcrumbs>

          <Flex justify="space-between" align="flex-start" wrap="wrap" gap="sm">
            <div>
              <Title order={1} className="text-3xl font-bold mb-2 flex items-center gap-3">
                <IconDoor size={32} className="text-blue-600" />
                Salas de reuniones
              </Title>
              <Text size="lg" c="dimmed">
                Ocupación y reservas de las salas de reuniones
              </Text>
            </div>
            {userCanBook && config.configured && (
              <Button leftSection={<IconCalendarPlus size={18} />} onClick={() => setDrawer({ open: true, room: null })}>
                Reservar
              </Button>
            )}
          </Flex>

          <Group mt="md" gap="sm" align="flex-end" wrap="wrap">
            <TextInput
              type="date"
              label="Fecha"
              value={date}
              onChange={(e) => e.currentTarget.value && setDate(e.currentTarget.value)}
              style={{ minWidth: 170 }}
            />
            <Button variant="light" onClick={() => setDate(today)} disabled={isToday}>
              Hoy
            </Button>
            <Tooltip label="Refrescar">
              <ActionIcon variant="light" size="lg" onClick={() => load(date)} loading={refreshing} aria-label="Refrescar">
                <IconRefresh size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
          {date && (
            <Text size="sm" c="dimmed" mt="xs" tt="capitalize">
              {longDate(date)}
            </Text>
          )}
        </Card>

        {config.readOnly && (
          <Alert color="yellow" icon={<IconLock size={16} />} mb="md" variant="light">
            {config.readOnlyMessage}
          </Alert>
        )}
        {config.configured === false && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />} mb="md" variant="light">
            El módulo de salas no está configurado en este ambiente.
          </Alert>
        )}
        {notice && (
          <Alert
            color={notice.color}
            icon={notice.color === 'green' ? <IconCheck size={16} /> : <IconAlertTriangle size={16} />}
            mb="md"
            variant="light"
            withCloseButton
            onClose={() => setNotice(null)}
          >
            {notice.text}
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {occupancy.map((room) => {
            const busyNow = room.events.some((e) => isOngoing(e, isToday));
            return (
              <Card key={room.id} shadow="sm" radius="md" withBorder p="lg">
                <Group justify="space-between" mb="sm" wrap="nowrap">
                  <Group gap="xs" wrap="nowrap">
                    <IconDoor size={20} />
                    <Text fw={600}>{room.name}</Text>
                  </Group>
                  <Badge color={busyNow ? 'red' : 'green'} variant="light">
                    {busyNow ? 'Ocupada ahora' : isToday ? 'Libre ahora' : `${room.events.length} reuniones`}
                  </Badge>
                </Group>

                {room.error ? (
                  <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
                    {room.error}
                  </Alert>
                ) : room.events.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    Sin reuniones este día.
                  </Text>
                ) : (
                  <Stack gap="xs">
                    {room.events.map((e) => (
                      <Card
                        key={`${e.id}-${e.startTime}`}
                        p="sm"
                        radius="sm"
                        withBorder
                        style={{
                          backgroundColor: isOngoing(e, isToday)
                            ? 'var(--mantine-color-red-light)'
                            : 'var(--mantine-color-default)',
                        }}
                      >
                        <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
                          <div style={{ minWidth: 0 }}>
                            <Text size="sm" fw={600}>
                              {formatTime12h(e.startTime)} – {formatTime12h(e.endTime)}
                            </Text>
                            <Text size="sm" lineClamp={2} c={e.isPrivate ? 'dimmed' : undefined}>
                              {e.isPrivate && <IconLock size={12} style={{ marginRight: 4 }} />}
                              {e.subject}
                            </Text>
                            {e.organizer && (
                              <Text size="xs" c="dimmed" truncate>
                                {e.organizer}
                              </Text>
                            )}
                          </div>
                          <Group gap={4} wrap="nowrap">
                            {e.isSeries && (
                              <Tooltip label="Parte de una serie">
                                <Badge variant="light" color="grape" size="sm" leftSection={<IconRepeat size={12} />}>
                                  Serie
                                </Badge>
                              </Tooltip>
                            )}
                            {e.cancellable && (
                              <Tooltip label="Cancelar">
                                <ActionIcon
                                  variant="subtle"
                                  color="red"
                                  onClick={() => setPendingCancel({ room, event: e })}
                                  aria-label="Cancelar reunión"
                                >
                                  <IconTrash size={16} />
                                </ActionIcon>
                              </Tooltip>
                            )}
                          </Group>
                        </Group>
                      </Card>
                    ))}
                  </Stack>
                )}

                {userCanBook && config.configured && (
                  <Button
                    variant="subtle"
                    size="xs"
                    mt="sm"
                    leftSection={<IconCalendarEvent size={14} />}
                    onClick={() => setDrawer({ open: true, room: room.id })}
                  >
                    Reservar esta sala
                  </Button>
                )}
              </Card>
            );
          })}
        </SimpleGrid>
      </div>

      {userCanBook && config.rooms && (
        <BookingDrawer
          opened={drawer.open}
          onClose={() => setDrawer({ open: false, room: null })}
          rooms={config.rooms}
          today={today}
          initialDate={date}
          initialRoom={drawer.room}
          readOnly={Boolean(config.readOnly)}
          readOnlyMessage={config.readOnlyMessage ?? ''}
          onBooked={(text) => {
            setDrawer({ open: false, room: null });
            setNotice({ color: 'green', text });
            void load(date);
          }}
        />
      )}

      <Modal opened={Boolean(pendingCancel)} onClose={() => setPendingCancel(null)} title="Cancelar reunión" centered>
        {pendingCancel && (
          <Stack gap="sm">
            {config.readOnly && (
              <Alert color="yellow" icon={<IconLock size={16} />} variant="light">
                {config.readOnlyMessage}
              </Alert>
            )}
            <Text size="sm">
              {pendingCancel.room.name} · {formatTime12h(pendingCancel.event.startTime)} –{' '}
              {formatTime12h(pendingCancel.event.endTime)} ·{' '}
              {pendingCancel.event.subject}
            </Text>
            <Group justify="flex-end" gap="sm">
              <Button variant="default" onClick={() => setPendingCancel(null)} disabled={cancelling}>
                Volver
              </Button>
              {pendingCancel.event.isSeries && (
                <Button color="red" variant="light" loading={cancelling} onClick={() => confirmCancel('series')}>
                  Toda la serie
                </Button>
              )}
              <Button color="red" loading={cancelling} onClick={() => confirmCancel('day')}>
                {pendingCancel.event.isSeries ? 'Solo este día' : 'Cancelar reunión'}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </div>
  );
}
