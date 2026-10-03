'use client';

import { useState } from 'react';
import { ActionIcon, Badge, Button, Card, FileInput, Group, Modal, ScrollArea, Stack, Table, Text, Textarea, Title, Tooltip } from '@mantine/core';
import SgcSelect from '../SgcSelect';
import { IconDownload, IconEye, IconTrash, IconUpload } from '@tabler/icons-react';
import type { SgcRequestDetail } from '../../../lib/sgc/db/requests';
import { formatDateCO, formatFileSize } from './format';
import { attachmentDraftLabel } from '../../../lib/sgc/draft/view';

/**
 * «Archivos adjuntos» de la solicitud documental (copia del bloque de
 * SynerLink), sobre la carpeta propia SGC/<EMPRESA>/_solicitudes/SOL-<n>/ con
 * huella SHA-256. Un adjunto no se borra: se retira con motivo.
 */
type Attachment = SgcRequestDetail['attachments'][number];

export interface SgcAttachmentsCardProps {
  requestId: number;
  attachments: Attachment[];
  /** Borrador vigente (para marcar los adjuntos «borrador» como VIGENTE o REEMPLAZADO). */
  currentDraft?: SgcRequestDetail['currentDraft'];
  canUploadDraft: boolean;
  canUploadSupport: boolean;
  canWithdraw: (a: Attachment) => boolean;
  onUpload: (file: File, purpose: 'borrador' | 'soporte') => Promise<void>;
  onWithdraw: (id: number, reason: string) => Promise<void>;
}

export default function SgcAttachmentsCard({ requestId, attachments, currentDraft = null, canUploadDraft, canUploadSupport, canWithdraw, onUpload, onWithdraw }: SgcAttachmentsCardProps) {
  const [file, setFile] = useState<File | null>(null);
  const [purpose, setPurpose] = useState<'borrador' | 'soporte'>(canUploadDraft ? 'borrador' : 'soporte');
  const [uploading, setUploading] = useState(false);
  const [withdraw, setWithdraw] = useState<Attachment | null>(null);
  const [reason, setReason] = useState('');
  const active = attachments.filter((a) => !a.withdrawnAt);

  return (
    <Card shadow='sm' p='lg' radius='md' withBorder mt='6' data-testid='sgc-adjuntos'>
      <Group justify='space-between' align='center' mb='md' wrap='wrap'>
        <Title order={3} className='flex items-center gap-2'>
          <IconEye size={20} />
          Archivos adjuntos
          {active.length > 0 ? (
            <Text span size='sm' c='dimmed' fw={400}>
              ({active.length})
            </Text>
          ) : null}
        </Title>
      </Group>
      {attachments.length > 0 && (
        <ScrollArea.Autosize mah={{ base: 'none', sm: 560 }} offsetScrollbars type='auto' mb='md'>
          <Table className='doc-table' horizontalSpacing='md' verticalSpacing='sm' highlightOnHover withTableBorder withColumnBorders={false} style={{ width: '100%' }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Documento</Table.Th>
                <Table.Th>Tipo</Table.Th>
                <Table.Th>Cargado por</Table.Th>
                <Table.Th style={{ width: 100 }}>Abrir</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {attachments.map((a) => {
                const draftLabel = attachmentDraftLabel(a, currentDraft);
                return (
                <Table.Tr
                  key={a.id}
                  style={a.withdrawnAt || draftLabel === 'reemplazado' ? { opacity: 0.55 } : draftLabel === 'vigente' ? { background: 'var(--mantine-color-blue-0)' } : undefined}
                  data-testid='sgc-adjunto'
                  data-borrador={draftLabel ?? undefined}
                >
                  <Table.Td data-label='Documento'>
                    <Text size='sm' fw={700} lineClamp={2} td={a.withdrawnAt ? 'line-through' : undefined}>
                      {a.fileName}
                    </Text>
                    <Text size='xs' c='dimmed' mt={2}>
                      {formatFileSize(a.sizeBytes)} · {formatDateCO(a.createdAt, { month: 'short' })} · SHA-256 {a.sha256.slice(0, 12)}…
                    </Text>
                    {a.withdrawnAt && (
                      <Text size='xs' c='orange'>
                        Retirado: {a.withdrawReason}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td data-label='Tipo'>
                    <Group gap={4} wrap='wrap'>
                      <Badge variant='light' color={a.purpose === 'borrador' ? 'blue' : 'gray'} size='sm'>
                        {a.purpose === 'borrador' ? 'Borrador' : 'Soporte'}
                      </Badge>
                      {draftLabel === 'vigente' && (
                        <Badge variant='filled' color='blue' size='sm' data-testid='sgc-adjunto-vigente'>
                          Vigente
                        </Badge>
                      )}
                      {draftLabel === 'reemplazado' && (
                        <Tooltip label={currentDraft?.kind === 'borrador_editor' ? `El vigente es «${currentDraft.name}»` : 'Hay un borrador más reciente: no es lo que se firma'}>
                          <Badge variant='outline' color='gray' size='sm' data-testid='sgc-adjunto-reemplazado'>
                            Reemplazado
                          </Badge>
                        </Tooltip>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td data-label='Cargado por'>
                    <Text size='sm' lineClamp={1}>
                      {a.uploadedBy}
                    </Text>
                  </Table.Td>
                  <Table.Td data-label='Abrir'>
                    <Group gap={6} wrap='nowrap'>
                      {!a.withdrawnAt && (
                        <Tooltip label='Descargar (queda registrado)'>
                          <ActionIcon variant='subtle' color='blue' size='sm' component='a' href={`/api/sgc/requests/${requestId}/attachments/${a.id}`}>
                            <IconDownload size={16} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      {!a.withdrawnAt && canWithdraw(a) && (
                        <Tooltip label='Retirar (no se borra)'>
                          <ActionIcon variant='subtle' color='red' size='sm' onClick={() => setWithdraw(a)}>
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
      )}
      {attachments.length === 0 && (
        <Text size='sm' c='dimmed' mb='md'>
          No hay archivos adjuntos.
        </Text>
      )}
      {(canUploadDraft || canUploadSupport) && (
        <Group align='flex-end' gap='sm' wrap='wrap'>
          <FileInput
            label='Archivo'
            placeholder='Seleccione el archivo'
            value={file}
            onChange={setFile}
            accept={purpose === 'borrador' ? '.docx,.doc,.pdf' : undefined}
            style={{ flex: 1, minWidth: 240 }}
            clearable
            data-testid='sgc-adjunto-archivo'
          />
          <SgcSelect
            label='Tipo'
            data={[...(canUploadDraft ? [{ value: 'borrador', label: 'Borrador del documento' }] : []), { value: 'soporte', label: 'Soporte' }]}
            value={purpose}
            onChange={(v) => setPurpose((v as 'borrador' | 'soporte') ?? 'soporte')}
            allowDeselect={false}
            w={220}
            data-testid='sgc-adjunto-tipo'
          />
          <Button
            leftSection={<IconUpload size={16} />}
            disabled={!file}
            loading={uploading}
            onClick={async () => {
              if (!file) return;
              setUploading(true);
              try {
                await onUpload(file, purpose);
                setFile(null);
              } finally {
                setUploading(false);
              }
            }}
            data-testid='sgc-adjunto-cargar'
          >
            Cargar
          </Button>
        </Group>
      )}
      <Modal opened={Boolean(withdraw)} onClose={() => setWithdraw(null)} title='Retirar adjunto' centered>
        <Stack>
          <Text size='sm'>
            {withdraw?.fileName} quedará tachado en el historial (no se borra).
          </Text>
          <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Motivo' required minRows={2} autosize value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setWithdraw(null)}>
              Cancelar
            </Button>
            <Button
              color='red'
              disabled={reason.trim().length < 5}
              onClick={async () => {
                if (!withdraw) return;
                await onWithdraw(withdraw.id, reason.trim());
                setWithdraw(null);
                setReason('');
              }}
            >
              Retirar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}
