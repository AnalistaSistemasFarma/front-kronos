'use client';

import { useState } from 'react';
import { Alert, Badge, Button, Card, Checkbox, Group, Loader, Radio, Stack, Table, Text, Title } from '@mantine/core';
import { IconCheck, IconClipboardCheck, IconLock, IconSend } from '@tabler/icons-react';
import { sgcSend, useSgcFetch } from '../useSgcFetch';
import type { SgcPublicQuestion } from '../../../lib/sgc/training/evaluationKinds';
import { formatDateCO } from './format';

/**
 * EVALUACIÓN EN SYNERLINK del lector (S17–S18, R30): debajo del documento,
 * después de firmar «Leído». Las preguntas llegan SIN las respuestas
 * correctas y el servidor califica: la pantalla solo muestra el puntaje, si
 * aprobó y los intentos que le quedan (no revela qué preguntas falló, para
 * que el siguiente intento siga siendo una evaluación). Mismos componentes de
 * formulario de Mantine que el resto de SynerLink.
 */
interface ReaderEvaluation {
  title: string;
  minScorePct: number;
  maxAttempts: number;
  maxScore: number;
  questions: SgcPublicQuestion[];
  attempts: { attemptNumber: number; score: number; percent: number; passed: boolean; submittedAt: string }[];
  canAttempt: boolean;
  reason: string | null;
  retrainingRequired: boolean;
}

interface AttemptResult {
  attemptNumber: number;
  score: number;
  maxScore: number;
  percent: number;
  passed: boolean;
  attemptsLeft: number;
  retrainingRequired: boolean;
}

export default function SgcEvaluationTaker({ url }: { url: string }) {
  const { data, error, loading, reload } = useSgcFetch<ReaderEvaluation>(url);
  const [answers, setAnswers] = useState<Record<number, number[]>>({});
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  if (loading && !data) return <Loader size='sm' />;
  if (error) return <Alert color='red'>{error}</Alert>;
  if (!data) return null;
  const answered = data.questions.every((q) => (answers[q.id] ?? []).length > 0);

  const submit = async () => {
    setSending(true);
    setFailure(null);
    try {
      const res = await sgcSend<AttemptResult>(url, 'POST', { answers });
      setResult(res);
      setAnswers({});
      reload();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <Card withBorder radius='md' p='lg' mt='md' data-testid='sgc-evaluacion'>
      <Group justify='space-between' mb='xs' wrap='wrap'>
        <Title order={4} className='flex items-center gap-2'>
          <IconClipboardCheck size={18} className='text-blue-6' />
          Evaluación · {data.title}
        </Title>
        <Badge variant='light' size='lg' radius='sm' color={data.attempts.some((a) => a.passed) ? 'green' : data.retrainingRequired ? 'orange' : 'blue'} data-testid='sgc-evaluacion-estado'>
          {data.attempts.some((a) => a.passed) ? 'Aprobada' : data.retrainingRequired ? 'Recapacitación' : `${data.attempts.length} de ${data.maxAttempts} intento(s)`}
        </Badge>
      </Group>
      <Text size='sm' c='dimmed' mb='md'>
        Nota mínima {data.minScorePct} % de {data.maxScore} punto(s). Tiene {data.maxAttempts} intento(s); si no aprueba en ellos, el creador del documento o Calidad le programan una recapacitación.
      </Text>
      {result && (
        <Alert color={result.passed ? 'green' : 'orange'} icon={<IconCheck size={16} />} mb='md' data-testid='sgc-evaluacion-resultado'>
          Intento {result.attemptNumber}: {result.score} de {result.maxScore} puntos ({result.percent} %). {result.passed ? 'Aprobó la evaluación.' : result.retrainingRequired ? 'No aprobó y agotó los intentos: queda en recapacitación.' : `No aprobó: le queda(n) ${result.attemptsLeft} intento(s).`}
        </Alert>
      )}
      {failure && (
        <Alert color='red' mb='md' data-testid='sgc-evaluacion-error'>
          {failure}
        </Alert>
      )}
      {data.attempts.length > 0 && (
        <Table.ScrollContainer minWidth={420} mb='md'>
          <Table striped data-testid='sgc-evaluacion-intentos'>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Intento</Table.Th>
                <Table.Th>Puntaje</Table.Th>
                <Table.Th>Resultado</Table.Th>
                <Table.Th>Fecha</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.attempts.map((a) => (
                <Table.Tr key={a.attemptNumber}>
                  <Table.Td>{a.attemptNumber}</Table.Td>
                  <Table.Td>
                    {a.score} ({a.percent} %)
                  </Table.Td>
                  <Table.Td>
                    <Badge color={a.passed ? 'green' : 'red'} variant='light'>
                      {a.passed ? 'Aprobó' : 'No aprobó'}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{formatDateCO(a.submittedAt)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {!data.canAttempt ? (
        <Alert color='gray' icon={<IconLock size={16} />} data-testid='sgc-evaluacion-cerrada'>
          {data.reason}
        </Alert>
      ) : (
        <Stack gap='md'>
          {data.questions.map((q, i) => (
            <Card key={q.id} withBorder radius='md' p='md' data-testid='sgc-evaluacion-pregunta'>
              <Text size='sm' fw={600} mb='xs'>
                {i + 1}. {q.text}{' '}
                <Text span size='xs' c='dimmed'>
                  ({q.points} pt{q.points === 1 ? '' : 's'}){q.kind === 'multiple' ? ' · marque todas las correctas' : ''}
                </Text>
              </Text>
              {q.kind === 'multiple' ? (
                <Checkbox.Group value={(answers[q.id] ?? []).map(String)} onChange={(v) => setAnswers({ ...answers, [q.id]: v.map(Number) })}>
                  <Stack gap={6}>
                    {q.options.map((o) => (
                      <Checkbox key={o.id} value={String(o.id)} label={o.text} />
                    ))}
                  </Stack>
                </Checkbox.Group>
              ) : (
                <Radio.Group value={answers[q.id]?.[0] ? String(answers[q.id][0]) : null} onChange={(v) => setAnswers({ ...answers, [q.id]: [Number(v)] })}>
                  <Stack gap={6}>
                    {q.options.map((o) => (
                      <Radio key={o.id} value={String(o.id)} label={o.text} />
                    ))}
                  </Stack>
                </Radio.Group>
              )}
            </Card>
          ))}
          <Group justify='flex-end'>
            <Button leftSection={<IconSend size={16} />} loading={sending} disabled={!answered} onClick={() => void submit()} data-testid='sgc-evaluacion-enviar'>
              Enviar evaluación (intento {data.attempts.length + 1} de {data.maxAttempts})
            </Button>
          </Group>
        </Stack>
      )}
    </Card>
  );
}
