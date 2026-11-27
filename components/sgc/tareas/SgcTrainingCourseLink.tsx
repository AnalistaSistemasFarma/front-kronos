'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, Group, Progress, Select, Stack, Table, Text } from '@mantine/core';
import { IconSchool } from '@tabler/icons-react';
import type { SgcTrainingView } from '../../../lib/sgc/db/training';

/**
 * «Curso de Formación» de la capacitación (2026-11-26; Calidad OLP: «configuro el curso en Formación y en la solicitud
 * documental elijo ese curso»). Quien gestiona la capacitación elige el curso; la divulgación queda inscrita en él y aquí
 * se ve el avance (% de materiales) y el certificado de cada persona.
 */
export default function SgcTrainingCourseLink({ requestId, view, onChanged }: { requestId: number; view: SgcTrainingView; onChanged?: () => void }) {
  const [courses, setCourses] = useState<{ id: number; title: string }[] | null>(null);
  const [value, setValue] = useState<string | null>(view.course ? String(view.course.id) : null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  useEffect(() => {
    if (!view.canManage) return;
    void fetch(`/api/sgc/requests/${requestId}/training-course`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { courses?: { id: number; title: string }[] }) => setCourses(d.courses ?? []))
      .catch(() => setCourses([]));
  }, [requestId, view.canManage]);
  useEffect(() => setValue(view.course ? String(view.course.id) : null), [view.course]);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/sgc/requests/${requestId}/training-course`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseId: value ? Number(value) : null }) });
      const d = (await r.json().catch(() => ({}))) as { error?: string; enrolled?: number };
      if (!r.ok) throw new Error(d.error || 'No se pudo guardar el curso');
      setMsg({ ok: true, t: value ? `Curso ligado. ${d.enrolled ?? 0} persona(s) inscrita(s) desde la divulgación.` : 'La capacitación ya no usa un curso de Formación.' });
      onChanged?.();
    } catch (e) {
      setMsg({ ok: false, t: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  if (!view.course && !view.canManage) return null;
  return (
    <Card withBorder radius='md' p='sm' mt='md' data-testid='sgc-capacitacion-curso'>
      <Stack gap='xs'>
        <Group gap='xs'>
          <IconSchool size={18} />
          <Text fw={600} size='sm'>
            Curso de Formación
          </Text>
          {view.course && <Badge variant='light'>{view.course.title}</Badge>}
        </Group>
        {view.canManage && (
          <Group align='flex-end' gap='xs'>
            <Select
              label='Curso (activo en Formación)'
              description='Las personas de la divulgación quedan inscritas en el curso; también las que se agreguen después.'
              placeholder={courses === null ? 'Cargando…' : 'Sin curso: la capacitación del SGC'}
              data={(courses ?? []).map((c) => ({ value: String(c.id), label: c.title }))}
              value={value}
              onChange={setValue}
              searchable
              clearable
              w={420}
              data-testid='sgc-capacitacion-curso-select'
            />
            <Button size='xs' loading={busy} disabled={(value ?? null) === (view.course ? String(view.course.id) : null)} onClick={() => void save()} data-testid='sgc-capacitacion-curso-guardar'>
              Guardar curso
            </Button>
          </Group>
        )}
        {msg && (
          <Text size='sm' c={msg.ok ? 'green' : 'red'}>
            {msg.t}
          </Text>
        )}
        {view.course && view.people.length > 0 && (
          <Table striped fz='sm' verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Persona</Table.Th>
                <Table.Th w={220}>Avance del curso</Table.Th>
                <Table.Th>Certificado</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {view.people.map((p) => (
                <Table.Tr key={p.email}>
                  <Table.Td>{p.name ?? p.email}</Table.Td>
                  <Table.Td>
                    <Group gap='xs' wrap='nowrap'>
                      <Progress value={p.coursePct ?? 0} w={120} />
                      <Text size='xs'>{p.coursePct ?? 0} %</Text>
                    </Group>
                  </Table.Td>
                  <Table.Td>{p.courseCertified ? <Badge color='green'>Sí</Badge> : <Badge color='gray' variant='light'>No</Badge>}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Card>
  );
}
