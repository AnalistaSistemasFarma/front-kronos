'use client';

import { ActionIcon, Badge, Button, Card, Group, NumberInput, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { IconListDetails, IconTrash } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { formatSla } from '../../../lib/requests-general/sla';

interface Field {
  id: number;
  label: string;
  options: { id: number; label: string }[];
}
interface Data {
  canEdit: boolean;
  defaultPrefix: string | null;
  fields: Field[];
  tasks: { id: number; task: string }[];
  rules: { id_option: number; prefix: string | null; sla_value: number | null; sla_unit: string | null }[];
  assignees: { id_task: number; id_option: number; id_user: string; name: string | null; email: string | null }[];
}
type RuleDraft = { prefix: string; slaValue: number | string; slaUnit: string };
type AsgDraft = { idTask: number; idOption: number; idUser: string };

const UNITS = [
  { value: 'business_days', label: 'Días hábiles' },
  { value: 'business_hours', label: 'Horas hábiles' },
  { value: 'calendar_hours', label: 'Horas calendario' },
];

/**
 * «Reglas por opción» in the workflow administration (2026-11-24): per option of a list field, the consecutive prefix
 * (AU / NC), the SLA (Crítica = 8 días hábiles) and who does each task (the leader of the chosen area). No code needed.
 */
export function OptionRulesCard({ processId }: { processId: number }) {
  const [data, setData] = useState<Data | null>(null);
  const [editing, setEditing] = useState(false);
  const [defaultPrefix, setDefaultPrefix] = useState('');
  const [rules, setRules] = useState<Record<number, RuleDraft>>({});
  const [asg, setAsg] = useState<AsgDraft[]>([]);
  const [users, setUsers] = useState<{ value: string; label: string }[]>([]);
  const [newAsg, setNewAsg] = useState<{ idTask: string | null; idOption: string | null; idUser: string | null }>({ idTask: null, idOption: null, idUser: null });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const res = await fetch(`/api/requests-general/option-rules?id=${processId}`, { cache: 'no-store' });
    if (!res.ok) return;
    const d = (await res.json()) as Data;
    setData(d);
    setDefaultPrefix(d.defaultPrefix ?? '');
    setRules(Object.fromEntries(d.rules.map((r) => [r.id_option, { prefix: r.prefix ?? '', slaValue: r.sla_value ?? '', slaUnit: r.sla_unit ?? 'business_days' }])));
    setAsg(d.assignees.map((a) => ({ idTask: a.id_task, idOption: a.id_option, idUser: a.id_user })));
  };
  useEffect(() => {
    void load();
  }, [processId]);

  const optionLabel = useMemo(() => {
    const m = new Map<number, string>();
    for (const f of data?.fields ?? []) for (const o of f.options) m.set(o.id, `${f.label}: ${o.label}`);
    return m;
  }, [data]);
  const userLabel = useMemo(() => {
    const m = new Map<string, string>(users.map((u) => [u.value, u.label]));
    for (const a of data?.assignees ?? []) if (!m.has(a.id_user)) m.set(a.id_user, a.name ?? a.email ?? a.id_user);
    return m;
  }, [users, data]);

  if (!data || data.fields.length === 0) return null;

  const startEdit = async () => {
    setEditing(true);
    if (users.length) return;
    const res = await fetch('/api/requests-general/users-emails', { cache: 'no-store' });
    const d = (await res.json().catch(() => ({}))) as { users?: { id: string; name: string | null; email: string | null }[] };
    setUsers((d.users ?? []).map((u) => ({ value: u.id, label: `${u.name ?? u.email ?? u.id}${u.email ? ` · ${u.email}` : ''}` })));
  };
  const setRule = (idOption: number, p: Partial<RuleDraft>) => setRules((r) => ({ ...r, [idOption]: { ...(r[idOption] ?? { prefix: '', slaValue: '', slaUnit: 'business_days' }), ...p } }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/requests-general/option-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: processId,
          defaultPrefix,
          rules: Object.entries(rules).map(([idOption, r]) => ({ idOption: Number(idOption), prefix: r.prefix, slaValue: r.slaValue === '' ? null : r.slaValue, slaUnit: r.slaUnit })),
          assignees: asg,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'No se pudieron guardar las reglas');
      toast.success('Reglas por opción guardadas');
      setEditing(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudieron guardar las reglas');
    } finally {
      setSaving(false);
    }
  };

  const configured = data.rules.length + data.assignees.length + (data.defaultPrefix ? 1 : 0);

  return (
    <Card withBorder radius='md' p='md' data-testid='option-rules-card'>
      <Stack gap='sm'>
        <Group justify='space-between'>
          <Group gap='xs'>
            <IconListDetails size={18} style={{ color: 'var(--mantine-color-dimmed)' }} />
            <Text size='sm' c='dimmed' fw={500}>
              Reglas por opción (consecutivo, ANS y responsable)
            </Text>
          </Group>
          {data.canEdit && !editing && (
            <Button size='xs' variant='light' onClick={() => void startEdit()} data-testid='option-rules-edit'>
              Editar reglas
            </Button>
          )}
        </Group>

        {!editing ? (
          configured === 0 ? (
            <Text size='sm' c='dimmed'>
              Sin reglas: usa el número de la solicitud, el ANS del flujo y los responsables de cada tarea.
            </Text>
          ) : (
            <Stack gap={4}>
              {data.defaultPrefix && <Text size='sm'>Consecutivo por defecto: {data.defaultPrefix}-0001</Text>}
              {data.rules.map((r) => (
                <Group key={r.id_option} gap='xs'>
                  <Text size='sm'>{optionLabel.get(r.id_option) ?? r.id_option}</Text>
                  {r.prefix && <Badge variant='light'>{r.prefix}-0001</Badge>}
                  {r.sla_value && <Badge variant='light' color='orange'>{formatSla({ value: r.sla_value, unit: r.sla_unit })}</Badge>}
                </Group>
              ))}
              {data.assignees.map((a) => (
                <Text key={`${a.id_task}-${a.id_option}-${a.id_user}`} size='sm'>
                  {data.tasks.find((t) => t.id === a.id_task)?.task ?? a.id_task} · si {optionLabel.get(a.id_option) ?? a.id_option} → {a.name ?? a.email ?? a.id_user}
                </Text>
              ))}
            </Stack>
          )
        ) : (
          <Stack gap='md'>
            <TextInput
              label='Prefijo del consecutivo por defecto'
              description='Vacío = sin consecutivo. Letras o números, p. ej. NC → NC-0001.'
              value={defaultPrefix}
              onChange={(e) => setDefaultPrefix(e.currentTarget.value.toUpperCase())}
              maxLength={10}
              w={260}
            />
            {data.fields.map((f) => (
              <div key={f.id}>
                <Text size='sm' fw={600} mb={4}>
                  {f.label}
                </Text>
                <Table withTableBorder fz='sm' verticalSpacing={4}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Opción</Table.Th>
                      <Table.Th>Prefijo</Table.Th>
                      <Table.Th>ANS</Table.Th>
                      <Table.Th>Unidad</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {f.options.map((o) => {
                      const r = rules[o.id] ?? { prefix: '', slaValue: '', slaUnit: 'business_days' };
                      return (
                        <Table.Tr key={o.id}>
                          <Table.Td>{o.label}</Table.Td>
                          <Table.Td>
                            <TextInput size='xs' w={90} maxLength={10} value={r.prefix} onChange={(e) => setRule(o.id, { prefix: e.currentTarget.value.toUpperCase() })} placeholder='—' />
                          </Table.Td>
                          <Table.Td>
                            <NumberInput size='xs' w={90} min={1} max={10000} allowDecimal={false} value={r.slaValue} onChange={(v) => setRule(o.id, { slaValue: v })} placeholder='—' />
                          </Table.Td>
                          <Table.Td>
                            <Select size='xs' w={160} data={UNITS} value={r.slaUnit} onChange={(v) => setRule(o.id, { slaUnit: v || 'business_days' })} allowDeselect={false} />
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </div>
            ))}

            <div>
              <Text size='sm' fw={600} mb={4}>
                Responsable de una tarea según la opción
              </Text>
              <Text size='xs' c='dimmed' mb={6}>
                Si se elige la opción, la tarea le llega a esta persona en vez del responsable de la plantilla (p. ej. al líder del área).
              </Text>
              <Group align='flex-end' gap='xs'>
                <Select label='Tarea' size='xs' w={240} data={data.tasks.map((t) => ({ value: String(t.id), label: t.task }))} value={newAsg.idTask} onChange={(v) => setNewAsg((s) => ({ ...s, idTask: v }))} />
                <Select label='Opción' size='xs' w={260} searchable data={data.fields.map((f) => ({ group: f.label, items: f.options.map((o) => ({ value: String(o.id), label: o.label })) }))} value={newAsg.idOption} onChange={(v) => setNewAsg((s) => ({ ...s, idOption: v }))} />
                <Select label='Responsable' size='xs' w={280} searchable data={users} value={newAsg.idUser} onChange={(v) => setNewAsg((s) => ({ ...s, idUser: v }))} nothingFoundMessage='Sin coincidencias' />
                <Button
                  size='xs'
                  variant='light'
                  disabled={!newAsg.idTask || !newAsg.idOption || !newAsg.idUser}
                  onClick={() => {
                    const a = { idTask: Number(newAsg.idTask), idOption: Number(newAsg.idOption), idUser: String(newAsg.idUser) };
                    setAsg((xs) => [...xs.filter((x) => !(x.idTask === a.idTask && x.idOption === a.idOption)), a]);
                    setNewAsg({ idTask: null, idOption: null, idUser: null });
                  }}
                >
                  Agregar
                </Button>
              </Group>
              {asg.length > 0 && (
                <Table fz='sm' mt='xs' verticalSpacing={4}>
                  <Table.Tbody>
                    {asg.map((a) => (
                      <Table.Tr key={`${a.idTask}-${a.idOption}`}>
                        <Table.Td>{data.tasks.find((t) => t.id === a.idTask)?.task ?? a.idTask}</Table.Td>
                        <Table.Td>{optionLabel.get(a.idOption) ?? a.idOption}</Table.Td>
                        <Table.Td>{userLabel.get(a.idUser) ?? a.idUser}</Table.Td>
                        <Table.Td w={40}>
                          <ActionIcon variant='subtle' color='red' aria-label='Quitar' onClick={() => setAsg((xs) => xs.filter((x) => x !== a))}>
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </div>

            <Group justify='flex-end'>
              <Button variant='default' size='xs' onClick={() => { setEditing(false); void load(); }}>
                Cancelar
              </Button>
              <Button size='xs' loading={saving} onClick={() => void save()} data-testid='option-rules-save'>
                Guardar reglas
              </Button>
            </Group>
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
