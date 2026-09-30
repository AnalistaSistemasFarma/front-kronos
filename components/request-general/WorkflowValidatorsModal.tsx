'use client';

import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Group, Modal, MultiSelect, Stack, Text } from '@mantine/core';
import { IconCheck, IconGavel, IconUser } from '@tabler/icons-react';
import toast from 'react-hot-toast';

type UserOption = { value: string; label: string };

type Props = {
  opened: boolean;
  onClose: () => void;
  processCategoryId: number;
  users: UserOption[];
  onSaved?: (count: number) => void;
};

/**
 * Personas validadoras de los documentos del flujo. Aquí no hay orden: cada documento
 * tiene el suyo y lo define el preparador en los archivos adjuntos al enviarlo a validación.
 */
export default function WorkflowValidatorsModal({
  opened,
  onClose,
  processCategoryId,
  users,
  onSaved,
}: Props) {
  const [validators, setValidators] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!opened || !processCategoryId) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/requests-general/assign-validator?id_process_category=${processCategoryId}`)
      .then((res) => (res.ok ? res.json() : { validators: [] }))
      .then((data) => {
        if (!cancelled) {
          setValidators(Array.isArray(data.validators) ? data.validators.map(String) : []);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [opened, processCategoryId]);

  const labelOf = (id: string) => users.find((u) => u.value === id)?.label ?? id;

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/requests-general/assign-validator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ validators, id_process_category: processCategoryId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'No se pudieron guardar los validadores');
      }
      const savedCount = typeof data.count === 'number' ? data.count : validators.length;
      toast.success(
        savedCount > 0
          ? `Validadores del flujo guardados (${savedCount}).`
          : 'El flujo ya no requiere validación antes de firmar.'
      );
      onSaved?.(savedCount);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Intente de nuevo');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size='lg'
      radius='lg'
      centered
      overlayProps={{ blur: 4 }}
      title={
        <Group gap='sm'>
          <div className='flex items-center justify-center w-10 h-10 rounded-lg bg-violet-100'>
            <IconGavel size={20} className='text-violet-600' />
          </div>
          <div>
            <Text size='lg' fw={600}>
              Validadores documento
              {validators.length > 0 ? ` (${validators.length})` : ''}
            </Text>
            <Text size='xs' c='dimmed'>
              Personas que pueden validar los documentos de este flujo (p. ej. Jurídica)
            </Text>
          </div>
        </Group>
      }
    >
      <Stack gap='md'>
        <Alert variant='light' color='violet'>
          Aquí solo se eligen las personas habilitadas. El orden no es fijo: en los archivos
          adjuntos de cada solicitud, el preparador elige qué validadores revisan ese documento y en
          qué orden. Primero aprueban los validadores y luego se habilita la firma. Si alguno lo
          devuelve, se sube una versión corregida (nueva subversión) y la validación empieza de nuevo.
        </Alert>

        <MultiSelect
          label='Validadores documento'
          placeholder={loading ? 'Cargando…' : 'Selecciona usuarios'}
          data={users}
          value={validators}
          onChange={setValidators}
          leftSection={<IconUser size={16} />}
          searchable
          clearable
          hidePickedOptions
          disabled={loading}
          nothingFoundMessage='No hay usuarios'
          size='md'
        />

        {validators.length > 0 ? (
          <Group gap={6}>
            {validators.map((id) => (
              <Badge key={id} variant='light' color='violet' leftSection={<IconUser size={12} />}>
                {labelOf(id)}
              </Badge>
            ))}
          </Group>
        ) : (
          !loading && (
            <Text size='sm' c='dimmed'>
              Sin validadores: los documentos de este flujo se pueden preparar y firmar directamente.
            </Text>
          )
        )}

        <Group justify='flex-end' gap='sm' mt='sm'>
          <Button variant='outline' onClick={() => setValidators([])} disabled={loading}>
            Limpiar
          </Button>
          <Button
            leftSection={<IconCheck size={16} />}
            onClick={() => void save()}
            loading={saving}
            disabled={loading}
          >
            Listo
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
