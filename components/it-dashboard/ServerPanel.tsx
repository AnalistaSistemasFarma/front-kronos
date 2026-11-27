'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Paper,
  Progress,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  IconActivity,
  IconAlertCircle,
  IconCheck,
  IconCpu,
  IconDatabase,
  IconDeviceFloppy,
  IconEdit,
  IconNetwork,
  IconX,
} from '@tabler/icons-react';
import type { ItAssetListItem } from '../../lib/it-dashboard/db';
import {
  EMPTY_NETWORK,
  NETWORK_FIELD_LIMITS,
  type ServerNetwork,
  type ServerNetworkInput,
  type ServerPerformance,
} from '../../lib/it-dashboard/server';
import { text } from './assetFormat';

type ServerInfo = { network: ServerNetwork; performance: ServerPerformance };
type FieldErrors = Partial<Record<keyof ServerNetworkInput, string>>;

const NETWORK_FIELDS: Array<{ key: keyof ServerNetworkInput; label: string; placeholder: string }> = [
  { key: 'hostname', label: 'Nombre del equipo (hostname)', placeholder: 'SRV-APP01' },
  { key: 'ipAddress', label: 'Dirección IP', placeholder: '192.168.1.10' },
  { key: 'subnetMask', label: 'Máscara de red', placeholder: '255.255.255.0' },
  { key: 'gateway', label: 'Puerta de enlace', placeholder: '192.168.1.1' },
  { key: 'dnsServers', label: 'Servidores DNS', placeholder: '8.8.8.8, 1.1.1.1' },
  { key: 'vlan', label: 'VLAN', placeholder: '10' },
  { key: 'macAddress', label: 'Dirección MAC', placeholder: 'AA:BB:CC:DD:EE:FF' },
];

function usageColor(pct: number | null): string {
  if (pct == null) return 'gray';
  if (pct >= 90) return 'red';
  if (pct >= 75) return 'orange';
  return 'teal';
}

const pctText = (v: number | null) => (v == null ? '—' : `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(v)} %`);

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Bogota',
  }).format(new Date(iso));
}

function SectionTitle({ icon: Icon, children }: { icon: typeof IconCpu; children: ReactNode }) {
  return (
    <Group gap='xs'>
      <ThemeIcon variant='light' size='sm' radius='md'>
        <Icon size={14} />
      </ThemeIcon>
      <Title order={6}>{children}</Title>
    </Group>
  );
}

function UsageBar({ label, value, hint }: { label: string; value: number | null; hint?: string }) {
  return (
    <Stack gap={4}>
      <Group justify='space-between' gap='xs'>
        <Text size='sm' fw={500}>
          {label}
        </Text>
        <Text size='sm' fw={700} c={usageColor(value)}>
          {pctText(value)}
        </Text>
      </Group>
      <Progress value={value ?? 0} color={usageColor(value)} size='lg' radius='xl' aria-label={`${label}: ${pctText(value)}`} />
      {hint ? (
        <Text size='xs' c='dimmed'>
          {hint}
        </Text>
      ) : null}
    </Stack>
  );
}

function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Stack gap={0} style={{ minWidth: 0 }}>
      <Text size='xs' c='dimmed' tt='uppercase' fw={600}>
        {label}
      </Text>
      <Text size='sm' style={{ wordBreak: 'break-word' }} component='div'>
        {value}
      </Text>
    </Stack>
  );
}

/**
 * Right-hand banner of the asset detail window for servers: capacity (from the
 * asset), performance (latest metrics of the host) and editable network data.
 */
export default function ServerPanel({ asset }: { asset: ItAssetListItem }) {
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ServerNetworkInput>(EMPTY_NETWORK);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEditing(false);
    setSaved(false);
    fetch(`/api/it-dashboard/assets/${asset.id}/server`, { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? 'No se pudo cargar la información del servidor.');
        if (!cancelled) setInfo(json as ServerInfo);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo conectar con el servidor.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [asset.id]);

  const startEdit = () => {
    const n = info?.network ?? EMPTY_NETWORK;
    setForm({
      hostname: n.hostname,
      ipAddress: n.ipAddress,
      subnetMask: n.subnetMask,
      gateway: n.gateway,
      dnsServers: n.dnsServers,
      vlan: n.vlan,
      macAddress: n.macAddress,
      notes: n.notes,
    });
    setFieldErrors({});
    setSaved(false);
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await fetch(`/api/it-dashboard/assets/${asset.id}/server`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.fields) setFieldErrors(json.fields as FieldErrors);
        throw new Error(json.error ?? 'No se pudieron guardar los datos de red.');
      }
      setInfo(json as ServerInfo);
      setEditing(false);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo conectar con el servidor.');
    } finally {
      setSaving(false);
    }
  };

  const perf = info?.performance;
  const net = info?.network;
  const memTotalGb = perf?.memTotalMb != null ? Math.round((perf.memTotalMb / 1024) * 10) / 10 : null;

  return (
    <Paper
      withBorder
      radius='md'
      p='md'
      h='100%'
      style={{ background: 'color-mix(in srgb, var(--mantine-color-blue-filled) 5%, var(--mantine-color-body))' }}
    >
      <Stack gap='md'>
        <Group justify='space-between' wrap='nowrap'>
          <Title order={5}>Servidor</Title>
          {perf ? (
            <Badge variant='light' color={perf.state === 'live' ? 'teal' : perf.state === 'stale' ? 'orange' : 'gray'}>
              {perf.state === 'live' ? 'En línea' : perf.state === 'stale' ? 'Sin reporte reciente' : 'Sin monitoreo'}
            </Badge>
          ) : null}
        </Group>

        {error ? (
          <Alert icon={<IconAlertCircle size={18} />} color='red' variant='light' title='Error'>
            {error}
          </Alert>
        ) : null}
        {saved ? (
          <Alert icon={<IconCheck size={18} />} color='teal' variant='light' withCloseButton onClose={() => setSaved(false)}>
            Datos de red guardados.
          </Alert>
        ) : null}

        {/* Capacity: what the asset has */}
        <Stack gap='sm'>
          <SectionTitle icon={IconDatabase}>Capacidad</SectionTitle>
          <SimpleGrid cols={2} spacing='sm' verticalSpacing='xs'>
            <KeyValue label='Procesador' value={text(asset.processor)} />
            <KeyValue label='RAM instalada' value={text(asset.ram)} />
            <KeyValue label='Almacenamiento' value={text(asset.storage)} />
            <KeyValue label='Sistema operativo' value={text(asset.os)} />
            {memTotalGb != null ? <KeyValue label='RAM detectada' value={`${memTotalGb} GB`} /> : null}
          </SimpleGrid>
        </Stack>

        <Divider />

        {/* Performance: latest metrics of the host */}
        <Stack gap='sm'>
          <SectionTitle icon={IconActivity}>Rendimiento</SectionTitle>
          {loading ? (
            <Skeleton height={110} />
          ) : !perf || perf.state === 'none' ? (
            <Text size='sm' c='dimmed'>
              {net?.hostname
                ? `No hay métricas para «${net.hostname}». Hoy reportan rendimiento los servidores que tienen el recolector de métricas de SynerLink.`
                : 'Registre el nombre del equipo (hostname) en Datos de red para enlazar las métricas del servidor.'}
            </Text>
          ) : (
            <Stack gap='sm'>
              <UsageBar
                label='CPU'
                value={perf.cpuPct}
                hint={`Últimas 24 h: promedio ${pctText(perf.cpuAvg24h)} · pico ${pctText(perf.cpuMax24h)}`}
              />
              <UsageBar
                label='Memoria'
                value={perf.memPct}
                hint={`Últimas 24 h: promedio ${pctText(perf.memAvg24h)} · pico ${pctText(perf.memMax24h)}`}
              />
              <Text size='xs' c='dimmed'>
                Equipo {perf.host} · última medición {formatDateTime(perf.lastSampleAt)}
              </Text>
            </Stack>
          )}
        </Stack>

        <Divider />

        {/* Network data: editable */}
        <Stack gap='sm'>
          <Group justify='space-between' wrap='nowrap'>
            <SectionTitle icon={IconNetwork}>Datos de red</SectionTitle>
            {!editing && !loading ? (
              <Button size='xs' variant='light' leftSection={<IconEdit size={14} />} onClick={startEdit}>
                Editar
              </Button>
            ) : null}
          </Group>

          {loading ? (
            <Skeleton height={140} />
          ) : editing ? (
            <Stack gap='xs'>
              {NETWORK_FIELDS.map((f) => (
                <TextInput
                  key={f.key}
                  size='xs'
                  label={f.label}
                  placeholder={f.placeholder}
                  value={form[f.key]}
                  maxLength={NETWORK_FIELD_LIMITS[f.key]}
                  error={fieldErrors[f.key]}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setForm((cur) => ({ ...cur, [f.key]: value }));
                  }}
                />
              ))}
              <Textarea
                size='xs'
                label='Observaciones'
                placeholder='Puertos, servicios, acceso remoto…'
                autosize
                minRows={2}
                maxRows={5}
                value={form.notes}
                maxLength={NETWORK_FIELD_LIMITS.notes}
                error={fieldErrors.notes}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  setForm((cur) => ({ ...cur, notes: value }));
                }}
              />
              <Group justify='flex-end' gap='xs' mt='xs'>
                <Button size='xs' variant='default' leftSection={<IconX size={14} />} onClick={() => setEditing(false)} disabled={saving}>
                  Cancelar
                </Button>
                <Button size='xs' leftSection={<IconDeviceFloppy size={14} />} onClick={() => void save()} loading={saving}>
                  Guardar
                </Button>
              </Group>
            </Stack>
          ) : (
            <Stack gap='xs'>
              <SimpleGrid cols={2} spacing='sm' verticalSpacing='xs'>
                {NETWORK_FIELDS.map((f) => (
                  <KeyValue key={f.key} label={f.label} value={text(net?.[f.key])} />
                ))}
              </SimpleGrid>
              <KeyValue label='Observaciones' value={text(net?.notes)} />
              {net?.updatedAt ? (
                <Text size='xs' c='dimmed'>
                  Actualizado {formatDateTime(net.updatedAt)}
                  {net.updatedBy ? ` por ${net.updatedBy}` : ''}
                </Text>
              ) : null}
            </Stack>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}
