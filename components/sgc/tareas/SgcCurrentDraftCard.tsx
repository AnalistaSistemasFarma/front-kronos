'use client';

import Link from 'next/link';
import { Alert, Badge, Button, Card, Code, Group, Stack, Text, Title } from '@mantine/core';
import { IconArrowBackUp, IconEye, IconFileCheck } from '@tabler/icons-react';
import type { SgcRequestDetail } from '../../../lib/sgc/db/requests';
import { buildRoundNotice, draftCardTitle, draftEditorHref, summarizeCurrentDraft } from '../../../lib/sgc/draft/view';
import { formatDateCO } from './format';

/**
 * Tarjeta destacada «Documento a revisar / aprobar / elaborar» en la parte
 * superior del detalle de la solicitud documental: QUÉ documento es el
 * borrador vigente (lo que se firma), de dónde salió, quién y cuándo, su
 * SHA-256 corto y el botón «Ver documento» (el mismo enlace que ya usaba la
 * tarjeta de firmas y el modal de firma: el editor de la app o el adjunto
 * registrado). Si la solicitud viene de una devolución, el aviso de ronda
 * dice quién devolvió, cuándo, con qué observaciones y qué cambió.
 * Solo lectura: no cambia el flujo ni el cálculo del borrador vigente.
 */
export default function SgcCurrentDraftCard({ data, openTask, idTask }: { data: SgcRequestDetail; openTask: { key: string; round: number } | null; idTask: number | null }) {
  const { request, currentDraft, attachments, draftRevisions, interactions, tasks } = data;
  const summary = summarizeCurrentDraft(currentDraft, attachments, draftRevisions);
  const notice = buildRoundNotice({ openTask, tasks, interactions, attachments, revisions: draftRevisions });
  if (!summary && !notice) return null;
  const href = currentDraft
    ? currentDraft.kind === 'borrador_editor'
      ? draftEditorHref(request.id, request.idCompany, idTask)
      : `/api/sgc/requests/${request.id}/attachments/${currentDraft.ref.split(':')[1]}`
    : null;
  return (
    <Card shadow='sm' p='xl' radius='md' withBorder mb='6' style={{ borderLeft: '4px solid var(--mantine-color-blue-6)' }} data-testid='sgc-documento-vigente'>
      <Group justify='space-between' align='flex-start' wrap='wrap' gap='md'>
        <Stack gap={4} style={{ flex: 1, minWidth: 260 }}>
          <Title order={4} className='flex items-center gap-2'>
            <IconFileCheck size={18} className='text-blue-6' />
            {draftCardTitle(openTask?.key)}
            {notice && (
              <Badge color='orange' variant='light' size='sm' data-testid='sgc-ronda-badge'>
                Ronda {notice.round}
              </Badge>
            )}
          </Title>
          {summary ? (
            <>
              <Text size='lg' fw={700} data-testid='sgc-documento-vigente-nombre'>
                {summary.name}
              </Text>
              <Group gap='xs' wrap='wrap'>
                <Badge color='blue' variant='filled' size='sm'>
                  Vigente
                </Badge>
                <Text size='sm' data-testid='sgc-documento-vigente-origen'>
                  {summary.origin}
                </Text>
              </Group>
              <Text size='sm' c='dimmed'>
                {formatDateCO(summary.at)}
                {summary.author ? ` · ${summary.author}` : ''} · SHA-256 <Code title={summary.sha256}>{summary.shortSha}…</Code>
              </Text>
            </>
          ) : (
            <Text size='sm' c='dimmed'>
              Aún no hay borrador. El elaborador lo carga (Word .docx o PDF) o lo edita en la app.
            </Text>
          )}
        </Stack>
        {href &&
          (currentDraft?.kind === 'borrador_editor' ? (
            <Button component={Link} href={href} size='md' leftSection={<IconEye size={18} />} data-testid='sgc-ver-documento'>
              Ver documento
            </Button>
          ) : (
            <Button component='a' href={href} size='md' leftSection={<IconEye size={18} />} data-testid='sgc-ver-documento'>
              Ver documento
            </Button>
          ))}
      </Group>
      {notice && (
        <Alert color='orange' variant='light' mt='md' icon={<IconArrowBackUp size={16} />} title={`Ronda ${notice.round} · devuelto por ${notice.returnedBy} el ${formatDateCO(notice.returnedAt)}`} data-testid='sgc-aviso-ronda'>
          <Stack gap={6}>
            {notice.fromStep && (
              <Text size='sm'>
                Se devolvió desde «{notice.fromStep}» a elaboración.
              </Text>
            )}
            <div>
              <Text size='sm' fw={600}>
                Observaciones de la devolución
              </Text>
              <Text size='sm' className='whitespace-pre-line' data-testid='sgc-aviso-ronda-observaciones'>
                {notice.observations ?? 'Sin observaciones registradas.'}
              </Text>
            </div>
            <div>
              <Text size='sm' fw={600}>
                Qué cambió desde la devolución
              </Text>
              {notice.changes.map((c, i) => (
                <Text size='sm' key={i} data-testid='sgc-aviso-ronda-cambio'>
                  • {c}
                </Text>
              ))}
            </div>
          </Stack>
        </Alert>
      )}
    </Card>
  );
}
