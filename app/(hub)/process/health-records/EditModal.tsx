'use client';

import React, { useState, useEffect } from 'react';
import {
  Modal, Select, TextInput, Textarea, Button, Group, Stack, Alert, NumberInput, SimpleGrid, Badge, Text,
  Checkbox, Divider, Paper, ScrollArea,
} from '@mantine/core';
import { IconMessagePlus, IconSpeakerphone } from '@tabler/icons-react';
import {
  PAISES,
  ESTADOS,
  OBSOLETO,
  DATE_FIELDS,
  AUTO_LOG_PREFIX,
  OBSERVATION_MAX_LENGTH,
  type HealthRecordLog,
} from '../../../../lib/health-records/fields';

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
  logs?: HealthRecordLog[];
  [key: string]: unknown;
}

interface Props {
  record: HealthRecord | null;
  canWrite: boolean;
  onClose: () => void;
  onUpdated: (notifyWarning?: string) => void;
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

  const [addingObs, setAddingObs] = useState(false);
  const [observacion, setObservacion] = useState('');
  const [notifyObs, setNotifyObs] = useState(false);
  const [savingObs, setSavingObs] = useState(false);

  const [divulging, setDivulging] = useState(false);
  const [divulged, setDivulged] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (record) {
      const initial = fromRecord(record);
      setForm(initial);
      setOriginal(initial);
      setComentario('');
      setError(null);
      setAddingObs(false);
      setObservacion('');
      setNotifyObs(false);
      setDivulged(false);
      setSuccess(null);
    }
  }, [record]);

  const busy = saving || savingObs || divulging;

  const close = () => {
    if (divulged) onUpdated();
    onClose();
  };

  const divulgar = async () => {
    if (!record) return;
    setError(null);
    setSuccess(null);
    if (
      !window.confirm(
        `¿Enviar a divulgar el registro sanitario ${record.U_Registro_Sanitario ?? ''}? ` +
          'Se enviará un correo a la lista de divulgación de la empresa.'
      )
    ) {
      return;
    }

    setDivulging(true);
    try {
      const res = await fetch('/api/health-records/divulge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: record.companyId, docNum: record.DocNum }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No se pudo enviar la divulgación');
        return;
      }
      setDivulged(true);
      setSuccess(
        data.logWarning
          ? `Divulgación enviada. ${data.logWarning}`
          : 'Divulgación enviada. Quedó registrada en la bitácora.'
      );
    } catch {
      setError('Error de red al enviar la divulgación');
    } finally {
      setDivulging(false);
    }
  };

  const set = (field: string, value: string) => setForm((r) => ({ ...r, [field]: value }));

  const logs = [...(record?.logs ?? [])].reverse();

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
          ? 'Debe modificar al menos un campo para guardar. Para dejar solo un comentario use "Añadir observación".'
          : 'No hay cambios para guardar.'
      );
      return;
    }

    if (
      (original.U_Obsoleto ?? '').toUpperCase() !== 'SI' &&
      (changes.U_Obsoleto ?? '').toUpperCase() === 'SI' &&
      !window.confirm(
        `Va a marcar el registro sanitario ${record.U_Registro_Sanitario ?? ''} como OBSOLETO. ` +
          'Se notificará la obsolescencia por correo. ¿Desea continuar?'
      )
    ) {
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
      onUpdated(data.notifyWarning);
      onClose();
    } catch {
      setError('Error de red al actualizar el registro');
    } finally {
      setSaving(false);
    }
  };

  const submitObservation = async () => {
    if (!record) return;
    setError(null);
    const texto = observacion.trim();
    if (!texto) {
      setError('Escriba la observación.');
      return;
    }

    setSavingObs(true);
    try {
      const res = await fetch('/api/health-records/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: record.companyId,
          docNum: record.DocNum,
          comentario: texto,
          notify: notifyObs,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No se pudo agregar la observación');
        return;
      }
      onUpdated(data.notifyWarning);
      onClose();
    } catch {
      setError('Error de red al agregar la observación');
    } finally {
      setSavingObs(false);
    }
  };

  return (
    <Modal
      opened={!!record}
      onClose={close}
      title={canWrite ? 'Editar registro sanitario' : 'Detalle del registro'}
      size="lg"
    >
      {record && (
        <Stack gap="sm">
          {error && <Alert color="red">{error}</Alert>}
          {success && (
            <Alert color="green" withCloseButton onClose={() => setSuccess(null)}>
              {success}
            </Alert>
          )}

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
            <Textarea label="Comentario (queda en la bitácora junto con los cambios)" value={comentario} onChange={(e) => setComentario(e.currentTarget.value)} minRows={2} />
          )}

          <Group justify="space-between" mt="sm">
            {canWrite ? (
              <Button
                variant="light"
                color="teal"
                leftSection={<IconSpeakerphone size={16} />}
                onClick={divulgar}
                loading={divulging}
                disabled={saving || savingObs}
              >
                Enviar a divulgar
              </Button>
            ) : (
              <span />
            )}
            <Group gap="xs">
              <Button variant="default" onClick={close} disabled={busy}>
                {canWrite ? 'Cancelar' : 'Cerrar'}
              </Button>
              {canWrite && <Button onClick={submit} loading={saving} disabled={savingObs || divulging}>Guardar</Button>}
            </Group>
          </Group>

          <Divider label="Bitácora" labelPosition="left" mt="xs" />

          {canWrite && !addingObs && (
            <Group>
              <Button
                variant="light"
                size="xs"
                leftSection={<IconMessagePlus size={14} />}
                onClick={() => setAddingObs(true)}
                disabled={saving}
              >
                Añadir observación
              </Button>
            </Group>
          )}

          {canWrite && addingObs && (
            <Paper withBorder radius="sm" p="sm">
              <Stack gap="xs">
                <Textarea
                  label="Observación"
                  placeholder="Escriba la observación"
                  value={observacion}
                  onChange={(e) => setObservacion(e.currentTarget.value)}
                  maxLength={OBSERVATION_MAX_LENGTH}
                  minRows={3}
                  autosize
                  description={`${observacion.length}/${OBSERVATION_MAX_LENGTH}`}
                  autoFocus
                />
                <Checkbox
                  label="¿Notificar por email?"
                  checked={notifyObs}
                  onChange={(e) => setNotifyObs(e.currentTarget.checked)}
                />
                <Group justify="flex-end" gap="xs">
                  <Button
                    variant="default"
                    size="xs"
                    onClick={() => {
                      setAddingObs(false);
                      setObservacion('');
                      setNotifyObs(false);
                    }}
                    disabled={savingObs}
                  >
                    Cancelar
                  </Button>
                  <Button size="xs" onClick={submitObservation} loading={savingObs} disabled={saving}>
                    Añadir observación
                  </Button>
                </Group>
              </Stack>
            </Paper>
          )}

          {logs.length === 0 ? (
            <Text size="sm" c="dimmed">Sin observaciones registradas.</Text>
          ) : (
            <ScrollArea.Autosize mah={260}>
              <Stack gap={6}>
                {logs.map((log, i) => {
                  const texto = log.U_RegSan_Com ?? '';
                  const automatico = texto.startsWith(AUTO_LOG_PREFIX);
                  return (
                    <Paper key={i} withBorder radius="sm" px="sm" py={6}>
                      <Group gap="xs" wrap="nowrap">
                        <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                          {(log.U_RegSan_Fec ?? '').slice(0, 10)}
                        </Text>
                        <Text size="xs" fw={600} truncate>
                          {log.U_RegSan_Nom || '-'}
                        </Text>
                        {automatico && (
                          <Badge size="xs" variant="light" color="gray">Cambio</Badge>
                        )}
                      </Group>
                      <Text
                        size="sm"
                        c={automatico ? 'dimmed' : undefined}
                        style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                      >
                        {texto}
                      </Text>
                    </Paper>
                  );
                })}
              </Stack>
            </ScrollArea.Autosize>
          )}
        </Stack>
      )}
    </Modal>
  );
}
