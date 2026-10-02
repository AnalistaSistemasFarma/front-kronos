'use client';

import { useState } from 'react';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Group,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import { IconCheck, IconLink, IconRefresh, IconSend } from '@tabler/icons-react';
import type { DraftMark, DraftMarkStatus, DraftMarkType } from '../../../lib/orion/draftBoardDb';
import type { DraftBlock } from '../../../lib/orion/draftDiff';

export type DraftComposer = {
  blockIndex: number;
  quote: string;
  type: DraftMarkType;
  suggest: string;
  why: string;
};

type Props = {
  marks: DraftMark[];
  blocks: DraftBlock[];
  currentUserEmail: string;
  isElaborator: boolean;
  activeMarkId: number | null;
  composer: DraftComposer | null;
  busy: boolean;
  onComposerChange: (next: DraftComposer | null) => void;
  onCreate: (composer: DraftComposer) => void;
  onAction: (action: 'confirm' | 'reopen' | 'mark-fixed', markId: number) => void;
  onReply: (markId: number, text: string) => void;
  onFocus: (markId: number, opts?: { jumpToFix?: boolean }) => void;
};

const STATUS: Record<DraftMarkStatus, { label: string; color: string }> = {
  abierta: { label: 'Abierta', color: 'red' },
  corregida: { label: 'Por confirmar', color: 'orange' },
  respondida: { label: 'Respondida', color: 'orange' },
  confirmada: { label: 'Confirmada', color: 'teal' },
};
const TYPE: Record<DraftMarkType, { label: string; color: string }> = {
  correccion: { label: 'Corrección', color: 'red' },
  sugerencia: { label: 'Sugerencia', color: 'blue' },
  pregunta: { label: 'Pregunta', color: 'orange' },
};
const FILTERS = [
  { value: 'todas', label: 'Todas', test: () => true },
  { value: 'abiertas', label: 'Abiertas', test: (m: DraftMark) => m.status === 'abierta' },
  {
    value: 'confirmar',
    label: 'Por confirmar',
    test: (m: DraftMark) => m.status === 'corregida' || m.status === 'respondida',
  },
  { value: 'confirmadas', label: 'Confirmadas', test: (m: DraftMark) => m.status === 'confirmada' },
] as const;

function initials(name: string): string {
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}

/** Nombre corto del párrafo: el título en negrilla ("PRIMERA. OBJETO.") o su inicio. */
export function blockLabel(block: DraftBlock | undefined, index: number): string {
  if (!block) return `Párrafo ${index + 1}`;
  if (block.lead) return block.lead.replace(/[.:]\s*$/, '');
  return block.text.length > 42 ? `${block.text.slice(0, 42)}…` : block.text;
}

function MarkCard({
  mark,
  blocks,
  me,
  isElaborator,
  active,
  busy,
  onAction,
  onReply,
  onFocus,
}: {
  mark: DraftMark;
  blocks: DraftBlock[];
  me: string;
  isElaborator: boolean;
  active: boolean;
  busy: boolean;
  onAction: Props['onAction'];
  onReply: Props['onReply'];
  onFocus: Props['onFocus'];
}) {
  const [reply, setReply] = useState('');
  const isAuthor = mark.authorEmail.toLowerCase() === me;
  const status = STATUS[mark.status];
  const type = TYPE[mark.type];
  return (
    <Paper
      withBorder
      p='sm'
      radius='md'
      data-card={mark.id}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button, input, textarea')) return;
        onFocus(mark.id);
      }}
      style={{
        cursor: 'pointer',
        borderColor: active ? 'var(--mantine-color-blue-6)' : undefined,
        boxShadow: active ? '0 0 0 2px var(--mantine-color-blue-light)' : undefined,
      }}
    >
      <Stack gap={8}>
        <Group gap={6} wrap='nowrap'>
          <Badge circle size='md' color={mark.fixedIn ? 'teal' : 'yellow'} variant='filled'>
            {mark.number}
          </Badge>
          <Text size='xs' fw={700} tt='uppercase' c={type.color} style={{ letterSpacing: 0.5 }}>
            {type.label}
          </Text>
          <Text size='xs' c='dimmed' lineClamp={1} style={{ flex: 1, minWidth: 0 }}>
            {mark.authorName || mark.authorEmail} · {blockLabel(blocks[mark.blockIndex], mark.blockIndex)}
          </Text>
          <Badge size='sm' variant='light' color={status.color}>
            {status.label}
          </Badge>
        </Group>

        <Stack gap={2}>
          <Text size='xs' c='dimmed'>
            Dice
          </Text>
          <Text size='sm' ff='Georgia, serif'>
            “{mark.quote}”
          </Text>
          {mark.suggest ? (
            <>
              <Text size='xs' c='dimmed' mt={4}>
                Debe decir
              </Text>
              <Text size='sm' ff='Georgia, serif'>
                “{mark.suggest}”
              </Text>
            </>
          ) : null}
          <Text size='xs' c='dimmed' mt={4}>
            {mark.type === 'pregunta' ? 'Pregunta' : 'Por qué'}
          </Text>
          <Text size='sm'>{mark.why}</Text>
        </Stack>

        {mark.fixedIn ? (
          <Alert color='teal' variant='light' p={8} radius='sm'>
            <Stack gap={4}>
              <Text size='xs'>
                {mark.autoDetected
                  ? `Detectado solo: “${mark.quote}” ya no está y apareció “${mark.fixedQuote}” en la ${mark.fixedIn}.`
                  : `La preparadora indicó que quedó resuelto en la ${mark.fixedIn}.`}
              </Text>
              <Button
                size='compact-xs'
                variant='subtle'
                color='teal'
                leftSection={<IconLink size={12} />}
                onClick={() => onFocus(mark.id, { jumpToFix: true })}
                style={{ alignSelf: 'flex-start' }}
              >
                Ver el cambio en {mark.fixedIn}
              </Button>
            </Stack>
          </Alert>
        ) : null}

        {mark.replies.length > 0 ? (
          <Stack gap={6} pl={8} style={{ borderLeft: '2px solid var(--mantine-color-default-border)' }}>
            {mark.replies.map((r) => (
              <Group key={r.id} gap={6} wrap='nowrap' align='flex-start'>
                <Avatar size={20} radius='xl' color='initials' name={r.authorName || r.authorEmail}>
                  {initials(r.authorName || r.authorEmail)}
                </Avatar>
                <div style={{ minWidth: 0 }}>
                  <Text size='xs' c='dimmed'>
                    {r.authorName || r.authorEmail} · {formatDate(r.createdAt)}
                  </Text>
                  <Text size='sm'>{r.text}</Text>
                </div>
              </Group>
            ))}
          </Stack>
        ) : null}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!reply.trim()) return;
            onReply(mark.id, reply.trim());
            setReply('');
          }}
        >
          <Group gap={6} wrap='nowrap'>
            <TextInput
              size='xs'
              placeholder='Responder…'
              value={reply}
              onChange={(e) => setReply(e.currentTarget.value)}
              style={{ flex: 1 }}
              aria-label={`Responder a la marca ${mark.number}`}
            />
            <Button size='xs' variant='default' type='submit' disabled={!reply.trim() || busy}>
              Enviar
            </Button>
          </Group>
        </form>

        {isAuthor || (isElaborator && mark.status === 'abierta') ? (
          <Group gap={6}>
            {isAuthor && (mark.status === 'corregida' || mark.status === 'respondida') ? (
              <Button size='xs' color='teal' leftSection={<IconCheck size={14} />} disabled={busy} onClick={() => onAction('confirm', mark.id)}>
                Confirmar
              </Button>
            ) : null}
            {isAuthor && mark.status !== 'abierta' ? (
              <Button size='xs' variant='default' leftSection={<IconRefresh size={14} />} disabled={busy} onClick={() => onAction('reopen', mark.id)}>
                Reabrir
              </Button>
            ) : null}
            {isElaborator && mark.status === 'abierta' ? (
              <Button size='xs' variant='light' disabled={busy} onClick={() => onAction('mark-fixed', mark.id)}>
                {mark.type === 'correccion' ? 'Ya la corregí' : 'Marcar como respondida'}
              </Button>
            ) : null}
          </Group>
        ) : null}
      </Stack>
    </Paper>
  );
}

/** Panel derecho del tablero: nueva marca y lista de correcciones con su estado. */
export default function DraftBoardMarks({
  marks,
  blocks,
  currentUserEmail,
  isElaborator,
  activeMarkId,
  composer,
  busy,
  onComposerChange,
  onCreate,
  onAction,
  onReply,
  onFocus,
}: Props) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['value']>('todas');
  const [error, setError] = useState<string | null>(null);
  const me = currentUserEmail.toLowerCase();
  const visible = marks.filter(FILTERS.find((f) => f.value === filter)!.test);

  const submit = () => {
    if (!composer) return;
    if (!composer.why.trim()) {
      setError(composer.type === 'pregunta' ? 'Escriba la pregunta.' : 'Explique por qué se necesita el cambio.');
      return;
    }
    if (composer.type === 'correccion' && !composer.suggest.trim()) {
      setError('Escriba cómo debe quedar el texto.');
      return;
    }
    setError(null);
    onCreate(composer);
  };

  return (
    <Stack gap='sm' style={{ minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
      {composer ? (
        <Paper withBorder p='sm' radius='md' style={{ borderStyle: 'dashed', borderColor: 'var(--mantine-color-blue-6)' }} bg='var(--mantine-color-blue-light)'>
          <Stack gap={8}>
            <Text size='sm' fw={700}>
              Nueva marca
            </Text>
            <Select
              size='xs'
              label='Tipo'
              value={composer.type}
              allowDeselect={false}
              onChange={(v) => onComposerChange({ ...composer, type: (v as DraftMarkType) || 'correccion' })}
              data={[
                { value: 'correccion', label: 'Corrección' },
                { value: 'sugerencia', label: 'Sugerencia' },
                { value: 'pregunta', label: 'Pregunta' },
              ]}
            />
            <div>
              <Text size='xs' c='dimmed'>
                Dice
              </Text>
              <Paper withBorder p={6} radius='sm' mah={140} style={{ overflowY: 'auto' }}>
                <Text size='sm' ff='Georgia, serif'>
                  “{composer.quote}”
                </Text>
              </Paper>
            </div>
            {composer.type !== 'pregunta' ? (
              <Textarea
                size='xs'
                label='Debe decir'
                placeholder='Texto como debe quedar'
                autosize
                minRows={2}
                maxLength={2000}
                value={composer.suggest}
                onChange={(e) => onComposerChange({ ...composer, suggest: e.currentTarget.value })}
              />
            ) : null}
            <Textarea
              size='xs'
              label={composer.type === 'pregunta' ? 'Pregunta (obligatorio)' : 'Por qué (obligatorio)'}
              placeholder='Explique la razón para que la preparadora entienda el cambio'
              autosize
              minRows={2}
              maxLength={2000}
              value={composer.why}
              onChange={(e) => onComposerChange({ ...composer, why: e.currentTarget.value })}
              autoFocus
            />
            {error ? (
              <Text size='xs' c='red'>
                {error}
              </Text>
            ) : null}
            <Group gap={6}>
              <Button size='xs' leftSection={<IconSend size={14} />} loading={busy} onClick={submit}>
                Guardar marca
              </Button>
              <Button size='xs' variant='default' onClick={() => onComposerChange(null)}>
                Cancelar
              </Button>
            </Group>
          </Stack>
        </Paper>
      ) : null}

      <SegmentedControl
        size='xs'
        value={filter}
        onChange={(v) => setFilter(v as typeof filter)}
        data={FILTERS.map((f) => ({ value: f.value, label: `${f.label} ${marks.filter(f.test).length}` }))}
        fullWidth
      />

      {visible.length === 0 ? (
        <Text size='sm' c='dimmed'>
          {marks.length === 0
            ? 'Todavía no hay marcas. Seleccione texto del documento para crear la primera.'
            : 'No hay marcas en este filtro.'}
        </Text>
      ) : (
        visible.map((mark) => (
          <MarkCard
            key={mark.id}
            mark={mark}
            blocks={blocks}
            me={me}
            isElaborator={isElaborator}
            active={activeMarkId === mark.id}
            busy={busy}
            onAction={onAction}
            onReply={onReply}
            onFocus={onFocus}
          />
        ))
      )}
    </Stack>
  );
}
