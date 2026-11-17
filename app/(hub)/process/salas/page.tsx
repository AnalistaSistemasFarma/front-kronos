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
import ReservaDrawer, { type SalaUI } from '../../../../components/salas/ReservaDrawer';

/**
 * Módulo de Salas (/process/salas): ocupación del día de las salas de
 * reuniones, reservas (simples y periódicas) y cancelación. Reemplaza el
 * tablero salas.gsslatam.com con el login y los permisos de SynerLink.
 *
 * Permisos (lib/salas/permisos.ts): '/process/salas' ver, '/process/salas/reservar'
 * reservar y cancelar lo propio, '/process/salas/admin' cancelar lo de otros.
 * Graph solo corre en el servidor (app/api/salas/**).
 */

type Nivel = 'ver' | 'reservar' | 'admin';

interface Config {
  nivel: Nivel | null;
  configurado?: boolean;
  soloLectura?: boolean;
  mensajeSoloLectura?: string;
  hoy?: string;
  salas?: SalaUI[];
}

interface EventoSala {
  id: string;
  horaInicio: string;
  horaFin: string;
  asunto: string;
  organizador: string | null;
  privado: boolean;
  serie: boolean;
  cancelable: boolean;
}

interface OcupacionSala {
  id: string;
  nombre: string;
  eventos: EventoSala[];
  error: string | null;
}

interface Aviso {
  color: 'green' | 'red' | 'yellow';
  texto: string;
}

interface PorCancelar {
  sala: OcupacionSala;
  evento: EventoSala;
}

function fechaLarga(fecha: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${fecha}T00:00:00Z`));
}

/** ¿La reunión está ocurriendo ahora? (solo para el día de hoy) */
function enCurso(e: EventoSala, esHoy: boolean): boolean {
  if (!esHoy) return false;
  const ahora = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Bogota',
  }).format(new Date());
  return e.horaInicio <= ahora && ahora < e.horaFin;
}

export default function SalasPage() {
  const { data: session } = useSession();
  const [config, setConfig] = useState<Config | null>(null);
  const [fecha, setFecha] = useState('');
  const [ocupacion, setOcupacion] = useState<OcupacionSala[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [drawer, setDrawer] = useState<{ abierto: boolean; sala: string | null }>({ abierto: false, sala: null });
  const [porCancelar, setPorCancelar] = useState<PorCancelar | null>(null);
  const [cancelando, setCancelando] = useState(false);

  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        const res = await fetch('/api/salas/config', { cache: 'no-store' });
        if (!res.ok) throw new Error('No se pudo verificar el acceso al módulo.');
        const json = (await res.json()) as Config;
        setConfig(json);
        if (json.hoy) setFecha(json.hoy);
        if (!json.nivel) setCargando(false);
      } catch (err) {
        setConfig({ nivel: null });
        setAviso({ color: 'red', texto: err instanceof Error ? err.message : 'Error inesperado.' });
        setCargando(false);
      }
    })();
  }, [session]);

  const cargar = useCallback(async (dia: string) => {
    if (!dia) return;
    setRefrescando(true);
    try {
      const res = await fetch(`/api/salas/ocupacion?fecha=${encodeURIComponent(dia)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'No se pudo cargar la ocupación.');
      setOcupacion(json.salas ?? []);
    } catch (err) {
      setAviso({ color: 'red', texto: err instanceof Error ? err.message : 'Error inesperado.' });
    } finally {
      setRefrescando(false);
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (config?.nivel && config.configurado && fecha) void cargar(fecha);
    else if (config?.nivel && config.configurado === false) setCargando(false);
  }, [config, fecha, cargar]);

  const confirmarCancelacion = async (alcance: 'dia' | 'serie') => {
    if (!porCancelar) return;
    setCancelando(true);
    try {
      const q = new URLSearchParams({ sala: porCancelar.sala.id, fecha, alcance });
      const res = await fetch(`/api/salas/reservas/${encodeURIComponent(porCancelar.evento.id)}?${q}`, {
        method: 'DELETE',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAviso({ color: res.status === 423 ? 'yellow' : 'red', texto: json.error ?? 'No se pudo cancelar.' });
      } else {
        setAviso({
          color: 'green',
          texto: alcance === 'serie' ? 'Se canceló toda la serie.' : 'Se canceló la reunión de este día.',
        });
        void cargar(fecha);
      }
    } catch {
      setAviso({ color: 'red', texto: 'No se pudo conectar con el servidor.' });
    } finally {
      setCancelando(false);
      setPorCancelar(null);
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

  if (!config || (cargando && config.nivel && ocupacion.length === 0 && !aviso)) {
    return (
      <Group justify="center" mt="xl">
        <Loader />
      </Group>
    );
  }

  if (!config.nivel) {
    return (
      <Alert color="red" title="Salas" mt="md">
        {aviso?.texto ?? 'No tiene acceso a este módulo.'}
      </Alert>
    );
  }

  const puedeReservar = config.nivel === 'reservar' || config.nivel === 'admin';
  const hoy = config.hoy ?? fecha;
  const esHoy = fecha === hoy;

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
            {puedeReservar && config.configurado && (
              <Button
                leftSection={<IconCalendarPlus size={18} />}
                onClick={() => setDrawer({ abierto: true, sala: null })}
              >
                Reservar
              </Button>
            )}
          </Flex>

          <Group mt="md" gap="sm" align="flex-end" wrap="wrap">
            <TextInput
              type="date"
              label="Fecha"
              value={fecha}
              onChange={(e) => e.currentTarget.value && setFecha(e.currentTarget.value)}
              style={{ minWidth: 170 }}
            />
            <Button variant="light" onClick={() => setFecha(hoy)} disabled={esHoy}>
              Hoy
            </Button>
            <Tooltip label="Refrescar">
              <ActionIcon
                variant="light"
                size="lg"
                onClick={() => cargar(fecha)}
                loading={refrescando}
                aria-label="Refrescar"
              >
                <IconRefresh size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
          {fecha && (
            <Text size="sm" c="dimmed" mt="xs" tt="capitalize">
              {fechaLarga(fecha)}
            </Text>
          )}
        </Card>

        {config.soloLectura && (
          <Alert color="yellow" icon={<IconLock size={16} />} mb="md" variant="light">
            {config.mensajeSoloLectura}
          </Alert>
        )}
        {config.configurado === false && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />} mb="md" variant="light">
            El módulo de salas no está configurado en este ambiente.
          </Alert>
        )}
        {aviso && (
          <Alert
            color={aviso.color}
            icon={aviso.color === 'green' ? <IconCheck size={16} /> : <IconAlertTriangle size={16} />}
            mb="md"
            variant="light"
            withCloseButton
            onClose={() => setAviso(null)}
          >
            {aviso.texto}
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {ocupacion.map((sala) => (
            <Card key={sala.id} shadow="sm" radius="md" withBorder p="lg">
              <Group justify="space-between" mb="sm" wrap="nowrap">
                <Group gap="xs" wrap="nowrap">
                  <IconDoor size={20} />
                  <Text fw={600}>{sala.nombre}</Text>
                </Group>
                <Badge
                  color={sala.eventos.some((e) => enCurso(e, esHoy)) ? 'red' : 'green'}
                  variant="light"
                >
                  {sala.eventos.some((e) => enCurso(e, esHoy)) ? 'Ocupada ahora' : esHoy ? 'Libre ahora' : `${sala.eventos.length} reuniones`}
                </Badge>
              </Group>

              {sala.error ? (
                <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
                  {sala.error}
                </Alert>
              ) : sala.eventos.length === 0 ? (
                <Text size="sm" c="dimmed">
                  Sin reuniones este día.
                </Text>
              ) : (
                <Stack gap="xs">
                  {sala.eventos.map((e) => (
                    <Card
                      key={`${e.id}-${e.horaInicio}`}
                      p="sm"
                      radius="sm"
                      withBorder
                      style={{
                        backgroundColor: enCurso(e, esHoy)
                          ? 'var(--mantine-color-red-light)'
                          : 'var(--mantine-color-default)',
                      }}
                    >
                      <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
                        <div style={{ minWidth: 0 }}>
                          <Text size="sm" fw={600}>
                            {e.horaInicio} – {e.horaFin}
                          </Text>
                          <Text size="sm" lineClamp={2} c={e.privado ? 'dimmed' : undefined}>
                            {e.privado && <IconLock size={12} style={{ marginRight: 4 }} />}
                            {e.asunto}
                          </Text>
                          {e.organizador && (
                            <Text size="xs" c="dimmed" truncate>
                              {e.organizador}
                            </Text>
                          )}
                        </div>
                        <Group gap={4} wrap="nowrap">
                          {e.serie && (
                            <Tooltip label="Parte de una serie">
                              <Badge variant="light" color="grape" size="sm" leftSection={<IconRepeat size={12} />}>
                                Serie
                              </Badge>
                            </Tooltip>
                          )}
                          {e.cancelable && (
                            <Tooltip label="Cancelar">
                              <ActionIcon
                                variant="subtle"
                                color="red"
                                onClick={() => setPorCancelar({ sala, evento: e })}
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

              {puedeReservar && config.configurado && (
                <Button
                  variant="subtle"
                  size="xs"
                  mt="sm"
                  leftSection={<IconCalendarEvent size={14} />}
                  onClick={() => setDrawer({ abierto: true, sala: sala.id })}
                >
                  Reservar esta sala
                </Button>
              )}
            </Card>
          ))}
        </SimpleGrid>
      </div>

      {puedeReservar && config.salas && (
        <ReservaDrawer
          opened={drawer.abierto}
          onClose={() => setDrawer({ abierto: false, sala: null })}
          salas={config.salas}
          hoy={hoy}
          fechaInicial={fecha}
          salaInicial={drawer.sala}
          soloLectura={Boolean(config.soloLectura)}
          mensajeSoloLectura={config.mensajeSoloLectura ?? ''}
          onReservada={(texto) => {
            setDrawer({ abierto: false, sala: null });
            setAviso({ color: 'green', texto });
            void cargar(fecha);
          }}
        />
      )}

      <Modal
        opened={Boolean(porCancelar)}
        onClose={() => setPorCancelar(null)}
        title="Cancelar reunión"
        centered
      >
        {porCancelar && (
          <Stack gap="sm">
            {config.soloLectura && (
              <Alert color="yellow" icon={<IconLock size={16} />} variant="light">
                {config.mensajeSoloLectura}
              </Alert>
            )}
            <Text size="sm">
              {porCancelar.sala.nombre} · {porCancelar.evento.horaInicio}–{porCancelar.evento.horaFin} ·{' '}
              {porCancelar.evento.asunto}
            </Text>
            <Group justify="flex-end" gap="sm">
              <Button variant="default" onClick={() => setPorCancelar(null)} disabled={cancelando}>
                Volver
              </Button>
              {porCancelar.evento.serie && (
                <Button color="red" variant="light" loading={cancelando} onClick={() => confirmarCancelacion('serie')}>
                  Toda la serie
                </Button>
              )}
              <Button color="red" loading={cancelando} onClick={() => confirmarCancelacion('dia')}>
                {porCancelar.evento.serie ? 'Solo este día' : 'Cancelar reunión'}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </div>
  );
}
