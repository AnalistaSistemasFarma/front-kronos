'use client';

import Link from 'next/link';
import { Alert, Anchor, Badge, Button, Card, Code, Group, ScrollArea, Stack, Table, Text, Title } from '@mantine/core';
import { IconAlertCircle, IconEdit, IconFileCertificate, IconRefresh, IconSignature } from '@tabler/icons-react';
import type { SgcRequestDetail } from '../../../lib/sgc/db/requests';
import { formatDateCO } from '../tareas/format';
import { draftEditorHref } from '../../../lib/sgc/draft/view';

/**
 * Tarjeta «Firmas electrónicas y borrador» de la solicitud documental
 * (Sprint 3): borrador vigente (lo que se firma, con su SHA-256) y su edición
 * en la app, traza de firmas (significado, firmante, sello de tiempo del
 * servidor, motivo, huellas), listas de chequeo de Calidad y el PDF
 * controlado generado al cerrar la Aprobación.
 */
export default function SgcSignaturesCard({ data, onRetryPdf, idTask = null }: { data: SgcRequestDetail; onRetryPdf: () => Promise<void>; idTask?: number | null }) {
  const { request, permissions, currentDraft, signatures, qualityChecks, controlledPdf, draftRevisions } = data;
  const editorHref = draftEditorHref(request.id, request.idCompany, idTask);
  return (
    <Card shadow='sm' p='xl' radius='md' withBorder mt='6' data-testid='sgc-firmas'>
      <Group justify='space-between' mb='sm'>
        <Title order={4} className='flex items-center gap-2'>
          <IconSignature size={18} />
          Firmas electrónicas y borrador
        </Title>
        {permissions.canUploadDraft && (
          <Button component={Link} href={editorHref} leftSection={<IconEdit size={16} />} variant='light' data-testid='sgc-editar-borrador'>
            Editar borrador en la app
          </Button>
        )}
      </Group>
      <Stack gap='sm'>
        <div>
          <Text size='sm' color='gray.6' fw={500}>
            Borrador vigente (lo que se firma)
          </Text>
          {currentDraft ? (
            <Text size='sm' data-testid='sgc-borrador-vigente'>
              {currentDraft.kind === 'borrador_editor' ? (
                <Anchor component={Link} href={editorHref}>
                  {currentDraft.name}
                </Anchor>
              ) : (
                currentDraft.name
              )}{' '}
              · {formatDateCO(currentDraft.at)} · SHA-256 <Code>{currentDraft.sha256}</Code>
            </Text>
          ) : (
            <Text size='sm' c='dimmed'>
              Aún no hay borrador. El elaborador lo carga (Word .docx o PDF) o lo edita en la app.
            </Text>
          )}
          {draftRevisions.length > 0 && (
            <Text size='xs' c='dimmed'>
              {draftRevisions.length} revisión(es) guardada(s) en el editor de la app; la última es la {draftRevisions.at(-1)!.number}.
            </Text>
          )}
        </div>

        {signatures.length > 0 ? (
          <ScrollArea type='auto'>
            <Table withTableBorder striped verticalSpacing='xs' miw={800}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Significado</Table.Th>
                  <Table.Th>Firmante</Table.Th>
                  <Table.Th>Sello de tiempo (servidor)</Table.Th>
                  <Table.Th>Motivo</Table.Th>
                  <Table.Th>Huellas</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {signatures.map((s) => (
                  <Table.Tr key={s.uid} data-testid='sgc-firma-fila' data-meaning={s.meaning}>
                    <Table.Td>
                      <Badge variant='light' color='teal'>
                        {s.meaningLabel}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size='sm'>{s.signerName ?? s.signerEmail}</Text>
                      <Text size='xs' c='dimmed'>
                        {s.signerEmail}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size='sm'>{formatDateCO(s.signedAt)}</Text>
                      <Text size='xs' c='dimmed'>
                        {s.signedAt}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size='sm'>{s.reason}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size='xs'>
                        Contenido <Code>{s.contentSha256.slice(0, 16)}…</Code>
                      </Text>
                      <Text size='xs'>
                        Registro <Code>{s.recordHash.slice(0, 16)}…</Code>
                      </Text>
                      {s.evidencePath && (
                        <Text size='xs' c='dimmed'>
                          Evidencia: {s.evidencePath}
                        </Text>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        ) : (
          <Text size='sm' c='dimmed'>
            Aún no hay firmas electrónicas en esta solicitud.
          </Text>
        )}

        {qualityChecks.map((q) => (
          <Card key={q.id} withBorder radius='md' p='sm' data-testid='sgc-chequeo-resultado'>
            <Group justify='space-between'>
              <Text size='sm' fw={600}>
                Lista de chequeo de Calidad — {q.checkedBy} · {formatDateCO(q.checkedAt)}
              </Text>
              <Badge color={q.result === 'conforme' ? 'teal' : 'orange'}>{q.result === 'conforme' ? 'Conforme' : 'No conforme'}</Badge>
            </Group>
            {q.items.map((i) => (
              <Text size='xs' key={i.key}>
                {i.label}: <strong>{i.answerLabel}</strong>
                {i.observation ? ` — ${i.observation}` : ''}
              </Text>
            ))}
          </Card>
        ))}

        {controlledPdf.status && (
          <Alert
            color={controlledPdf.status === 'generado' ? 'teal' : 'red'}
            icon={controlledPdf.status === 'generado' ? <IconFileCertificate size={16} /> : <IconAlertCircle size={16} />}
            title={controlledPdf.status === 'generado' ? 'PDF controlado generado' : 'PDF controlado pendiente'}
            data-testid='sgc-pdf-controlado'
            data-status={controlledPdf.status}
          >
            {controlledPdf.status === 'generado' ? (
              <Text size='sm'>
                Versión aprobada, pendiente de divulgación (Sprint 4).{' '}
                {controlledPdf.idDocument && (
                  <Anchor component={Link} href={`/process/sgc-documental/documentos/${controlledPdf.idDocument}?empresa=${request.idCompany}`}>
                    Ver la ficha del documento
                  </Anchor>
                )}
              </Text>
            ) : (
              <Stack gap={4}>
                <Text size='sm'>No se pudo generar el PDF controlado{controlledPdf.error ? `: ${controlledPdf.error}` : '.'}</Text>
                {permissions.isQuality && (
                  <Button size='xs' variant='light' leftSection={<IconRefresh size={14} />} onClick={onRetryPdf} w='fit-content' data-testid='sgc-pdf-reintentar'>
                    Reintentar
                  </Button>
                )}
              </Stack>
            )}
          </Alert>
        )}
      </Stack>
    </Card>
  );
}
