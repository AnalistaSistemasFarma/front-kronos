'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Group, Loader, Select, Stack, Text, Title } from '@mantine/core';
import { IconAccessible, IconAlertTriangle, IconHome } from '@tabler/icons-react';

type Resultado = { tipo: 'ok' | 'error'; mensaje: string };

interface StartPageOption {
  url: string;
  label: string;
  group: string;
}

const AUTOMATIC = '__automatico__';

/**
 * Perfil → Accesibilidad: qué página se abre primero al entrar a SynerLink.
 * Se guarda en el servidor (GET/PUT /api/profile/start-page) y dura hasta que la cambies.
 */
export default function StartPageSection({ onResultado }: { onResultado: (r: Resultado) => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [available, setAvailable] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [options, setOptions] = useState<StartPageOption[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [value, setValue] = useState<string>(AUTOMATIC);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/profile/start-page', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo cargar la página de inicio');
      setAvailable(Boolean(data.available));
      setOptions(Array.isArray(data.options) ? data.options : []);
      setSaved(data.current ?? null);
      setValue(data.current ?? AUTOMATIC);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const data = useMemo(() => {
    const groups = new Map<string, Array<{ value: string; label: string }>>();
    for (const o of options) {
      const list = groups.get(o.group) ?? [];
      list.push({ value: o.url, label: o.label });
      groups.set(o.group, list);
    }
    return [
      {
        group: 'Automático',
        items: [{ value: AUTOMATIC, label: 'Automático (como SynerLink decida)' }],
      },
      ...[...groups.entries()].map(([group, items]) => ({ group, items })),
    ];
  }, [options]);

  const savedLabel = saved ? options.find((o) => o.url === saved)?.label ?? saved : null;
  const dirty = (value === AUTOMATIC ? null : value) !== saved;

  const save = async () => {
    setSaving(true);
    try {
      const url = value === AUTOMATIC ? null : value;
      const res = await fetch('/api/profile/start-page', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'No se pudo guardar la página de inicio');
      setSaved(url);
      onResultado({
        tipo: 'ok',
        mensaje: url
          ? 'Listo: esa será tu página de inicio cada vez que entres.'
          : 'Listo: volviste al inicio automático.',
      });
    } catch (err) {
      onResultado({ tipo: 'error', mensaje: err instanceof Error ? err.message : 'Error inesperado' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card withBorder padding='lg' radius='md'>
      <Title order={3} mb='md'>
        <Group gap='xs'>
          <IconAccessible size={20} />
          Accesibilidad
        </Group>
      </Title>

      <Stack gap='sm'>
        <div>
          <Text fw={600}>
            <Group gap={6} component='span'>
              <IconHome size={16} />
              Página de inicio
            </Group>
          </Text>
          <Text size='sm' c='dimmed'>
            Elige qué se abre primero cuando entras a SynerLink. Se queda guardado hasta que lo
            cambies. Si algún día pierdes acceso a esa página, entrarás con el inicio automático.
          </Text>
        </div>

        {loading ? (
          <Group gap='xs'>
            <Loader size='xs' />
            <Text size='sm' c='dimmed'>
              Cargando tus módulos...
            </Text>
          </Group>
        ) : loadError ? (
          <Alert color='red' variant='light' icon={<IconAlertTriangle size={16} />}>
            {loadError}
            <Button size='xs' variant='light' color='red' mt='xs' onClick={() => void load()}>
              Reintentar
            </Button>
          </Alert>
        ) : !available ? (
          <Alert color='yellow' variant='light' icon={<IconAlertTriangle size={16} />}>
            Esta opción aún no está disponible. Mientras tanto entras con el inicio automático.
          </Alert>
        ) : (
          <>
            <Select
              label='Al entrar, abrir'
              data={data}
              value={value}
              onChange={(v) => setValue(v ?? AUTOMATIC)}
              allowDeselect={false}
              searchable
              nothingFoundMessage='No encontramos ese módulo'
              maxDropdownHeight={320}
              leftSection={<IconHome size={16} />}
            />
            <Group justify='space-between' wrap='wrap'>
              <Text size='xs' c='dimmed'>
                Ahora: {savedLabel ?? 'Automático'}
              </Text>
              <Button onClick={() => void save()} loading={saving} disabled={!dirty}>
                Guardar página de inicio
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Card>
  );
}
