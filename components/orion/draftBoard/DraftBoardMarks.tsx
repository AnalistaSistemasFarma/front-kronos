'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { Textarea } from '@mantine/core';
import {
  IconArrowUp,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconHighlight,
  IconLink,
  IconMessageCircle,
  IconRefresh,
  IconSend,
  IconX,
} from '@tabler/icons-react';
import type { DraftMark, DraftMarkType } from '../../../lib/orion/draftBoardDb';
import type { DraftBlock } from '../../../lib/orion/draftDiff';
import {
  EASE,
  MARK_STYLE,
  MacAvatar,
  MacButton,
  MacIconButton,
  MacPill,
  STATUS_LABEL,
  SYSTEM_BLUE,
  SYSTEM_GREEN,
  markStyle,
  relativeTime,
  sectionLabel,
  surface,
  useMaterial,
  type Material,
} from './macUi';

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
  /**
   * Orden de la corrección: la preparadora todavía no puede marcar ni responder (los validadores
   * siguen revisando o falta subir la versión corregida). Texto que explica qué falta.
   */
  elaboratorLockedReason?: string | null;
  activeMarkId: number | null;
  /** Marca con el detalle abierto ("Ver detalles" en la burbuja). */
  detailMarkId: number | null;
  onDetail: (markId: number | null) => void;
  composer: DraftComposer | null;
  busy: boolean;
  onComposerChange: (next: DraftComposer | null) => void;
  onCreate: (composer: DraftComposer) => void;
  onAction: (action: 'confirm' | 'reopen' | 'mark-fixed', markId: number) => void;
  onReply: (markId: number, text: string) => void;
  onFocus: (markId: number, opts?: { jumpToFix?: boolean }) => void;
};

/** Nombre corto del párrafo: el título en negrilla ("PRIMERA. OBJETO.") o su inicio. */
export function blockLabel(block: DraftBlock | undefined, index: number): string {
  if (!block) return `Párrafo ${index + 1}`;
  if (block.lead) return block.lead.replace(/[.:]\s*$/, '');
  return block.text.length > 42 ? `${block.text.slice(0, 42)}…` : block.text;
}

const TYPE_OPTIONS: Array<{ value: DraftMarkType; label: string }> = [
  { value: 'correccion', label: 'Corrección' },
  { value: 'sugerencia', label: 'Sugerencia' },
  { value: 'pregunta', label: 'Pregunta' },
];

function card(m: Material): CSSProperties {
  return {
    ...surface(m),
    borderRadius: 14,
    color: m.text,
    boxShadow: '0 1px 2px rgba(0,0,0,.06), 0 6px 20px rgba(0,0,0,.06)',
    overflow: 'hidden',
  };
}

const textareaStyles = (m: Material) => ({
  label: { fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 0.6, color: m.secondary, marginBottom: 4 },
  input: { background: m.well, border: 0, borderRadius: 10, color: m.text, fontSize: 13 },
});

/** Control segmentado tipo iOS. */
function IosSegmented<T extends string>({
  value,
  options,
  onChange,
  material,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  material: Material;
}) {
  return (
    <div role='radiogroup' style={{ display: 'flex', padding: 2, borderRadius: 9, background: material.well, gap: 2 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type='button'
            role='radio'
            aria-checked={on}
            onClick={() => onChange(o.value)}
            style={{
              flex: 1,
              height: 28,
              border: 0,
              borderRadius: 7,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 12.5,
              fontWeight: on ? 600 : 500,
              color: material.text,
              background: on ? material.bg : 'transparent',
              boxShadow: on ? '0 1px 3px rgba(0,0,0,.12), 0 0 0 0.5px rgba(0,0,0,.04)' : 'none',
              transition: `background .18s ${EASE}, box-shadow .18s ${EASE}`,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Composer({
  composer,
  busy,
  material,
  onChange,
  onCreate,
}: {
  composer: DraftComposer;
  busy: boolean;
  material: Material;
  onChange: Props['onComposerChange'];
  onCreate: Props['onCreate'];
}) {
  const [error, setError] = useState<string | null>(null);
  /** Sugerencia sin "Debe decir": se avisa una vez y se puede guardar igual. */
  const [missingSuggest, setMissingSuggest] = useState(false);
  const s = MARK_STYLE[composer.type];

  const submit = (opts: { skipSuggestWarning?: boolean } = {}) => {
    if (!composer.why.trim()) {
      setError(composer.type === 'pregunta' ? 'Escriba la pregunta.' : 'Explique por qué se necesita el cambio.');
      return;
    }
    if (composer.type === 'correccion' && !composer.suggest.trim()) {
      setError('Escriba en "Debe decir" cómo debe quedar el texto.');
      return;
    }
    if (composer.type === 'sugerencia' && !composer.suggest.trim() && !opts.skipSuggestWarning) {
      setError(null);
      setMissingSuggest(true);
      return;
    }
    setError(null);
    setMissingSuggest(false);
    onCreate(composer);
  };

  return (
    <div style={{ ...card(material), boxShadow: `0 0 0 2px color-mix(in srgb, ${SYSTEM_BLUE} 35%, transparent), 0 8px 24px rgba(0,0,0,.08)` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px 10px' }}>
        <span
          aria-hidden
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            background: `linear-gradient(145deg, color-mix(in srgb, ${s.solid} 60%, #fff), ${s.solid})`,
          }}
        >
          <IconHighlight size={16} stroke={2} />
        </span>
        <div style={{ flex: 1, fontSize: 15, fontWeight: 600 }}>Nueva marca</div>
        <MacIconButton label='Cancelar' material={material} onClick={() => onChange(null)}>
          <IconX size={13} stroke={2.4} />
        </MacIconButton>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 14px 14px' }}>
        <IosSegmented
          value={composer.type}
          options={TYPE_OPTIONS}
          material={material}
          onChange={(type) => onChange({ ...composer, type })}
        />
        <div>
          <div style={sectionLabel(material)}>Dice</div>
          <div
            style={{
              fontSize: 13,
              lineHeight: 1.5,
              padding: '8px 10px',
              borderRadius: 10,
              background: material.well,
              borderLeft: `3px solid ${s.solid}`,
              maxHeight: 140,
              overflowY: 'auto',
            }}
          >
            “{composer.quote}”
          </div>
        </div>
        {composer.type !== 'pregunta' ? (
          <Textarea
            label='Debe decir'
            description='Escriba el texto exacto como debe quedar: así la preparadora sabe qué cambiar.'
            placeholder='Texto como debe quedar'
            autosize
            minRows={2}
            maxLength={2000}
            value={composer.suggest}
            onChange={(e) => {
              if (e.currentTarget.value.trim()) setMissingSuggest(false);
              onChange({ ...composer, suggest: e.currentTarget.value });
            }}
            styles={textareaStyles(material)}
            withAsterisk={composer.type === 'correccion'}
          />
        ) : null}
        {missingSuggest && composer.type === 'sugerencia' ? (
          <div
            role='alert'
            style={{
              fontSize: 12.5,
              lineHeight: 1.45,
              padding: '8px 10px',
              borderRadius: 10,
              color: '#92400e',
              background: 'color-mix(in srgb, #f59e0b 16%, transparent)',
            }}
          >
            No escribió el <b>&quot;Debe decir&quot;</b>. Sin él la preparadora tiene que adivinar el cambio. Escríbalo
            arriba, o guarde igual si de verdad no aplica.
            <div style={{ marginTop: 6 }}>
              <MacButton variant='plain' color='#92400e' disabled={busy} onClick={() => submit({ skipSuggestWarning: true })}>
                Guardar sin &quot;Debe decir&quot;
              </MacButton>
            </div>
          </div>
        ) : null}
        <Textarea
          label={composer.type === 'pregunta' ? 'Pregunta' : 'Por qué'}
          placeholder='Explique la razón para que la preparadora entienda el cambio'
          autosize
          minRows={2}
          maxLength={2000}
          value={composer.why}
          onChange={(e) => onChange({ ...composer, why: e.currentTarget.value })}
          styles={textareaStyles(material)}
          autoFocus
        />
        {error ? <div style={{ fontSize: 12.5, color: '#dc2626' }}>{error}</div> : null}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <MacButton variant='plain' color={material.secondary} onClick={() => onChange(null)}>
            Cancelar
          </MacButton>
          <MacButton disabled={busy} onClick={() => submit()} icon={<IconSend size={14} stroke={2} />}>
            {busy ? 'Guardando…' : 'Guardar marca'}
          </MacButton>
        </div>
      </div>
    </div>
  );
}

function MarkDetail({
  mark,
  blocks,
  me,
  isElaborator,
  elaboratorLockedReason,
  busy,
  material,
  position,
  total,
  onPrev,
  onNext,
  onClose,
  onAction,
  onReply,
  onFocus,
}: {
  mark: DraftMark;
  blocks: DraftBlock[];
  me: string;
  isElaborator: boolean;
  elaboratorLockedReason?: string | null;
  busy: boolean;
  material: Material;
  position: number;
  total: number;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onClose: () => void;
  onAction: Props['onAction'];
  onReply: Props['onReply'];
  onFocus: Props['onFocus'];
}) {
  const [reply, setReply] = useState('');
  const isAuthor = mark.authorEmail.toLowerCase() === me;
  const locked = isElaborator && Boolean(elaboratorLockedReason);
  const fixed = Boolean(mark.fixedIn);
  const s = markStyle({ fixed, type: mark.type });
  const status = STATUS_LABEL[mark.status] ?? STATUS_LABEL.abierta;
  const author = mark.authorName || mark.authorEmail;
  const label = sectionLabel(material);

  const sendReply = () => {
    if (!reply.trim() || busy) return;
    onReply(mark.id, reply.trim());
    setReply('');
  };

  return (
    <div data-card={mark.id} style={card(material)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px', borderBottom: `0.5px solid ${material.hairline}` }}>
        <MacIconButton label='Marca anterior' material={material} onClick={onPrev ?? undefined} disabled={!onPrev}>
          <IconChevronLeft size={14} stroke={2.4} />
        </MacIconButton>
        <MacIconButton label='Marca siguiente' material={material} onClick={onNext ?? undefined} disabled={!onNext}>
          <IconChevronRight size={14} stroke={2.4} />
        </MacIconButton>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 12.5, fontWeight: 600, color: material.secondary }}>
          Marca {position} de {total}
        </div>
        <MacIconButton label='Cerrar detalle' material={material} onClick={onClose}>
          <IconX size={13} stroke={2.4} />
        </MacIconButton>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 14px 10px' }}>
        <MacAvatar name={author} color={s.solid} size={40} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {author}
          </div>
          <div style={{ fontSize: 12, color: material.secondary, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {[relativeTime(mark.createdAt), `en ${mark.createdVersion}`, blockLabel(blocks[mark.blockIndex], mark.blockIndex)]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        <span
          style={{
            alignSelf: 'flex-start',
            fontSize: 12,
            fontWeight: 700,
            color: s.solid,
            padding: '2px 8px',
            borderRadius: 999,
            background: `color-mix(in srgb, ${s.solid} 12%, transparent)`,
          }}
        >
          #{mark.number}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '0 14px 12px' }}>
        <MacPill label={s.label} color={s.solid} />
        <MacPill label={status.label} color={status.color} />
        {mark.autoDetected ? <MacPill label='Detectada sola' color={material.secondary} /> : null}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 14px 14px' }}>
        <div>
          <div style={label}>Dice</div>
          <div
            style={{
              fontSize: 13.5,
              lineHeight: 1.55,
              padding: '9px 11px',
              borderRadius: 10,
              background: material.well,
              borderLeft: `3px solid ${s.solid}`,
              maxHeight: 220,
              overflowY: 'auto',
            }}
          >
            “{mark.quote}”
          </div>
        </div>
        {mark.suggest ? (
          <div>
            <div style={label}>Debe decir</div>
            <div
              style={{
                fontSize: 13.5,
                lineHeight: 1.55,
                fontWeight: 500,
                padding: '9px 11px',
                borderRadius: 10,
                color: SYSTEM_GREEN,
                background: `color-mix(in srgb, ${SYSTEM_GREEN} 9%, transparent)`,
              }}
            >
              “{mark.suggest}”
            </div>
          </div>
        ) : null}
        {mark.why ? (
          <div>
            <div style={label}>{mark.type === 'pregunta' ? 'Pregunta' : 'Por qué'}</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>{mark.why}</div>
          </div>
        ) : null}

        {mark.fixedIn ? (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 12,
              background: `color-mix(in srgb, ${SYSTEM_GREEN} 10%, transparent)`,
              fontSize: 12.5,
              lineHeight: 1.5,
            }}
          >
            {mark.autoDetected
              ? `Detectado solo: “${mark.quote}” ya no está y apareció “${mark.fixedQuote}” en la ${mark.fixedIn}.`
              : `La preparadora indicó que quedó resuelto en la ${mark.fixedIn}.`}
            <div style={{ marginTop: 6 }}>
              <MacButton
                variant='tinted'
                color={SYSTEM_GREEN}
                icon={<IconLink size={13} stroke={2} />}
                onClick={() => onFocus(mark.id, { jumpToFix: true })}
              >
                Ver el cambio en {mark.fixedIn}
              </MacButton>
            </div>
          </div>
        ) : null}

        {mark.replies.length > 0 ? (
          <div>
            <div style={label}>Conversación</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {mark.replies.map((r) => {
                const mine = r.authorEmail.toLowerCase() === me;
                return (
                  <div key={r.id} style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start' }}>
                    <div style={{ fontSize: 11, color: material.secondary, margin: '0 6px 2px' }}>
                      {mine ? 'Usted' : r.authorName || r.authorEmail} · {relativeTime(r.createdAt)}
                    </div>
                    <div
                      style={{
                        maxWidth: '85%',
                        padding: '7px 12px',
                        borderRadius: 18,
                        borderBottomRightRadius: mine ? 6 : 18,
                        borderBottomLeftRadius: mine ? 18 : 6,
                        fontSize: 13.5,
                        lineHeight: 1.45,
                        color: mine ? '#fff' : material.text,
                        background: mine ? SYSTEM_BLUE : material.well,
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {r.text}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {locked ? (
          <div
            style={{
              fontSize: 12.5,
              lineHeight: 1.45,
              padding: '8px 10px',
              borderRadius: 10,
              background: material.well,
              color: material.secondary,
            }}
          >
            {elaboratorLockedReason}
          </div>
        ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendReply();
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 3, borderRadius: 20, background: material.well }}
        >
          <input
            value={reply}
            onChange={(e) => setReply(e.currentTarget.value)}
            placeholder='Responder…'
            aria-label={`Responder a la marca ${mark.number}`}
            style={{
              flex: 1,
              minWidth: 0,
              height: 32,
              padding: '0 12px',
              border: 0,
              outline: 'none',
              background: 'transparent',
              color: material.text,
              fontFamily: 'inherit',
              fontSize: 13.5,
            }}
          />
          <button
            type='submit'
            aria-label='Enviar respuesta'
            disabled={!reply.trim() || busy}
            style={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              border: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: reply.trim() && !busy ? 'pointer' : 'default',
              color: '#fff',
              background: reply.trim() && !busy ? SYSTEM_BLUE : material.secondary,
              opacity: reply.trim() && !busy ? 1 : 0.4,
              transition: `background .15s ${EASE}, opacity .15s`,
            }}
          >
            <IconArrowUp size={16} stroke={2.6} />
          </button>
        </form>
        )}

        {isAuthor || (isElaborator && !locked && mark.status === 'abierta') ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {isAuthor && (mark.status === 'corregida' || mark.status === 'respondida') ? (
              <MacButton color={SYSTEM_GREEN} disabled={busy} icon={<IconCheck size={14} stroke={2.4} />} onClick={() => onAction('confirm', mark.id)}>
                Confirmar
              </MacButton>
            ) : null}
            {isAuthor && mark.status !== 'abierta' ? (
              <MacButton variant='tinted' color={material.secondary} disabled={busy} icon={<IconRefresh size={14} stroke={2} />} onClick={() => onAction('reopen', mark.id)}>
                Reabrir
              </MacButton>
            ) : null}
            {isElaborator && !locked && mark.status === 'abierta' ? (
              <MacButton variant='tinted' disabled={busy} icon={<IconCheck size={14} stroke={2.4} />} onClick={() => onAction('mark-fixed', mark.id)}>
                {mark.type === 'correccion' ? 'Ya la corregí' : 'Marcar como respondida'}
              </MacButton>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function EmptyState({ material, hasMarks }: { material: Material; hasMarks: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 8,
        padding: '22px 16px',
        borderRadius: 14,
        background: material.well,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: material.bg,
          color: SYSTEM_BLUE,
          boxShadow: '0 1px 3px rgba(0,0,0,.08)',
        }}
      >
        <IconMessageCircle size={22} stroke={1.8} />
      </span>
      <div style={{ fontSize: 14, fontWeight: 600, color: material.text }}>
        {hasMarks ? 'Ninguna marca abierta' : 'Todavía no hay marcas'}
      </div>
      <div style={{ fontSize: 12.5, lineHeight: 1.5, color: material.secondary, maxWidth: 260 }}>
        {hasMarks
          ? 'Toque la burbuja de una marca en el documento y luego “Ver detalles” para verla completa aquí.'
          : 'Seleccione texto del documento para subrayarlo y dejar la primera marca.'}
      </div>
    </div>
  );
}

/** Panel derecho del tablero: nueva marca y el detalle de la marca elegida en el documento. */
export default function DraftBoardMarks({
  marks,
  blocks,
  currentUserEmail,
  isElaborator,
  elaboratorLockedReason,
  detailMarkId,
  onDetail,
  composer,
  busy,
  onComposerChange,
  onCreate,
  onAction,
  onReply,
  onFocus,
}: Props) {
  const material = useMaterial();
  const me = currentUserEmail.toLowerCase();
  const ordered = [...marks].sort((a, b) => a.number - b.number);
  const index = ordered.findIndex((m) => m.id === detailMarkId);
  const detail = index >= 0 ? ordered[index] : null;

  // La marca abierta ya no existe (se borró o cambió la subversión): se cierra el detalle.
  useEffect(() => {
    if (detailMarkId != null && index < 0) onDetail(null);
  }, [detailMarkId, index, onDetail]);

  const go = (target: DraftMark | undefined) => {
    if (!target) return;
    onDetail(target.id);
    onFocus(target.id);
  };

  const open = marks.filter((m) => m.status === 'abierta').length;
  const toConfirm = marks.filter((m) => m.status === 'corregida' || m.status === 'respondida').length;
  const confirmed = marks.filter((m) => m.status === 'confirmada').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, overflowWrap: 'anywhere' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: material.text }}>Correcciones</div>
        <div style={{ fontSize: 12, color: material.secondary }}>
          {open + toConfirm} por cerrar
        </div>
      </div>
      {marks.length > 0 ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <MacPill label={`Abiertas ${open}`} color={STATUS_LABEL.abierta.color} />
          <MacPill label={`Por confirmar ${toConfirm}`} color={STATUS_LABEL.corregida.color} />
          <MacPill label={`Confirmadas ${confirmed}`} color={STATUS_LABEL.confirmada.color} />
        </div>
      ) : null}

      {composer ? (
        <Composer composer={composer} busy={busy} material={material} onChange={onComposerChange} onCreate={onCreate} />
      ) : null}

      {detail ? (
        <MarkDetail
          key={detail.id}
          mark={detail}
          blocks={blocks}
          me={me}
          isElaborator={isElaborator}
          elaboratorLockedReason={elaboratorLockedReason}
          busy={busy}
          material={material}
          position={index + 1}
          total={ordered.length}
          onPrev={index > 0 ? () => go(ordered[index - 1]) : null}
          onNext={index < ordered.length - 1 ? () => go(ordered[index + 1]) : null}
          onClose={() => onDetail(null)}
          onAction={onAction}
          onReply={onReply}
          onFocus={onFocus}
        />
      ) : !composer ? (
        <EmptyState material={material} hasMarks={marks.length > 0} />
      ) : null}
    </div>
  );
}
