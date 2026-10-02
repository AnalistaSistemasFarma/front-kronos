'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Anchor, Avatar, Box, Card, Checkbox, Collapse, Divider, Group, MultiSelect, ScrollArea, Stack, Text, Textarea, Title } from '@mantine/core';
import { IconCheck, IconNote, IconSettingsAutomation } from '@tabler/icons-react';
import { presentInteractions, type SgcInteractionView } from '../../../lib/sgc/interactionView';
import { formatDateCO } from './format';

/**
 * Historial de interacciones PROPIO de la solicitud documental
 * (sgc.interaction). COPIA CONGELADA (2026-09-30) del bloque «Historial de
 * interacciones» de SynerLink: variante «tarea» = view-activities y variante
 * «solicitud» = view-request, con el mismo marcado y las mismas clases.
 *
 * Desde 2026-10-01 cada entrada se LEE simplificada (quién, qué hizo, cuándo
 * y la observación de la persona; lo técnico detrás de «Ver detalle») con
 * lib/sgc/interactionView. Solo cambia la presentación: lo guardado en
 * sgc.interaction no se toca y su texto original sigue en «Ver detalle».
 */
export interface SgcInteractionItem {
  id: string;
  kind: string;
  authorEmail: string;
  author: string | null;
  body: string;
  createdAt: string;
}

export interface SgcInteractionHistoryProps {
  variant: 'tarea' | 'solicitud';
  items: SgcInteractionItem[];
  currentEmail: string;
  users: { value: string; label: string }[];
  canNote: boolean;
  onSend: (body: string, notifyEmails: string[]) => Promise<void>;
}

function Detail({ v, tone }: { v: SgcInteractionView; tone?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Anchor component='button' type='button' size='xs' c={tone} underline='always' onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid='sgc-interaccion-ver-detalle'>
        {open ? 'Ocultar detalle' : 'Ver detalle'}
      </Anchor>
      <Collapse in={open}>
        <Stack gap={4} mt={4}>
          {v.count > 1 && (
            <Text size='xs' c={tone ?? 'dimmed'}>
              {v.count} veces: {v.groupedDates.map((d) => formatDateCO(d, { month: 'short' })).join(' · ')}
            </Text>
          )}
          {v.details.map((d, i) => (
            <Text key={i} size='xs' c={tone ?? 'dimmed'} style={{ wordBreak: 'break-all' }}>
              {d}
            </Text>
          ))}
          <Text size='xs' c={tone ?? 'dimmed'} fw={600} mt={2}>
            Texto registrado
          </Text>
          <Text size='xs' c={tone ?? 'dimmed'} className='whitespace-pre-line' style={{ wordBreak: 'break-word' }}>
            {v.raw}
          </Text>
        </Stack>
      </Collapse>
    </>
  );
}

/** Qué hizo + observación + dato complementario, dentro de la burbuja. */
function EntryBody({ v, tone }: { v: SgcInteractionView; tone?: string }) {
  return (
    <Stack gap={4}>
      <Text size='sm' style={{ lineHeight: 1.45 }} data-testid='sgc-interaccion-accion'>
        {v.action.charAt(0).toUpperCase() + v.action.slice(1)}
        {v.count > 1 ? ` (${v.count} veces)` : ''}
      </Text>
      {v.observation && (
        <Text size='sm' className='whitespace-pre-line' style={{ lineHeight: 1.5, borderLeft: '3px solid currentColor', paddingLeft: 8, opacity: 0.9 }} data-testid='sgc-interaccion-observacion'>
          {v.observation}
        </Text>
      )}
      {v.note && (
        <Text size='xs' c={tone ?? 'dimmed'} className='whitespace-pre-line'>
          {v.note}
        </Text>
      )}
      <Detail v={v} tone={tone} />
    </Stack>
  );
}

/** Evento automático: una línea discreta y centrada, sin burbuja. */
function SystemLine({ v }: { v: SgcInteractionView }) {
  return (
    <Box style={{ display: 'flex', justifyContent: 'center' }} data-testid='sgc-interaccion' data-automatic='1'>
      <Box maw='90%' px='sm' py={6} style={{ borderRadius: 10, background: 'var(--mantine-color-default-hover)', textAlign: 'center' }}>
        <Group gap={6} justify='center' wrap='nowrap'>
          <IconSettingsAutomation size={14} style={{ flexShrink: 0, opacity: 0.6 }} aria-hidden />
          <Text size='xs' c='dimmed'>
            {v.who} {v.action}
            {v.count > 1 ? ` (${v.count} veces)` : ''} · {formatDateCO(v.createdAt, { month: 'short' })}
          </Text>
        </Group>
        {v.note && (
          <Text size='xs' c='dimmed' className='whitespace-pre-line'>
            {v.note}
          </Text>
        )}
        <Detail v={v} />
      </Box>
    </Box>
  );
}

export default function SgcInteractionHistory({ variant, items, currentEmail, users, canNote, onSend }: SgcInteractionHistoryProps) {
  const [newNote, setNewNote] = useState('');
  const [notify, setNotify] = useState(false);
  const [emails, setEmails] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const me = currentEmail.toLowerCase();

  const views = useMemo(() => {
    const names = new Map<string, string>();
    for (const u of users) names.set(u.value.toLowerCase(), u.label.replace(/\s*\([^()]*@[^()]*\)\s*$/, ''));
    for (const i of items) if (i.author) names.set(i.authorEmail.toLowerCase(), i.author);
    return presentInteractions(items, (e) => names.get(e.toLowerCase()) ?? e);
  }, [items, users]);

  useEffect(() => {
    const el = viewportRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length]);

  const send = async () => {
    if (!newNote.trim()) return;
    setSending(true);
    try {
      await onSend(newNote.trim(), notify ? emails : []);
      setNewNote('');
      setNotify(false);
      setEmails([]);
    } finally {
      setSending(false);
    }
  };

  const disabled = !canNote || sending;

  if (variant === 'tarea') {
    return (
      <Card shadow='sm' p='xl' radius='md' withBorder className='flex flex-col' data-testid='sgc-historial'>
        <Title order={3} mb='md' className='flex items-center gap-2'>
          <IconNote size={20} />
          Historial de Interacciones
        </Title>
        <ScrollArea h='calc(100vh - 420px)' className='mb-4' offsetScrollbars viewportRef={viewportRef}>
          <div className='space-y-4 p-2'>
            {views.length > 0 ? (
              views.map((note) => {
                if (note.automatic) return <SystemLine key={note.id} v={note} />;
                const isCurrentUser = note.authorEmail.toLowerCase() === me;
                return (
                  <div key={note.id} className={`flex ${isCurrentUser ? 'justify-end' : 'justify-start'}`} data-testid='sgc-interaccion'>
                    <div
                      className={`max-w-xs lg:max-w-md px-4 py-3 rounded-2xl ${
                        isCurrentUser ? 'bg-blue-400 text-white rounded-br-none' : 'bg-gray-100 text-gray-800 rounded-bl-none'
                      }`}
                    >
                      <div className='flex items-center gap-2 mb-2'>
                        <Avatar size='sm' radius='xl' color={isCurrentUser ? 'white' : 'gray'}>
                          {note.who.charAt(0).toUpperCase()}
                        </Avatar>
                        <Text size='xs' fw={500} className={isCurrentUser ? 'text-blue-100 font-bold' : 'text-gray-600 font-bold'}>
                          {note.who}
                        </Text>
                      </div>
                      <div className='mb-2'>
                        <EntryBody v={note} tone={isCurrentUser ? 'blue.0' : undefined} />
                      </div>
                      <Text size='xs' className={isCurrentUser ? 'text-blue-100' : 'text-gray-500'}>
                        {formatDateCO(note.createdAt, { month: 'short' })}
                      </Text>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className='text-center py-8'>
                <Text size='lg' color='gray.5' mb='xs'>
                  No hay interacciones registradas
                </Text>
                <Text size='sm' color='gray.4'>
                  Sé el primero en añadir un comentario
                </Text>
              </div>
            )}
          </div>
        </ScrollArea>
        <div className='border-t pt-4'>
          <Stack gap='sm'>
            <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true'
              placeholder='Escribe una nota...'
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              minRows={2}
              className='flex-1'
              disabled={disabled}
              styles={{ input: { borderRadius: '12px' } }}
              data-testid='sgc-nota'
            />
            <Checkbox
              label='¿Notificar por correo electrónico?'
              checked={notify}
              onChange={(e) => {
                setNotify(e.currentTarget.checked);
                if (!e.currentTarget.checked) setEmails([]);
              }}
              mb='sm'
              disabled={disabled}
            />
            {notify && (
              <MultiSelect
                label='Correo electrónico de contacto'
                placeholder='Buscar y seleccionar usuarios...'
                data={users}
                value={emails}
                onChange={setEmails}
                searchable
                clearable
                nothingFoundMessage='No se encontraron usuarios'
              />
            )}
            <Group align='flex-end'>
              <ActionIcon variant='filled' color='blue' size='lg' radius='xl' onClick={send} disabled={disabled || !newNote.trim()} data-testid='sgc-nota-enviar' aria-label='Enviar nota'>
                <IconCheck size={18} />
              </ActionIcon>
            </Group>
          </Stack>
          {!canNote && (
            <Text size='xs' color='orange.6' mt='xs'>
              La solicitud está cerrada: el historial ya no admite notas.
            </Text>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card withBorder radius='md' p='md' shadow='sm' style={{ background: 'var(--app-surface)', borderColor: 'var(--app-border)' }} data-testid='sgc-historial'>
      <Title order={4} mb='sm' fw={600} className='flex items-center gap-2'>
        <IconNote size={18} />
        Historial de interacciones
      </Title>
      <ScrollArea h={360} mb='md' offsetScrollbars type='auto' viewportRef={viewportRef} styles={{ viewport: { paddingRight: 4 } }}>
        <Stack gap='sm' py={4}>
          {views.length > 0 ? (
            views.map((note) => {
              if (note.automatic) return <SystemLine key={note.id} v={note} />;
              const isCurrentUser = note.authorEmail.toLowerCase() === me;
              return (
                <Box key={note.id} style={{ display: 'flex', justifyContent: isCurrentUser ? 'flex-end' : 'flex-start' }} data-testid='sgc-interaccion'>
                  <Box
                    maw='85%'
                    px='sm'
                    py='xs'
                    style={{
                      borderRadius: 14,
                      borderBottomRightRadius: isCurrentUser ? 4 : 14,
                      borderBottomLeftRadius: isCurrentUser ? 14 : 4,
                      background: isCurrentUser ? 'color-mix(in srgb, var(--app-accent) 16%, var(--app-surface))' : 'var(--app-surface-raised)',
                      border: '1px solid var(--app-border)',
                    }}
                  >
                    <Group gap={8} mb={6} wrap='nowrap'>
                      <Avatar size={24} radius='xl' color={isCurrentUser ? 'blue' : 'gray'}>
                        {note.who.charAt(0).toUpperCase()}
                      </Avatar>
                      <Text size='xs' fw={600} lineClamp={1}>
                        {note.who}
                      </Text>
                      <Text size='10px' c='dimmed' ml='auto' style={{ whiteSpace: 'nowrap' }}>
                        {formatDateCO(note.createdAt, { month: 'short' })}
                      </Text>
                    </Group>
                    <EntryBody v={note} />
                  </Box>
                </Box>
              );
            })
          ) : (
            <Stack align='center' py='xl' gap={4}>
              <Text size='sm' c='dimmed'>
                No hay interacciones registradas
              </Text>
              <Text size='xs' c='dimmed'>
                Sé el primero en añadir un comentario
              </Text>
            </Stack>
          )}
        </Stack>
      </ScrollArea>
      <Divider mb='sm' color='var(--app-border)' />
      <Stack gap='xs'>
        <Group align='flex-end' gap='sm' wrap='nowrap'>
          <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true'
            placeholder='Escribe un mensaje…'
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            minRows={2}
            autosize
            maxRows={4}
            disabled={disabled}
            style={{ flex: 1 }}
            styles={{ input: { borderRadius: 10, background: 'var(--app-surface-raised)', borderColor: 'var(--app-border)' } }}
            data-testid='sgc-nota'
          />
          <ActionIcon variant='filled' color='blue' size='lg' radius='md' onClick={send} disabled={disabled || !newNote.trim()} aria-label='Enviar mensaje' data-testid='sgc-nota-enviar'>
            <IconCheck size={18} />
          </ActionIcon>
        </Group>
        <Checkbox
          label='Notificar por correo'
          size='xs'
          checked={notify}
          onChange={(e) => {
            setNotify(e.currentTarget.checked);
            if (!e.currentTarget.checked) setEmails([]);
          }}
          disabled={disabled}
        />
        {notify && (
          <MultiSelect placeholder='Destinatarios del correo…' data={users} value={emails} onChange={setEmails} searchable clearable nothingFoundMessage='No se encontraron usuarios' size='xs' />
        )}
        {!canNote && (
          <Text size='xs' c='orange'>
            La solicitud está cerrada: el historial ya no admite notas.
          </Text>
        )}
      </Stack>
    </Card>
  );
}
