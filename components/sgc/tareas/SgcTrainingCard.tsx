'use client';

import { useEffect, useState } from 'react';
import { Alert, Anchor, Badge, Button, Card, Code, FileButton, Grid, Group, NumberInput, Stack, Table, Text, TextInput, Textarea, Title } from '@mantine/core';
import SgcSelect from '../SgcSelect';
import { IconCalendarEvent, IconChecklist, IconDownload, IconEye, IconFileSpreadsheet, IconSchool, IconUpload } from '@tabler/icons-react';
import SgcEvaluationBuilder from './SgcEvaluationBuilder';
import SgcDocumentViewerModal from '../SgcDocumentViewerModal';
import type { SgcRequestDetail } from '../../../lib/sgc/db/requests';
import { SGC_TRAINING_DEFAULT_MAX_ATTEMPTS, SGC_TRAINING_DEFAULT_MIN_PCT, SGC_TRAINING_MODE_LABELS, SGC_TRAINING_RESULTS_TEMPLATE_CSV, SGC_TRAINING_RESULTS_TEMPLATE_NAME, type SgcTrainingMode } from '../../../lib/sgc/training/results';

/** S14 (R29): plantilla estándar de resultados (CSV con los encabezados que el SGC reconoce), generada en el navegador. */
function downloadResultsTemplate() {
  const url = URL.createObjectURL(new Blob([SGC_TRAINING_RESULTS_TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = SGC_TRAINING_RESULTS_TEMPLATE_NAME;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
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
  /** S15 (R27): personas para «Quién dicta» (selector; también «Externo»). */
  users?: { value: string; label: string }[];
  /** S17–S18 (R30): solicitud (banco de preguntas, consolidación y reporte de la evaluación en SynerLink). */
  requestId?: number;
  /** S18 (R30): consolida los resultados de la evaluación en SynerLink (genera el Excel de resultados). */
  onConsolidate?: () => Promise<boolean>;
  /** Recarga la solicitud (p. ej. después de guardar el banco de preguntas). */
  onChanged?: () => void;
}

/** S15 (R27): opción «Externo» de «Quién dicta». */
const EXTERNAL = '__externo__';
const EXTERNAL_PREFIX = 'Externo: ';

/** Valor guardado (texto) → selección del formulario. */
export function instructorChoiceOf(saved: string | null | undefined, users: { value: string; label: string }[]): { choice: string | null; external: string } {
  const v = (saved ?? '').trim();
  if (!v) return { choice: null, external: '' };
  const user = users.find((u) => u.label === v || u.value === v.toLowerCase());
  if (user) return { choice: user.value, external: '' };
  return { choice: EXTERNAL, external: v.startsWith(EXTERNAL_PREFIX) ? v.slice(EXTERNAL_PREFIX.length) : v };
}

/** Selección del formulario → valor que se guarda (texto legible, hasta 200 caracteres). */
export function instructorValueOf(choice: string | null, external: string, users: { value: string; label: string }[]): string {
  if (!choice) return '';
  if (choice === EXTERNAL) return external.trim() ? `${EXTERNAL_PREFIX}${external.trim()}`.slice(0, 200) : '';
  return (users.find((u) => u.value === choice)?.label ?? choice).slice(0, 200);
}

const STATUS: Record<string, { label: string; color: string }> = {
  aprobo: { label: 'Aprobó', color: 'green' },
  reprobo: { label: 'Reprobó', color: 'red' },
  recapacitacion: { label: 'Recapacitación', color: 'orange' },
  sin_resultado: { label: 'Sin resultado', color: 'gray' },
};

export default function SgcTrainingCard({ view, onSave, onUpload, onRetrain, users = [], requestId, onConsolidate, onChanged }: SgcTrainingCardProps) {
  const t = view.training;
  const [reportOpen, setReportOpen] = useState(false);
  const own = t?.evaluationProvider === 'synerlink';
  const [instructor, setInstructor] = useState(() => instructorChoiceOf(t?.instructor, users));
  useEffect(() => setInstructor(instructorChoiceOf(t?.instructor, users)), [t?.instructor, users]);
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
    // S17 (R30): «forms» (Microsoft Forms o Google Forms) o «synerlink» (evaluación propia).
    evaluationProvider: t?.evaluationProvider === 'synerlink' ? 'synerlink' : 'forms',
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
          ? view.byCreator
            ? 'Antes de la divulgación, el creador del documento registra el material: el video o la sesión, quién la dicta y la evaluación en Microsoft Forms o Google Forms. La lectura los muestra debajo del documento.'
            : 'Antes de la divulgación, Calidad registra el material: el video o la sesión y la evaluación en Microsoft Forms o Google Forms. La lectura los muestra debajo del documento.'
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
              {/* S17 (R30, D19): la evaluación convive en Forms o en SynerLink; se elige por capacitación. */}
              <SgcSelect
                label='Evaluación'
                data={[
                  { value: 'forms', label: 'Microsoft Forms o Google Forms' },
                  { value: 'synerlink', label: 'En SynerLink (preguntas en la app)' },
                ]}
                value={form.evaluationProvider}
                onChange={(v) => set('evaluationProvider', v ?? 'forms')}
                allowDeselect={false}
                data-testid='sgc-capacitacion-proveedor'
              />
            </Grid.Col>
            {form.evaluationProvider === 'forms' && (
              <Grid.Col span={12}>
                <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Enlace de la evaluación en Microsoft Forms o Google Forms (https)' required value={form.formsUrl} onChange={(e) => set('formsUrl', e.currentTarget.value)} data-testid='sgc-capacitacion-forms' />
              </Grid.Col>
            )}
            <Grid.Col span={{ base: 12, md: 4 }}>
              {/* S14 (R28): fecha con calendario, igual que los filtros de fecha de SynerLink (campo de fecha nativo: calendario también en el celular). */}
              <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' type='date' label='Fecha de la sesión' leftSection={<IconCalendarEvent size={16} />} value={form.sessionDate} onChange={(e) => set('sessionDate', e.currentTarget.value)} data-testid='sgc-capacitacion-fecha' />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 4 }}>
              {/* S15 (R27): «Quién dicta» se elige entre las personas (o «Externo» con su nombre). */}
              <SgcSelect
                label='Quién dicta'
                placeholder='Seleccione la persona'
                searchable
                clearable
                data={[...users, { value: EXTERNAL, label: 'Externo (escriba el nombre)' }]}
                value={instructor.choice}
                onChange={(v) => setInstructor({ choice: v, external: v === EXTERNAL ? instructor.external : '' })}
                data-testid='sgc-capacitacion-quien-dicta'
              />
              {instructor.choice === EXTERNAL && (
                <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' mt='xs' placeholder='Nombre de quien dicta (externo)' value={instructor.external} onChange={(e) => setInstructor({ choice: EXTERNAL, external: e.currentTarget.value })} data-testid='sgc-capacitacion-quien-dicta-externo' />
              )}
            </Grid.Col>
            {form.evaluationProvider === 'forms' && (
              <Grid.Col span={{ base: 6, md: 2 }}>
                <NumberInput label='Puntaje máximo' min={1} max={1000} value={form.maxScore} onChange={(v) => set('maxScore', v)} data-testid='sgc-capacitacion-maximo' />
              </Grid.Col>
            )}
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
                const own = form.evaluationProvider === 'synerlink';
                const ok = await onSave({ ...form, evaluationProvider: own ? 'synerlink' : undefined, formsUrl: own ? '' : form.formsUrl, maxScore: own ? undefined : form.maxScore, instructor: instructorValueOf(instructor.choice, instructor.external, users) });
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
          {/* S18 (R30): con la evaluación en SynerLink se consolida en la app (sin cargar un Excel). */}
          {view.canUpload && own && onConsolidate && (
            <Button leftSection={<IconChecklist size={14} />} onClick={() => void onConsolidate()} data-testid='sgc-capacitacion-consolidar'>
              {up ? 'Consolidar de nuevo los resultados' : 'Consolidar resultados de la evaluación'}
            </Button>
          )}
          {view.canUpload && !own && (
            <FileButton onChange={(f) => f && void onUpload(f)} accept='.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv'>
              {(props) => (
                <Button {...props} leftSection={<IconUpload size={14} />} data-testid='sgc-capacitacion-cargar'>
                  {up ? 'Cargar de nuevo los resultados' : 'Cargar resultados (Excel o CSV de Forms)'}
                </Button>
              )}
            </FileButton>
          )}
          {view.canUpload && !own && (
            <Button variant='subtle' leftSection={<IconDownload size={14} />} onClick={downloadResultsTemplate} data-testid='sgc-capacitacion-plantilla'>
              Plantilla estándar de resultados
            </Button>
          )}
        </Group>
      )}
      {!t && !view.canManage && <Text size='sm' c='dimmed'>{view.byCreator ? 'El creador del documento aún no registra la capacitación.' : 'Calidad aún no registra la capacitación.'}</Text>}

      {/* S17 (R30): banco de preguntas de la evaluación en SynerLink (lo arma el creador del documento o Calidad). */}
      {t && own && view.canManage && requestId && <SgcEvaluationBuilder requestId={requestId} onSaved={onChanged} />}
      {/* S18 (R30): avance de la evaluación (antes de consolidar) para el creador y Calidad. */}
      {own && view.evaluation && !up && (
        <Table.ScrollContainer minWidth={480} mt='md'>
          <Table striped data-testid='sgc-evaluacion-avance'>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Persona</Table.Th>
                <Table.Th>Intentos</Table.Th>
                <Table.Th>Mejor %</Table.Th>
                <Table.Th>Estado</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {view.evaluation.people.map((p) => (
                <Table.Tr key={p.email}>
                  <Table.Td>{p.email}</Table.Td>
                  <Table.Td>{p.attempts}</Table.Td>
                  <Table.Td>{p.bestPercent ?? '—'}</Table.Td>
                  <Table.Td>
                    <Badge variant='light' color={p.passed ? 'green' : p.retrainingRequired ? 'orange' : p.attempts ? 'red' : 'gray'}>
                      {p.passed ? 'Aprobó' : p.retrainingRequired ? 'Recapacitación' : p.attempts ? 'No aprobó' : 'Sin presentar'}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

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
          {requestId && (view.canManage || view.canRetrain) && (
            <Button size='xs' variant='subtle' leftSection={<IconEye size={14} />} w='fit-content' onClick={() => setReportOpen(true)} data-testid='sgc-capacitacion-reporte'>
              Ver el reporte de resultados
            </Button>
          )}
          <Text size='sm' data-testid='sgc-capacitacion-resumen'>
            Del alcance: {up.summary.passed} aprobaron, {up.summary.failed} reprobaron, {up.summary.missing.length} sin resultado · fuera del alcance: {up.summary.outOfScope} · filas no leídas: {up.summary.rejected.length}
          </Text>
          {up.summary.rejected.length > 0 && (
            <Alert color='orange' data-testid='sgc-capacitacion-filas-no-leidas'>
              <Text size='sm'>Filas del archivo que no se leyeron (no cuentan):</Text>
              {up.summary.rejected.slice(0, 8).map((r) => (
                <Text key={r.row} size='xs'>
                  Fila {r.row}: {r.reason}
                </Text>
              ))}
              {up.summary.rejected.length > 8 && <Text size='xs'>… y {up.summary.rejected.length - 8} más.</Text>}
            </Alert>
          )}
          {up.needsJustification && view.open && (
            <Alert color='yellow'>Hay personas que reprobaron o no presentaron: al cerrar la capacitación con la firma «Capacitó», el mismo formulario le pide la justificación.</Alert>
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
                  <TextInput type='date' label='Fecha' leftSection={<IconCalendarEvent size={16} />} value={retrain.sessionDate} onChange={(e) => setRetrain({ ...retrain, sessionDate: e.currentTarget.value })} autoComplete='off' data-testid='sgc-recapacitacion-fecha' />
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
      {requestId && <SgcDocumentViewerModal fileUrl={reportOpen ? `/api/sgc/requests/${requestId}/training/report` : null} title='Reporte de resultados de la capacitación' onClose={() => setReportOpen(false)} />}
    </Card>
  );
}
