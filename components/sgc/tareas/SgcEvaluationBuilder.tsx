'use client';

import { useEffect, useState } from 'react';
import { ActionIcon, Alert, Badge, Button, Card, Checkbox, Group, Loader, NumberInput, Radio, Stack, Text, TextInput, Textarea, Title } from '@mantine/core';
import { IconDeviceFloppy, IconLock, IconPlus, IconTrash } from '@tabler/icons-react';
import SgcSelect from '../SgcSelect';
import { sgcSend, useSgcFetch } from '../useSgcFetch';
import { SGC_EVALUATION_MAX_OPTIONS, SGC_EVALUATION_MAX_QUESTIONS, SGC_QUESTION_KINDS, SGC_QUESTION_KIND_LABELS, type SgcQuestionKind } from '../../../lib/sgc/training/evaluationKinds';

/**
 * BANCO DE PREGUNTAS de la evaluación en SynerLink (S17, R30): lo arma el
 * creador del documento (o Calidad) en la preparación de la capacitación.
 * Opción única, opción múltiple (todas las correctas) y verdadero o falso,
 * con su puntaje; el puntaje máximo es la suma. Con intentos presentados el
 * banco queda congelado (solo lectura). Mismos componentes de formulario de
 * Mantine que el resto de SynerLink.
 */
interface EditorQuestion {
  kind: SgcQuestionKind;
  text: string;
  points: number;
  options: { text: string; correct: boolean }[];
}

interface EditorData {
  training: { id: number; provider: string | null } | null;
  questions: { id: number; kind: SgcQuestionKind; text: string; points: number; options: { id: number; text: string; correct: boolean }[] }[];
  attempts: number;
  locked: boolean;
}

const blank = (kind: SgcQuestionKind = 'unica'): EditorQuestion =>
  kind === 'vf'
    ? { kind, text: '', points: 1, options: [{ text: 'Verdadero', correct: true }, { text: 'Falso', correct: false }] }
    : { kind, text: '', points: 1, options: [{ text: '', correct: true }, { text: '', correct: false }] };

export default function SgcEvaluationBuilder({ requestId, onSaved }: { requestId: number; onSaved?: () => void }) {
  const { data, error, loading, reload } = useSgcFetch<EditorData>(`/api/sgc/requests/${requestId}/training/evaluation`);
  const [questions, setQuestions] = useState<EditorQuestion[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setQuestions(data.questions.length ? data.questions.map((q) => ({ kind: q.kind, text: q.text, points: q.points, options: q.options.map((o) => ({ text: o.text, correct: o.correct })) })) : [blank()]);
  }, [data]);

  if (loading && !data) return <Loader size='sm' />;
  if (error) return <Alert color='red'>{error}</Alert>;
  if (!data) return null;
  const total = Math.round(questions.reduce((s, q) => s + (Number(q.points) || 0), 0) * 100) / 100;
  const setQ = (i: number, q: EditorQuestion) => setQuestions(questions.map((x, j) => (j === i ? q : x)));

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await sgcSend<{ questions: number; maxScore: number }>(`/api/sgc/requests/${requestId}/training/evaluation`, 'PUT', { questions: questions.map((q) => (q.kind === 'vf' ? { ...q, correct: q.options[0].correct } : q)) });
      setMsg({ ok: true, text: `Evaluación guardada: ${res.questions} pregunta(s), ${res.maxScore} punto(s).` });
      reload();
      onSaved?.();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card withBorder radius='md' p='md' mt='md' data-testid='sgc-evaluacion-banco'>
      <Group justify='space-between' mb='xs' wrap='wrap'>
        <Title order={5}>Evaluación en SynerLink</Title>
        <Badge variant='light' color={data.locked ? 'gray' : 'blue'}>
          {questions.length} pregunta(s) · {total} punto(s)
        </Badge>
      </Group>
      <Text size='sm' c='dimmed' mb='sm'>
        Las respuestas correctas solo las ve quien arma la evaluación: el lector recibe las preguntas sin ellas y el sistema califica. El puntaje máximo es la suma de los puntajes.
      </Text>
      {data.locked && (
        <Alert color='gray' icon={<IconLock size={16} />} mb='sm' data-testid='sgc-evaluacion-banco-congelado'>
          Ya hay {data.attempts} intento(s) presentados: el banco de preguntas quedó congelado.
        </Alert>
      )}
      {msg && (
        <Alert color={msg.ok ? 'green' : 'red'} mb='sm' data-testid='sgc-evaluacion-banco-mensaje'>
          {msg.text}
        </Alert>
      )}
      <Stack gap='sm'>
        {questions.map((q, i) => (
          <Card key={i} withBorder radius='md' p='sm' data-testid='sgc-evaluacion-banco-pregunta'>
            <Group align='flex-end' wrap='wrap' gap='xs'>
              <SgcSelect
                label={`Pregunta ${i + 1}`}
                data={SGC_QUESTION_KINDS.map((k) => ({ value: k, label: SGC_QUESTION_KIND_LABELS[k] }))}
                value={q.kind}
                onChange={(v) => v && setQ(i, { ...blank(v as SgcQuestionKind), text: q.text, points: q.points })}
                allowDeselect={false}
                disabled={data.locked}
                w={240}
              />
              <NumberInput label='Puntaje' min={0.5} max={100} step={0.5} value={q.points} onChange={(v) => setQ(i, { ...q, points: Number(v) || 0 })} disabled={data.locked} w={110} />
              {!data.locked && questions.length > 1 && (
                <ActionIcon variant='subtle' color='red' aria-label='Quitar la pregunta' onClick={() => setQuestions(questions.filter((_, j) => j !== i))}>
                  <IconTrash size={16} />
                </ActionIcon>
              )}
            </Group>
            <Textarea mt='xs' label='Enunciado' autosize minRows={1} value={q.text} onChange={(e) => setQ(i, { ...q, text: e.currentTarget.value })} disabled={data.locked} autoComplete='off' data-testid='sgc-evaluacion-banco-enunciado' />
            {q.kind === 'vf' ? (
              <Radio.Group mt='xs' label='Respuesta correcta' value={q.options[0].correct ? 'v' : 'f'} onChange={(v) => setQ(i, { ...q, options: [{ text: 'Verdadero', correct: v === 'v' }, { text: 'Falso', correct: v === 'f' }] })}>
                <Group>
                  <Radio value='v' label='Verdadero' disabled={data.locked} />
                  <Radio value='f' label='Falso' disabled={data.locked} />
                </Group>
              </Radio.Group>
            ) : (
              <Stack gap={6} mt='xs'>
                <Text size='xs' c='dimmed'>
                  {q.kind === 'unica' ? 'Marque la única opción correcta.' : 'Marque todas las opciones correctas (se califica todo o nada).'}
                </Text>
                {q.options.map((o, j) => (
                  <Group key={j} gap='xs' wrap='nowrap'>
                    {q.kind === 'unica' ? (
                      <Radio checked={o.correct} onChange={() => setQ(i, { ...q, options: q.options.map((x, k) => ({ ...x, correct: k === j })) })} disabled={data.locked} aria-label={`Opción ${j + 1} correcta`} />
                    ) : (
                      <Checkbox checked={o.correct} onChange={(e) => setQ(i, { ...q, options: q.options.map((x, k) => (k === j ? { ...x, correct: e.currentTarget.checked } : x)) })} disabled={data.locked} aria-label={`Opción ${j + 1} correcta`} />
                    )}
                    <TextInput style={{ flex: 1 }} placeholder={`Opción ${j + 1}`} value={o.text} onChange={(e) => setQ(i, { ...q, options: q.options.map((x, k) => (k === j ? { ...x, text: e.currentTarget.value } : x)) })} disabled={data.locked} autoComplete='off' />
                    {!data.locked && q.options.length > 2 && (
                      <ActionIcon variant='subtle' color='red' aria-label='Quitar la opción' onClick={() => setQ(i, { ...q, options: q.options.filter((_, k) => k !== j) })}>
                        <IconTrash size={14} />
                      </ActionIcon>
                    )}
                  </Group>
                ))}
                {!data.locked && q.options.length < SGC_EVALUATION_MAX_OPTIONS && (
                  <Button size='xs' variant='subtle' leftSection={<IconPlus size={12} />} onClick={() => setQ(i, { ...q, options: [...q.options, { text: '', correct: false }] })} w='fit-content'>
                    Agregar opción
                  </Button>
                )}
              </Stack>
            )}
          </Card>
        ))}
        {!data.locked && (
          <Group justify='space-between' wrap='wrap'>
            <Button variant='light' leftSection={<IconPlus size={14} />} disabled={questions.length >= SGC_EVALUATION_MAX_QUESTIONS} onClick={() => setQuestions([...questions, blank()])} data-testid='sgc-evaluacion-banco-agregar'>
              Agregar pregunta
            </Button>
            <Button leftSection={<IconDeviceFloppy size={16} />} loading={saving} onClick={() => void save()} data-testid='sgc-evaluacion-banco-guardar'>
              Guardar evaluación
            </Button>
          </Group>
        )}
      </Stack>
    </Card>
  );
}
