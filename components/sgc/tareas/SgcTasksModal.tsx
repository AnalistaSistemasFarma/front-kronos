'use client';

import { useState } from 'react';
import { ActionIcon, Badge, Box, Button, Flex, Group, Modal, Paper, ScrollArea, Select, Stack, Text, Textarea, ThemeIcon } from '@mantine/core';
import { IconCheck, IconClock, IconEye, IconLock, IconX } from '@tabler/icons-react';
import { sgcStatusColor } from '../../../lib/sgc/flows/engine';
import type { SgcRequestDetail } from '../../../lib/sgc/db/requests';
import { formatDateCO } from './format';

/**
 * «Tareas Asignadas - Solicitud #N»: COPIA CONGELADA (2026-09-30) de la línea
 * de tiempo del modal «Ver Tareas» de SynerLink (view-request), con los
 * firmantes de cada paso (varios revisores/aprobadores, en orden o en paralelo).
 */
type Task = SgcRequestDetail['tasks'][number];

export interface SgcTasksModalProps {
  opened: boolean;
  onClose: () => void;
  requestId: number;
  tasks: Task[];
  users: { value: string; label: string }[];
  onViewTask: (idTask: number) => void;
  onReassign: (idTask: number, toEmail: string, reason: string) => Promise<void>;
}

export default function SgcTasksModal({ opened, onClose, requestId, tasks, users, onViewTask, onReassign }: SgcTasksModalProps) {
  const [pending, setPending] = useState<{ idTask: number; toEmail: string } | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  return (
    <>
      <Modal
        opened={opened}
        onClose={onClose}
        title={
          <Text fw={600} size='lg'>
            Tareas Asignadas - Solicitud #{requestId}
          </Text>
        }
        size='xl'
        centered
      >
        {tasks.length > 0 ? (
          <ScrollArea.Autosize mah='65vh' offsetScrollbars>
            <Stack gap={0} data-testid='sgc-linea-tiempo'>
              {tasks.map((task, index, arr) => {
                const isLast = index === arr.length - 1;
                const isResolved = task.status === 'resuelta';
                const isCancelled = task.status === 'cancelada' || task.status === 'devuelta';
                const isLocked = task.status === 'en_espera' || task.status === 'sin_empezar';
                const bulletColor = isResolved ? 'green' : isCancelled ? 'red' : isLocked ? 'gray' : 'blue';
                const fmt = (d?: string | null) => formatDateCO(d, { month: 'short', fallback: 'N/A' });
                return (
                  <Flex key={task.id} gap='md' align='stretch' data-testid='sgc-linea-tarea'>
                    <Flex direction='column' align='center' style={{ flexShrink: 0 }}>
                      <ThemeIcon radius='xl' size={36} color={bulletColor} variant={isLocked ? 'light' : 'filled'}>
                        {isResolved ? (
                          <IconCheck size={18} />
                        ) : isCancelled ? (
                          <IconX size={18} />
                        ) : isLocked ? (
                          <IconLock size={16} />
                        ) : (
                          <Text fw={700} size='sm' c='white'>
                            {index + 1}
                          </Text>
                        )}
                      </ThemeIcon>
                      {!isLast && (
                        <Box
                          style={{
                            flex: 1,
                            width: 2,
                            minHeight: 20,
                            backgroundColor: isResolved ? 'var(--mantine-color-green-5)' : 'var(--mantine-color-default-border)',
                          }}
                        />
                      )}
                    </Flex>
                    <Paper withBorder p='sm' radius='md' mb='sm' style={{ flex: 1, minWidth: 0, opacity: isLocked ? 0.75 : 1 }}>
                      <Group justify='space-between' align='flex-start' wrap='nowrap'>
                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <Group gap={8} mb={6}>
                            <Text fw={600}>
                              {task.name}
                              {task.round > 1 ? ` (ronda ${task.round})` : ''}
                            </Text>
                            <Badge color={sgcStatusColor(task.statusLabel)} size='sm' styles={{ root: { maxWidth: 'unset' }, label: { overflow: 'visible' } }}>
                              {task.statusLabel}
                            </Badge>
                            {task.multiAssignee && (
                              <Badge color={task.isSequential ? 'grape' : 'gray'} variant='light' size='sm'>
                                {task.isSequential ? 'Secuencial' : 'Paralela'}
                              </Badge>
                            )}
                            {task.signatureLabel && (
                              <Badge color='teal' variant='light' size='sm'>
                                Firma: {task.signatureLabel}
                              </Badge>
                            )}
                            {task.status === 'en_espera' && (
                              <Badge color='orange' variant='light' size='sm' leftSection={<IconLock size={12} />}>
                                Sprint 4
                              </Badge>
                            )}
                          </Group>
                          {task.multiAssignee || task.assignees.length > 1 ? (
                            <Stack gap={4} mb={8}>
                              {task.assignees.map((a) => (
                                <Group key={a.id} gap={6} wrap='nowrap' data-testid='sgc-firmante'>
                                  <ThemeIcon size={18} radius='xl' variant='light' color={a.status === 'aprobado' ? 'green' : a.status === 'devuelto' ? 'orange' : a.inTurn ? 'blue' : 'gray'}>
                                    {a.status === 'aprobado' ? <IconCheck size={11} /> : a.status === 'devuelto' ? <IconX size={11} /> : <IconClock size={11} />}
                                  </ThemeIcon>
                                  <Text size='sm' style={{ minWidth: 0 }} lineClamp={1}>
                                    {task.isSequential ? `${a.signOrder}. ` : ''}
                                    {a.email ? a.name || a.email : `Grupo ${a.poolTypeCode}${a.decidedBy ? ` · ${a.decidedBy}` : ''}`}
                                  </Text>
                                  <Text size='xs' c='dimmed' style={{ whiteSpace: 'nowrap' }}>
                                    {a.statusLabel}
                                    {a.inTurn ? ' · en turno' : ''}
                                    {a.decidedAt ? ` · ${fmt(a.decidedAt)}` : ''}
                                  </Text>
                                </Group>
                              ))}
                            </Stack>
                          ) : (
                            <Group gap={6} align='center' mb={8} wrap='nowrap'>
                              <Text size='sm' c='dimmed' style={{ whiteSpace: 'nowrap' }}>
                                Asignado:
                              </Text>
                              {task.canReassign ? (
                                <Select
                                  data={users}
                                  value={task.assignees.find((a) => a.status === 'pendiente')?.email ?? null}
                                  onChange={(value) => value && setPending({ idTask: task.id, toEmail: value })}
                                  searchable
                                  allowDeselect={false}
                                  size='xs'
                                  comboboxProps={{ withinPortal: true }}
                                  style={{ minWidth: 220 }}
                                  data-testid='sgc-reasignar'
                                />
                              ) : (
                                <Text size='sm'>{task.assignedLabel || '—'}</Text>
                              )}
                            </Group>
                          )}
                          <Group gap='lg'>
                            <Text size='xs' c='dimmed'>
                              Inicio: {fmt(task.startedAt)}
                            </Text>
                            <Text size='xs' c='dimmed'>
                              Fin: {fmt(task.endedAt)}
                            </Text>
                          </Group>
                          {task.resolution && (
                            <Text size='sm' mt={6}>
                              <Text span fw={500}>
                                Resolución:{' '}
                              </Text>
                              {task.resolution}
                            </Text>
                          )}
                          {isLocked && (
                            <Group gap={4} mt={8} wrap='nowrap'>
                              <IconLock size={13} color='var(--mantine-color-orange-6)' />
                              <Text size='xs' c='orange'>
                                {task.status === 'en_espera' ? 'Paso definido en el flujo; el sistema lo habilita en el Sprint 4.' : 'Esperando que se resuelva la tarea anterior.'}
                              </Text>
                            </Group>
                          )}
                        </Box>
                        <ActionIcon variant='subtle' color='blue' onClick={() => onViewTask(task.id)} title='Ver / resolver tarea' style={{ flexShrink: 0 }}>
                          <IconEye size={18} />
                        </ActionIcon>
                      </Group>
                    </Paper>
                  </Flex>
                );
              })}
            </Stack>
          </ScrollArea.Autosize>
        ) : (
          <Text color='gray'>No hay tareas asignadas a esta solicitud</Text>
        )}
      </Modal>

      <Modal opened={Boolean(pending)} onClose={() => !saving && setPending(null)} title='Reasignar tarea' centered>
        <Stack>
          <Text size='sm'>
            La tarea pasará a <strong>{users.find((u) => u.value === pending?.toEmail)?.label ?? pending?.toEmail}</strong>. El cambio queda en el historial.
          </Text>
          <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Motivo de la reasignación' required minRows={2} autosize value={reason} onChange={(e) => setReason(e.currentTarget.value)} data-testid='sgc-reasignar-motivo' />
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setPending(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button
              loading={saving}
              disabled={reason.trim().length < 5}
              onClick={async () => {
                if (!pending) return;
                setSaving(true);
                try {
                  await onReassign(pending.idTask, pending.toEmail, reason.trim());
                  setPending(null);
                  setReason('');
                } finally {
                  setSaving(false);
                }
              }}
            >
              Reasignar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
