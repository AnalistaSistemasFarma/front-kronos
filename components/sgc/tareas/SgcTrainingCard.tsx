'use client';

import { useEffect, useState } from 'react';
import { Alert, Anchor, Badge, Button, Card, Code, FileButton, Grid, Group, NumberInput, Stack, Table, Text, TextInput, Textarea, Title } from '@mantine/core';
import SgcSelect from '../SgcSelect';
import { IconFileSpreadsheet, IconSchool, IconUpload } from '@tabler/icons-react';
import type { SgcRequestDetail } from '../../../lib/sgc/db/requests';
import { SGC_TRAINING_DEFAULT_MAX_ATTEMPTS, SGC_TRAINING_DEFAULT_MIN_PCT, SGC_TRAINING_MODE_LABELS, type SgcTrainingMode } from '../../../lib/sgc/training/results';
import { formatDateCO } from './format';

/**
 * CAPACITACIÓN de la solicitud (Sprint 4, paso 5, obligatoria para todos los
 * tipos): Calidad registra la sesión o el video y la evaluación de Microsoft
 * Forms (con nota mínima), carga el Excel de resultados que exporta Forms y
 * ve quién aprobó, reprobó o no presentó. La cierra con la firma «Capacitó»
 * desde «Editar Tarea» (firma electrónica propia del SGC sobre el Excel).
 */
export interface SgcTrainingCardProps {
  view: NonNullable<SgcRequestDetail['training']>;
  onSave: (body: Record<string, unknown>) => Promise<boolean>;
  onUpload: (file: File) => Promise<boolean>;
  /** Sprint 10: registra la recapacitación de una persona. */
  onRetrain?: (body: Record<string, unknown>) => Promise<boolean>;
}

const STATUS: Record<string, { label: string; color: string }> = {
  aprobo: { label: 'Aprobó', color: 'green' },
  reprobo: { label: 'Reprobó', color: 'red' },
  recapacitacion: { label: 'Recapacitación', color: 'orange' },
  sin_resultado: { label: 'Sin resultado', color: 'gray' },
};

export default function SgcTrainingCard({ view, onSave, onUpload, onRetrain }: SgcTrainingCardProps) {
  const t = view.training;
  const [form, setForm] = useState({
    mode: (t?.mode ?? 'mixta') as SgcTrainingMode,
    title: t?.title ?? '',
    videoUrl: t?.videoUrl ?? '',
    formsUrl: t?.formsUrl ?? '',
    sessionDate: t?.sessionDate ?? '',
    instructor: t?.instructor ?? '',
    maxScore: t?.maxScore ?? 10,
    minScorePct: t?.minScorePct ?? SGC_TRAINING_DEFAULT_MIN_PCT,
    maxAttempts: t?.maxAttempts ?? SGC_TRAINING_DEFAULT_MAX_ATTEMPTS,
    notes: t?.notes ?? '',
  });
  const [retrain, setRetrain] = useState<{ email: string; mode: string; sessionDate: string; result: string; notes: string } | null>(null);
  const [editing, setEditing] = useState(!t && view.canManage);
  useEffect(() => setEditing(!t && view.canManage), [t, view.canManage]);
  const set = (k: keyof typeof form, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const up = view.upload;

  return (
    <Card shadow='sm' p='xl' radius='md' withBorder mt='6' data-testid='sgc-capacitacion'>
      <Group justify='space-between' mb='sm'>
        <Title order={4} className='flex items-center gap-2'>
          <IconSchool size={18} className='text-blue-6' />
          Capacitación
        </Title>
        <Badge color={view.open ? 'blue' : 'green'} variant='light' size='lg' radius='sm' data-testid='sgc-capacitacion-fase'>
          {view.open ? (view.phase === 'material' ? 'Preparación del material' : 'En curso') : 'Cerrada'}
        </Badge>
      </Group>
      <Text size='sm' c='dimmed' mb='md'>
        {view.phase === 'material'
          ? 'Antes de la divulgación, Calidad registra el material: el video o la sesión y la evaluación en Microsoft Forms o Google Forms. La lectura los muestra debajo del documento.'
          : 'Participan las personas del alcance de la divulgación. Cuentan los primeros intentos de la evaluación; quien no aprueba en ellos queda en recapacitación. Al cerrarla con la firma «Capacitó», la versión pasa a vigente y la anterior a obsoleta.'}
      </Text>

      {t && !editing && (
        <Grid mb='md'>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Text size='xs' c='dimmed'>
              Tema
            </Text>
            <Text size='sm' data-testid='sgc-capacitacion-tema'>
              {t.title}
            </Text>
            <Text size='xs' c='dimmed' mt='xs'>
              Modalidad
            </Text>
            <Text size='sm'>
              {t.modeLabel}
              {t.sessionDate ? ` · sesión ${t.sessionDate}` : ''}
              {t.instructor ? ` · ${t.instructor}` : ''}
            </Text>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            {t.videoUrl && (
              <Text size='sm'>
                Video:{' '}
                <Anchor href={t.videoUrl} target='_blank' rel='noreferrer'>
                  abrir
                </Anchor>
              </Text>
            )}
            {t.formsUrl && (
              <Text size='sm'>
                Evaluación ({t.evaluationProviderLabel ?? 'Forms'}):{' '}
                <Anchor href={t.formsUrl} target='_blank' rel='noreferrer'>
                  abrir
                </Anchor>
              </Text>
            )}
            <Text size='sm'>
              Nota mínima: {t.minScorePct} % de {t.maxScore} puntos · {t.maxAttempts} intento(s)
            </Text>
          </Grid.Col>
        </Grid>
      )}

      {view.canManage && editing && (
        <Stack mb='md'>
          <Grid>
            <Grid.Col span={{ base: 12, md: 4 }}>
              <SgcSelect label='Modalidad' data={(Object.keys(SGC_TRAINING_MODE_LABELS) as SgcTrainingMode[]).map((k) => ({ value: k, label: SGC_TRAINING_MODE_LABELS[k] }))} value={form.mode} onChange={(v) => set('mode', v ?? 'mixta')} allowDeselect={false} data-testid='sgc-capacitacion-modalidad' />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 8 }}>
              <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Tema' required value={form.title} onChange={(e) => set('title', e.currentTarget.value)} data-testid='sgc-capacitacion-titulo' />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Enlace del video (https)' value={form.videoUrl} onChange={(e) => set('videoUrl', e.currentTarget.value)} data-testid='sgc-capacitacion-video' />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Enlace de la evaluación en Microsoft Forms o Google Forms (https)' required value={form.formsUrl} onChange={(e) => set('formsUrl', e.currentTarget.value)} data-testid='sgc-capacitacion-forms' />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 4 }}>
              <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Fecha de la sesión (AAAA-MM-DD)' value={form.sessionDate} onChange={(e) => set('sessionDate', e.currentTarget.value)} data-testid='sgc-capacitacion-fecha' />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 4 }}>
              <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Quién dicta' value={form.instructor} onChange={(e) => set('instructor', e.currentTarget.value)} />
            </Grid.Col>
            <Grid.Col span={{ base: 6, md: 2 }}>
              <NumberInput label='Puntaje máximo' min={1} max={1000} value={form.maxScore} onChange={(v) => set('maxScore', v)} data-testid='sgc-capacitacion-maximo' />
            </Grid.Col>
            <Grid.Col span={{ base: 6, md: 2 }}>
              <NumberInput label='Nota mínima (%)' min={1} max={100} value={form.minScorePct} onChange={(v) => set('minScorePct', v)} data-testid='sgc-capacitacion-minima' />
            </Grid.Col>
            <Grid.Col span={{ base: 6, md: 2 }}>
              <NumberInput label='Intentos' min={1} max={5} value={form.maxAttempts} onChange={(v) => set('maxAttempts', v)} data-testid='sgc-capacitacion-intentos' />
            </Grid.Col>
            <Grid.Col span={12}>
              <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Observaciones' autosize minRows={1} value={form.notes} onChange={(e) => set('notes', e.currentTarget.value)} />
            </Grid.Col>
          </Grid>
          <Group>
            <Button
              onClick={async () => {
                const ok = await onSave(form);
                if (ok) setEditing(false);
              }}
              data-testid='sgc-capacitacion-guardar'
            >
              Guardar capacitación
            </Button>
            {t && (
              <Button variant='default' onClick={() => setEditing(false)}>
                Cancelar
              </Button>
            )}
          </Group>
        </Stack>
      )}
      {view.canManage && t && !editing && (
        <Group mb='md'>
          <Button variant='light' onClick={() => setEditing(true)} data-testid='sgc-capacitacion-editar'>
            Editar capacitación
          </Button>
          {view.canUpload && (
            <FileButton onChange={(f) => f && void onUpload(f)} accept='.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv'>
              {(props) => (
                <Button {...props} leftSection={<IconUpload size={14} />} data-testid='sgc-capacitacion-cargar'>
                  {up ? 'Cargar de nuevo los resultados' : 'Cargar resultados (Excel o CSV de Forms)'}
                </Button>
              )}
            </FileButton>
          )}
        </Group>
      )}
      {!t && !view.canManage && <Text size='sm' c='dimmed'>Calidad aún no registra la capacitación.</Text>}

      {up && (
        <Stack gap='xs'>
          <Group gap='xs'>
            <IconFileSpreadsheet size={16} />
            <Text size='sm' data-testid='sgc-capacitacion-archivo'>
              {up.fileName} · {up.uploadedBy} · {formatDateCO(up.uploadedAt)}
            </Text>
          </Group>
          <Text size='xs' c='dimmed'>
            SHA-256 <Code>{up.sha256}</Code>
          </Text>
          <Text size='sm' data-testid='sgc-capacitacion-resumen'>
            Del alcance: {up.summary.passed} aprobaron, {up.summary.failed} reprobaron, {up.summary.missing.length} sin resultado · fuera del alcance: {up.summary.outOfScope} · filas no leídas: {up.summary.rejected.length}
          </Text>
          {up.needsJustification && view.open && (
            <Alert color='yellow'>Hay personas que reprobaron o no presentaron: al cerrar la capacitación escriba la justificación en la resolución de la tarea.</Alert>
          )}
          <Table.ScrollContainer minWidth={560}>
            <Table striped data-testid='sgc-capacitacion-resultados'>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Persona</Table.Th>
                  <Table.Th>Resultado</Table.Th>
                  <Table.Th>Puntaje</Table.Th>
                  <Table.Th>Intentos</Table.Th>
                  {view.canRetrain && <Table.Th />}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {view.people.map((p) => (
                  <Table.Tr key={p.email} data-testid={`sgc-capacitado-${p.email}`}>
                    <Table.Td>
                      <Text size='sm'>{p.name ?? p.email}</Text>
                      <Text size='xs' c='dimmed'>
                        {p.email}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={STATUS[p.status].color} variant='light'>
                        {STATUS[p.status].label}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{p.score === null ? '—' : `${p.score} (${p.percent} %)`}</Table.Td>
                    <Table.Td>
                      {p.attempts ?? '—'}
                      {p.attemptNumber ? <Text span size='xs' c='dimmed'>{` · cuenta el ${p.attemptNumber}.º`}</Text> : null}
                      {p.extraAttempts > 0 ? <Text span size='xs' c='orange'>{` · ${p.extraAttempts} de más (no cuentan)`}</Text> : null}
                      {p.retrainings.map((r, i) => (
                        <Text key={i} size='xs' c='dimmed'>
                          Recapacitación {r.mode} {r.sessionDate}: {r.result === 'asistio' ? 'asistió' : r.result === 'aprobo' ? 'aprobó' : 'reprobó'}
                        </Text>
                      ))}
                    </Table.Td>
                    {view.canRetrain && (
                      <Table.Td>
                        {p.status === 'recapacitacion' && onRetrain && (
                          <Button size='xs' variant='light' color='orange' onClick={() => setRetrain({ email: p.email, mode: 'presencial', sessionDate: '', result: 'asistio', notes: '' })} data-testid={`sgc-recapacitar-${p.email}`}>
                            Registrar recapacitación
                          </Button>
                        )}
                      </Table.Td>
                    )}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {retrain && onRetrain && (
            <Card withBorder p='sm' data-testid='sgc-recapacitacion-form'>
              <Text size='sm' fw={600} mb='xs'>
                Recapacitación de {retrain.email}
              </Text>
              <Grid>
                <Grid.Col span={{ base: 12, md: 3 }}>
                  <SgcSelect label='Modalidad' data={[{ value: 'presencial', label: 'Presencial' }, { value: 'virtual', label: 'Virtual' }]} value={retrain.mode} onChange={(v) => setRetrain({ ...retrain, mode: v ?? 'presencial' })} allowDeselect={false} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 3 }}>
                  <TextInput label='Fecha (AAAA-MM-DD)' value={retrain.sessionDate} onChange={(e) => setRetrain({ ...retrain, sessionDate: e.currentTarget.value })} autoComplete='off' />
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 3 }}>
                  <SgcSelect label='Resultado' data={[{ value: 'asistio', label: 'Asistió' }, { value: 'aprobo', label: 'Aprobó' }, { value: 'reprobo', label: 'Reprobó' }]} value={retrain.result} onChange={(v) => setRetrain({ ...retrain, result: v ?? 'asistio' })} allowDeselect={false} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 3 }}>
                  <TextInput label='Observaciones' value={retrain.notes} onChange={(e) => setRetrain({ ...retrain, notes: e.currentTarget.value })} autoComplete='off' />
                </Grid.Col>
              </Grid>
              <Group mt='sm'>
                <Button size='xs' onClick={() => void onRetrain(retrain).then((ok) => ok && setRetrain(null))} data-testid='sgc-recapacitacion-guardar'>
                  Guardar recapacitación
                </Button>
                <Button size='xs' variant='default' onClick={() => setRetrain(null)}>
                  Cancelar
                </Button>
              </Group>
            </Card>
          )}
          {view.outOfScope.length > 0 && (
            <Text size='xs' c='dimmed'>
              Respuestas de personas fuera del alcance (no cuentan): {view.outOfScope.map((o) => o.email).join(', ')}.
            </Text>
          )}
        </Stack>
      )}
    </Card>
  );
}
