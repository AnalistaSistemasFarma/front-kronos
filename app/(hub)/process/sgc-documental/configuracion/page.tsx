'use client';

import React, { useState } from 'react';
import { Alert, Badge, Button, Card, Checkbox, Group, Loader, Modal, NumberInput, Select, Stack, Table, Tabs, Text, TextInput, Textarea } from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconEdit, IconPlus } from '@tabler/icons-react';
import SgcShell from '../../../../../components/sgc/SgcShell';
import { sgcSend, useSgcFetch } from '../../../../../components/sgc/useSgcFetch';
import { SGC_CODING_TOKENS, buildDocumentCode, validateCodingGuide } from '../../../../../lib/sgc/coding';
import type { SgcCatalogs } from '../../../../../lib/sgc/db/catalogs';
import type { SgcCompanyAccess } from '../../../../../lib/sgc/permissions';

/**
 * CONFIGURACIÓN DEL SGC de la empresa (solo Aseguramiento de Calidad): guía de
 * codificación, tipos de proceso, procesos (con su departamento dueño) y tipos
 * documentales. Es lo configurable por empresa (skill sgc-activar-empresa).
 * Cada cambio exige motivo y queda en la auditoría; nada se borra, se
 * desactiva.
 */

const COLORS = ['blue', 'teal', 'green', 'yellow', 'orange', 'red', 'grape', 'violet', 'indigo', 'cyan', 'gray'];

type Entity = 'process-types' | 'processes' | 'document-types';
type Form = Record<string, string | number | boolean | null>;

function Configuracion({ company }: { company: SgcCompanyAccess }) {
  const catalogs = useSgcFetch<SgcCatalogs>(`/api/sgc/catalogs?company=${company.idCompany}&all=1`);
  const [feedback, setFeedback] = useState<{ color: 'green' | 'red'; text: string } | null>(null);
  const [editing, setEditing] = useState<{ entity: Entity; form: Form } | null>(null);
  const [guide, setGuide] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);

  const data = catalogs.data;
  if (catalogs.error) {
    return (
      <Alert color='red' icon={<IconAlertTriangle size={18} />}>
        {catalogs.error}
      </Alert>
    );
  }
  if (!data) {
    return (
      <Group justify='center' my='xl'>
        <Loader />
      </Group>
    );
  }

  const guideForm: Form = guide ?? {
    prefix: data.codingGuide?.prefix ?? '',
    pattern: data.codingGuide?.pattern ?? '{PREFIJO}-{PROCESO}-{TIPO}-{CONSECUTIVO}',
    sequenceDigits: data.codingGuide?.sequenceDigits ?? 3,
    reason: '',
  };
  const guideInput = { prefix: String(guideForm.prefix), pattern: String(guideForm.pattern), sequenceDigits: Number(guideForm.sequenceDigits) };
  const guideErrors = validateCodingGuide(guideInput);
  const example = guideErrors.length
    ? null
    : buildDocumentCode(guideInput, { processTypeCode: 'M', processCode: 'GC', documentTypeCode: 'PR' }, 1);

  const save = async (entity: Entity | 'coding-guide', form: Form) => {
    setBusy(true);
    setFeedback(null);
    try {
      await sgcSend(`/api/sgc/config/${entity}`, 'POST', { ...form, company: company.idCompany });
      setFeedback({ color: 'green', text: 'Cambio guardado y registrado en la auditoría.' });
      setEditing(null);
      setGuide(null);
      catalogs.reload();
    } catch (e) {
      setFeedback({ color: 'red', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const set = (k: string, v: string | number | boolean | null) => editing && setEditing({ ...editing, form: { ...editing.form, [k]: v } });
  const typeName = (id: number) => data.processTypes.find((t) => t.id === id)?.name ?? '—';

  const activeBadge = (active: boolean) => (
    <Badge size='xs' color={active ? 'green' : 'gray'} variant='light'>
      {active ? 'Activo' : 'Inactivo'}
    </Badge>
  );

  const editButton = (entity: Entity, form: Form) => (
    <Button size='xs' variant='subtle' leftSection={<IconEdit size={14} />} onClick={() => setEditing({ entity, form: { ...form, reason: '' } })}>
      Editar
    </Button>
  );

  return (
    <Stack gap='lg'>
      {feedback && (
        <Alert
          color={feedback.color}
          icon={feedback.color === 'green' ? <IconCheck size={18} /> : <IconAlertTriangle size={18} />}
          withCloseButton
          onClose={() => setFeedback(null)}
          data-testid='sgc-feedback'
        >
          {feedback.text}
        </Alert>
      )}

      <Tabs defaultValue='guia' keepMounted={false}>
        <Tabs.List mb='md'>
          <Tabs.Tab value='guia'>Guía de codificación</Tabs.Tab>
          <Tabs.Tab value='tipos-proceso'>Tipos de proceso</Tabs.Tab>
          <Tabs.Tab value='procesos'>Procesos</Tabs.Tab>
          <Tabs.Tab value='tipos-documentales'>Tipos documentales</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value='guia'>
          <Card withBorder radius='md' p='lg' shadow='xs'>
            <Stack>
              <Text size='sm' c='dimmed'>
                Marcas disponibles: {SGC_CODING_TOKENS.map((t) => `{${t}}`).join(' ')}. El consecutivo se lleva por la parte del código que va antes
                de {'{CONSECUTIVO}'}. Cambiar la guía no recodifica los documentos existentes.
              </Text>
              <Group align='flex-end' wrap='wrap'>
                <TextInput label='Prefijo' value={String(guideForm.prefix)} onChange={(e) => setGuide({ ...guideForm, prefix: e.currentTarget.value.toUpperCase() })} w={120} />
                <TextInput label='Patrón' value={String(guideForm.pattern)} onChange={(e) => setGuide({ ...guideForm, pattern: e.currentTarget.value })} w={380} ff='monospace' />
                <NumberInput label='Dígitos' min={1} max={6} value={Number(guideForm.sequenceDigits)} onChange={(v) => setGuide({ ...guideForm, sequenceDigits: Number(v) })} w={100} />
              </Group>
              {example ? (
                <Text size='sm'>
                  Ejemplo (proceso GC, procedimiento): <Text span ff='monospace' fw={700}>{example}</Text>
                </Text>
              ) : (
                <Alert color='yellow' icon={<IconAlertTriangle size={18} />}>
                  {guideErrors.join(' ')}
                </Alert>
              )}
              <Textarea label='Motivo del cambio' value={String(guideForm.reason ?? '')} onChange={(e) => setGuide({ ...guideForm, reason: e.currentTarget.value })} minRows={2} />
              {data.codingGuide?.updatedBy && (
                <Text size='xs' c='dimmed'>
                  Último cambio: {data.codingGuide.updatedBy} · {data.codingGuide.updatedAt.slice(0, 10)}
                </Text>
              )}
              <Group justify='flex-end'>
                <Button loading={busy} disabled={!!guideErrors.length} onClick={() => save('coding-guide', guideForm)}>
                  Guardar guía
                </Button>
              </Group>
            </Stack>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel value='tipos-proceso'>
          <Card withBorder radius='md' p='lg' shadow='xs'>
            <Group justify='flex-end' mb='sm'>
              <Button size='xs' leftSection={<IconPlus size={14} />} onClick={() => setEditing({ entity: 'process-types', form: { code: '', name: '', color: 'blue', sortOrder: 0, isActive: true, reason: '' } })}>
                Nuevo tipo de proceso
              </Button>
            </Group>
            <Table verticalSpacing='xs'>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Código</Table.Th>
                  <Table.Th>Nombre</Table.Th>
                  <Table.Th>Orden</Table.Th>
                  <Table.Th>Estado</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.processTypes.map((t) => (
                  <Table.Tr key={t.id}>
                    <Table.Td ff='monospace'>{t.code}</Table.Td>
                    <Table.Td>
                      <Badge color={t.color} variant='light'>
                        {t.name}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{t.sortOrder}</Table.Td>
                    <Table.Td>{activeBadge(t.isActive)}</Table.Td>
                    <Table.Td>{editButton('process-types', { id: t.id, code: t.code, name: t.name, color: t.color, sortOrder: t.sortOrder, isActive: t.isActive })}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel value='procesos'>
          <Card withBorder radius='md' p='lg' shadow='xs'>
            <Group justify='flex-end' mb='sm'>
              <Button
                size='xs'
                leftSection={<IconPlus size={14} />}
                onClick={() => setEditing({ entity: 'processes', form: { idProcessType: data.processTypes[0]?.id ?? null, code: '', name: '', idDepartment: null, sortOrder: 0, isActive: true, reason: '' } })}
              >
                Nuevo proceso
              </Button>
            </Group>
            <Table.ScrollContainer minWidth={700}>
              <Table verticalSpacing='xs'>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Código</Table.Th>
                    <Table.Th>Proceso</Table.Th>
                    <Table.Th>Tipo de proceso</Table.Th>
                    <Table.Th>Departamento dueño</Table.Th>
                    <Table.Th>Estado</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.processes.map((p) => (
                    <Table.Tr key={p.id}>
                      <Table.Td ff='monospace'>{p.code}</Table.Td>
                      <Table.Td>{p.name}</Table.Td>
                      <Table.Td>{typeName(p.idProcessType)}</Table.Td>
                      <Table.Td>{p.department ?? '—'}</Table.Td>
                      <Table.Td>{activeBadge(p.isActive)}</Table.Td>
                      <Table.Td>
                        {editButton('processes', { id: p.id, idProcessType: p.idProcessType, code: p.code, name: p.name, idDepartment: p.idDepartment, sortOrder: p.sortOrder, isActive: p.isActive })}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel value='tipos-documentales'>
          <Card withBorder radius='md' p='lg' shadow='xs'>
            <Group justify='flex-end' mb='sm'>
              <Button
                size='xs'
                leftSection={<IconPlus size={14} />}
                onClick={() => setEditing({ entity: 'document-types', form: { code: '', name: '', pluralName: '', requiresTraining: true, reviewMonths: 36, alertMonths: 2, sortOrder: 0, isActive: true, reason: '' } })}
              >
                Nuevo tipo documental
              </Button>
            </Group>
            <Table.ScrollContainer minWidth={700}>
              <Table verticalSpacing='xs'>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Código</Table.Th>
                    <Table.Th>Tipo</Table.Th>
                    <Table.Th>Revisión</Table.Th>
                    <Table.Th>Alerta</Table.Th>
                    <Table.Th>Capacitación</Table.Th>
                    <Table.Th>Estado</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.documentTypes.map((t) => (
                    <Table.Tr key={t.id}>
                      <Table.Td ff='monospace'>{t.code}</Table.Td>
                      <Table.Td>
                        {t.name} <Text span c='dimmed' size='xs'>({t.pluralName})</Text>
                      </Table.Td>
                      <Table.Td>{t.reviewMonths} meses</Table.Td>
                      <Table.Td>{t.alertMonths} meses antes</Table.Td>
                      <Table.Td>{t.requiresTraining ? 'Obligatoria' : 'No'}</Table.Td>
                      <Table.Td>{activeBadge(t.isActive)}</Table.Td>
                      <Table.Td>
                        {editButton('document-types', {
                          id: t.id,
                          code: t.code,
                          name: t.name,
                          pluralName: t.pluralName,
                          requiresTraining: t.requiresTraining,
                          reviewMonths: t.reviewMonths,
                          alertMonths: t.alertMonths,
                          sortOrder: t.sortOrder,
                          isActive: t.isActive,
                        })}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Card>
        </Tabs.Panel>
      </Tabs>

      <Modal opened={!!editing} onClose={() => setEditing(null)} title={editing?.form.id ? 'Editar' : 'Nuevo'} centered>
        {editing && (
          <Stack>
            {editing.entity === 'processes' && (
              <Select
                label='Tipo de proceso'
                data={data.processTypes.map((t) => ({ value: String(t.id), label: t.name }))}
                value={editing.form.idProcessType ? String(editing.form.idProcessType) : null}
                onChange={(v) => set('idProcessType', v ? Number(v) : null)}
                allowDeselect={false}
              />
            )}
            <TextInput label='Código' value={String(editing.form.code ?? '')} onChange={(e) => set('code', e.currentTarget.value.toUpperCase())} ff='monospace' />
            <TextInput label='Nombre' value={String(editing.form.name ?? '')} onChange={(e) => set('name', e.currentTarget.value)} />
            {editing.entity === 'document-types' && (
              <>
                <TextInput label='Nombre en plural (carpeta del mapa)' value={String(editing.form.pluralName ?? '')} onChange={(e) => set('pluralName', e.currentTarget.value)} />
                <Group grow>
                  <NumberInput label='Revisión (meses)' min={1} max={120} value={Number(editing.form.reviewMonths)} onChange={(v) => set('reviewMonths', Number(v))} />
                  <NumberInput label='Alerta (meses antes)' min={0} max={24} value={Number(editing.form.alertMonths)} onChange={(v) => set('alertMonths', Number(v))} />
                </Group>
                <Checkbox label='Capacitación obligatoria' checked={!!editing.form.requiresTraining} onChange={(e) => set('requiresTraining', e.currentTarget.checked)} />
              </>
            )}
            {editing.entity === 'processes' && (
              <Select
                label='Departamento dueño'
                data={data.departments.map((x) => ({ value: String(x.id), label: x.name }))}
                value={editing.form.idDepartment ? String(editing.form.idDepartment) : null}
                onChange={(v) => set('idDepartment', v ? Number(v) : null)}
                clearable
                searchable
              />
            )}
            {editing.entity === 'process-types' && (
              <Select label='Color' data={COLORS} value={String(editing.form.color ?? 'blue')} onChange={(v) => set('color', v ?? 'blue')} allowDeselect={false} />
            )}
            <NumberInput label='Orden' min={0} max={999} value={Number(editing.form.sortOrder ?? 0)} onChange={(v) => set('sortOrder', Number(v))} />
            <Checkbox label='Activo' checked={editing.form.isActive !== false} onChange={(e) => set('isActive', e.currentTarget.checked)} />
            <Textarea label='Motivo del cambio' description='Queda en la auditoría (control de cambios).' value={String(editing.form.reason ?? '')} onChange={(e) => set('reason', e.currentTarget.value)} minRows={2} />
            <Button loading={busy} onClick={() => save(editing.entity, editing.form)}>
              Guardar
            </Button>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

export default function ConfiguracionSgcPage() {
  return (
    <SgcShell section='Configuración del SGC' subtitle='Maestros de la empresa: codificación, procesos y tipos documentales' requireQuality>
      {(company) => <Configuracion company={company} />}
    </SgcShell>
  );
}
