'use client';

import React, { useState, useEffect } from 'react';
import {
  Modal, Select, TextInput, Textarea, Button, Group, Stack, Alert, NumberInput, SimpleGrid, Badge, Text,
} from '@mantine/core';
import { PAISES, ESTADOS, OBSOLETO, DATE_FIELDS } from '../../../../lib/health-records/fields';

export interface HealthRecord {
  companyId: number;
  companyName: string;
  DocNum?: number;
  U_Registro_Sanitario?: string;
  U_Referencia?: string;
  U_Descripcion?: string;
  U_Pais?: string;
  U_Titular?: string;
  U_Fecha_Vencimiento?: string;
  U_Estado_Comercializacion?: string;
  [key: string]: unknown;
}

interface Props {
  record: HealthRecord | null;
  canWrite: boolean;
  onClose: () => void;
  onUpdated: () => void;
}

/** Los 16 campos U_* editables (mismos que CreateModal). */
const FIELDS = [
  'U_Referencia',
  'U_Descripcion',
  'U_Pais',
  'U_Registro_Sanitario',
  'U_Vida_Util',
  'U_Fecha_Creacion',
  'U_Fecha_Actualizacion',
  'U_Fecha_Vencimiento',
  'U_Codigo_IUM',
  'U_Codigo_CUM',
  'U_Fabricante',
  'U_Titular',
  'U_Estado_Entrada',
  'U_Estado_Comercializacion',
  'U_Obsoleto',
  'U_SEND_Link',
] as const;

type FormState = Record<string, string>;

function fromRecord(record: HealthRecord): FormState {
  const form: FormState = {};
  for (const f of FIELDS) {
    const raw = record[f];
    let value = raw == null ? '' : String(raw);
    if (DATE_FIELDS.includes(f)) value = value.slice(0, 10);
    form[f] = value;
  }
  return form;
}

export default function EditModal({ record, canWrite, onClose, onUpdated }: Props) {
  const [form, setForm] = useState<FormState>({});
  const [original, setOriginal] = useState<FormState>({});
  const [comentario, setComentario] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (record) {
      const initial = fromRecord(record);
      setForm(initial);
      setOriginal(initial);
      setComentario('');
      setError(null);
    }
  }, [record]);

  const set = (field: string, value: string) => setForm((r) => ({ ...r, [field]: value }));

  const submit = async () => {
    if (!record) return;
    setError(null);

    const changes: Record<string, string> = {};
    for (const f of FIELDS) {
      if (f === 'U_Registro_Sanitario') continue; // clave de negocio, no editable
      if ((form[f] ?? '') !== (original[f] ?? '')) changes[f] = form[f] ?? '';
    }

    if (Object.keys(changes).length === 0) {
      setError(
        comentario.trim()
          ? 'Debe modificar al menos un campo para guardar (el comentario solo no basta).'
          : 'No hay cambios para guardar.'
      );
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/health-records/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: record.companyId,
          docNum: record.DocNum,
          changes,
          comentario,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No se pudo actualizar el registro');
        return;
      }
      onUpdated();
      onClose();
    } catch {
      setError('Error de red al actualizar el registro');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      opened={!!record}
      onClose={onClose}
      title={canWrite ? 'Editar registro sanitario' : 'Detalle del registro'}
      size="lg"
    >
      {record && (
        <Stack gap="sm">
          {error && <Alert color="red">{error}</Alert>}

          <Group gap="xs">
            <Text size="sm" fw={500}>Empresa:</Text>
            <Badge variant="light">{record.companyName}</Badge>
          </Group>

          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label="Registro Sanitario" value={form.U_Registro_Sanitario ?? ''} disabled />
            <TextInput label="Referencia" value={form.U_Referencia ?? ''} onChange={(e) => set('U_Referencia', e.currentTarget.value)} disabled={!canWrite} />
            <TextInput label="Descripcion" value={form.U_Descripcion ?? ''} onChange={(e) => set('U_Descripcion', e.currentTarget.value)} disabled={!canWrite} />
            <Select label="Pais" data={PAISES} value={form.U_Pais ?? ''} onChange={(v) => set('U_Pais', v ?? '')} disabled={!canWrite} />
            <NumberInput label="Vida util (meses)" value={form.U_Vida_Util === '' || form.U_Vida_Util == null ? '' : Number(form.U_Vida_Util)} onChange={(v) => set('U_Vida_Util', String(v ?? ''))} min={0} disabled={!canWrite} />
            <TextInput label="Fecha creacion" type="date" value={form.U_Fecha_Creacion ?? ''} onChange={(e) => set('U_Fecha_Creacion', e.currentTarget.value)} disabled={!canWrite} />
            <TextInput label="Fecha actualizacion" type="date" value={form.U_Fecha_Actualizacion ?? ''} onChange={(e) => set('U_Fecha_Actualizacion', e.currentTarget.value)} disabled={!canWrite} />
            <TextInput label="Fecha vencimiento" type="date" value={form.U_Fecha_Vencimiento ?? ''} onChange={(e) => set('U_Fecha_Vencimiento', e.currentTarget.value)} disabled={!canWrite} />
            <TextInput label="Codigo CUM" value={form.U_Codigo_CUM ?? ''} onChange={(e) => set('U_Codigo_CUM', e.currentTarget.value)} disabled={!canWrite} />
            <TextInput label="Codigo IUM" value={form.U_Codigo_IUM ?? ''} onChange={(e) => set('U_Codigo_IUM', e.currentTarget.value)} disabled={!canWrite} />
            <TextInput label="Titular" value={form.U_Titular ?? ''} onChange={(e) => set('U_Titular', e.currentTarget.value)} disabled={!canWrite} />
            <TextInput label="Fabricante" value={form.U_Fabricante ?? ''} onChange={(e) => set('U_Fabricante', e.currentTarget.value)} disabled={!canWrite} />
            <Select label="Estado entrada" data={ESTADOS} value={form.U_Estado_Entrada ?? ''} onChange={(v) => set('U_Estado_Entrada', v ?? '')} disabled={!canWrite} />
            <Select label="Estado comercializacion" data={ESTADOS} value={form.U_Estado_Comercializacion ?? ''} onChange={(v) => set('U_Estado_Comercializacion', v ?? '')} disabled={!canWrite} />
            <Select label="Obsoleto" data={OBSOLETO} value={form.U_Obsoleto ?? ''} onChange={(v) => set('U_Obsoleto', v ?? '')} disabled={!canWrite} />
            <TextInput label="Enlace archivo" value={form.U_SEND_Link ?? ''} onChange={(e) => set('U_SEND_Link', e.currentTarget.value)} disabled={!canWrite} />
          </SimpleGrid>

          {canWrite && (
            <Textarea label="Comentario (queda en la bitacora)" value={comentario} onChange={(e) => setComentario(e.currentTarget.value)} minRows={2} />
          )}

          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={onClose} disabled={saving}>
              {canWrite ? 'Cancelar' : 'Cerrar'}
            </Button>
            {canWrite && <Button onClick={submit} loading={saving}>Guardar</Button>}
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
