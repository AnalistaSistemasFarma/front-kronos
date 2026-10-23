'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Badge, Button, Checkbox, Group, Modal, Radio, Select, Stack, Table, Text, Tooltip } from '@mantine/core';
import { IconBolt, IconPlugConnected } from '@tabler/icons-react';
import {
  TRIGGER_LABELS,
  actionsFor,
  getSapAction,
  triggersFor,
  type TaskKind,
  type TriggerEvent,
} from '../../lib/workflow-sap/catalog';

/**
 * Configuracion SAP de una tarea del flujo (pantalla «Ver flujos»):
 *  - Distintivos en la tarjeta: «Ejecutora SAP» y las acciones SAP que dispara.
 *  - Ventana para elegir el tipo (normal / ejecutora SAP) y las acciones del catalogo
 *    por disparador; el mapeo de campos se muestra (solo lectura en esta version).
 */

export interface TaskSapInfo {
  id: number;
  task: string;
  taskKind: TaskKind;
  actions: { trigger: TriggerEvent; actionKey: string }[];
}

/** Carga la configuracion SAP de todas las tareas de un proceso. */
export function useWorkflowSapConfig(processId: number | null) {
  const [byTask, setByTask] = useState<Map<number, TaskSapInfo>>(new Map());
  const [usesDefaults, setUsesDefaults] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!processId) return;
    let cancelled = false;
    fetch(`/api/workflow-sap/task-actions?processId=${processId}`, { cache: 'no-store' })
      .then(async (r) => {
        if (cancelled) return;
        if (!r.ok) {
          setCanManage(false);
          return;
        }
        const d = await r.json();
        setCanManage(true);
        setUsesDefaults(Boolean(d.usesDefaults));
        setByTask(new Map((d.tasks as TaskSapInfo[]).map((t) => [t.id, t])));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [processId, version]);

  return { byTask, usesDefaults, canManage, reload: () => setVersion((v) => v + 1) };
}

/** Distintivos de la tarjeta de la tarea. */
export function TaskSapBadges({ info }: { info?: TaskSapInfo }) {
  if (!info) return null;
  return (
    <>
      {info.taskKind === 'sap_executor' && (
        <Badge color="blue" variant="filled" size="sm" leftSection={<IconBolt size={12} />}>
          Ejecutora SAP
        </Badge>
      )}
      {info.actions.map((a) => {
        const def = getSapAction(a.actionKey);
        return (
          <Tooltip key={`${a.trigger}-${a.actionKey}`} label={def?.endpoint ?? a.actionKey} withArrow>
            <Badge color="blue" variant="light" size="sm" styles={{ root: { textTransform: 'none' } }}>
              SAP · {TRIGGER_LABELS[a.trigger]?.replace('Al ', '').replace(' (tarea automática)', '')}: {def?.label ?? a.actionKey}
            </Badge>
          </Tooltip>
        );
      })}
    </>
  );
}

interface ModalProps {
  info: TaskSapInfo | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Ventana de configuracion SAP de una tarea. */
export function TaskSapConfigModal({ info, onClose, onSaved }: ModalProps) {
  const [kind, setKind] = useState<TaskKind>('normal');
  const [selected, setSelected] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!info) return;
    setKind(info.taskKind);
    setErrors([]);
    const map: Record<string, string | null> = {};
    for (const a of info.actions) map[a.trigger] = a.actionKey;
    setSelected(map);
  }, [info]);

  if (!info) return null;
  const isAuth = info.taskKind === 'authorization';
  const triggers = triggersFor(kind);

  const save = async () => {
    setSaving(true);
    setErrors([]);
    try {
      const actions = triggers
        .filter((t) => selected[t])
        .map((t) => ({ trigger: t, actionKey: selected[t] as string }));
      const res = await fetch('/api/workflow-sap/task-actions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: info.id, taskKind: kind, actions }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrors(Array.isArray(d.errors) && d.errors.length ? d.errors : [d.error || 'No se pudo guardar']);
        return;
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened onClose={onClose} title={`SAP · ${info.task}`} size="lg">
      <Stack>
        {!isAuth && (
          <Radio.Group label="Tipo de tarea" value={kind} onChange={(v) => setKind(v as TaskKind)}>
            <Group mt={6}>
              <Radio value="normal" label="Normal (la resuelve una persona)" />
              <Radio value="sap_executor" label="Ejecutora SAP (la ejecuta el sistema)" />
            </Group>
          </Radio.Group>
        )}
        {isAuth && (
          <Text size="sm" c="dimmed">
            Tarea de autorización: aquí se definen sus <b>efectos en SAP</b> según lo que decida el autorizador.
          </Text>
        )}
        {triggers.length === 0 && (
          <Alert color="gray">Las tareas normales no ejecutan acciones en SAP.</Alert>
        )}

        {triggers.map((t) => {
          const options = actionsFor(kind, t);
          const current = selected[t] ?? null;
          const def = current ? getSapAction(current) : undefined;
          return (
            <Stack key={t} gap={6}>
              {kind === 'sap_executor' ? (
                <Select
                  label="Acción SAP que ejecuta"
                  data={options.map((o) => ({ value: o.key, label: o.label }))}
                  value={current}
                  onChange={(v) => setSelected((s) => ({ ...s, [t]: v }))}
                  placeholder="Elija una acción del catálogo"
                />
              ) : (
                <Checkbox
                  label={`${TRIGGER_LABELS[t]}: ${options[0]?.label ?? '—'}`}
                  checked={Boolean(current)}
                  disabled={options.length === 0}
                  onChange={(e) =>
                    setSelected((s) => ({ ...s, [t]: e.currentTarget.checked ? options[0]?.key ?? null : null }))
                  }
                />
              )}
              {def && (
                <Table withTableBorder fz="xs" verticalSpacing={2}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th colSpan={3}>
                        <Group gap={6}>
                          <IconPlugConnected size={14} /> {def.endpoint}
                        </Group>
                      </Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {def.mapping.map((m) => (
                      <Table.Tr key={m.target}>
                        <Table.Td>{m.source}</Table.Td>
                        <Table.Td>
                          <code>{m.target}</code>
                        </Table.Td>
                        <Table.Td c={m.editable ? undefined : 'dimmed'}>{m.editable ? 'Editable' : 'Fijo (SAPSEND)'}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Stack>
          );
        })}

        {kind === 'sap_executor' && (
          <Alert color="blue" variant="light">
            La tarea se ejecuta sola cuando le llega el turno en el flujo. Si SAP falla, queda pendiente con el error y se
            puede reintentar; todo queda en el historial de la solicitud.
          </Alert>
        )}

        {errors.length > 0 && (
          <Alert color="red">
            {errors.map((e) => (
              <div key={e}>{e}</div>
            ))}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={saving}>
            Guardar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Etiqueta corta del evento de una autorización para mostrarlo como rama. */
const BRANCH_LABEL: Partial<Record<TriggerEvent, string>> = {
  on_start: 'Al iniciar',
  on_approve: 'Si se aprueba',
  on_final_approve: 'Si se aprueba (último nivel)',
  on_reject: 'Si se rechaza',
  on_quote: 'Si se envía a cotizar',
};

/**
 * Efectos SAP de una autorización dibujados como ramas debajo de su tarjeta:
 * «◆ Si se rechaza → ⚡ Tarea SAP · Pasar a No aprobado». Solo visual; se editan con
 * «Editar efectos SAP» (misma configuración de siempre).
 */
export function AuthorizationSapBranches({
  info,
  canManage,
  onEdit,
}: {
  info?: TaskSapInfo;
  canManage: boolean;
  onEdit: () => void;
}) {
  if (!info || info.taskKind !== 'authorization') return null;
  if (info.actions.length === 0 && !canManage) return null;
  return (
    <Stack gap={6} mt="xs" ml={48}>
      {info.actions.map((a) => {
        const def = getSapAction(a.actionKey);
        return (
          <Group key={`${a.trigger}-${a.actionKey}`} gap={8} wrap="nowrap">
            <Badge color="grape" variant="light" size="sm" styles={{ root: { textTransform: 'none' } }}>
              ◆ {BRANCH_LABEL[a.trigger] ?? a.trigger}
            </Badge>
            <Text size="xs" c="dimmed">
              →
            </Text>
            <Badge color="blue" variant="filled" size="sm" leftSection={<IconBolt size={12} />}>
              Tarea SAP
            </Badge>
            <Text size="xs" fw={600}>
              {def?.label ?? a.actionKey}
            </Text>
            <Text size="xs" c="dimmed" truncate>
              {def?.endpoint}
            </Text>
          </Group>
        );
      })}
      {canManage && (
        <Button size="compact-xs" variant="subtle" color="blue" onClick={onEdit} style={{ alignSelf: 'flex-start' }}>
          Editar efectos SAP de esta autorización
        </Button>
      )}
    </Stack>
  );
}

/** Encabezado del objeto «Condicional» (condiciones existentes por opciones del formulario). */
export function ConditionalObject({ label }: { label: string }) {
  return (
    <Group gap={8} mb={6} wrap="nowrap">
      <Badge color="grape" variant="filled" size="sm">
        ◆ Condicional
      </Badge>
      <Text size="sm" fw={600}>
        Si {label}
      </Text>
      <Text size="xs" c="dimmed">
        · si no se cumple, estas tareas no se crean
      </Text>
    </Group>
  );
}
