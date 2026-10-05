'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Alert, Anchor, Autocomplete, Button, Card, Checkbox, Code, Group, Modal, PasswordInput, ScrollArea, SegmentedControl, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { sgcTouchComboboxProps } from '../SgcSelect';
import { IconAlertCircle, IconLock, IconSignature } from '@tabler/icons-react';
import type { SgcSignatureMeaning } from '../../../lib/sgc/flows/definition';
import { SGC_SIGNATURE_LABELS } from '../../../lib/sgc/flows/definition';
import {
  SGC_CHECK_ANSWER_LABELS,
  SGC_SIGNATURE_AUTH_METHOD_LABEL,
  SGC_SIGNATURE_CONSENT,
  SGC_SIGNATURE_REASONS,
  type SgcCheckAnswer,
} from '../../../lib/sgc/signature/consent';
import { looksLikeAutofilledEmail, sgcNoAutofill } from '../../../lib/sgc/autofill';
import SgcDocumentViewerModal from '../SgcDocumentViewerModal';

/**
 * Formulario de FIRMA ELECTRÓNICA PROPIA del SGC (Sprint 3).
 *
 * Copia adaptada del flujo de confirmación de GSS Firma/Orión
 * (SignerIdentityForm + consentimiento legal), sin llamarlo: la identidad es
 * la persona de la SESIÓN, que se REAUTENTICA con su contraseña de SynerLink;
 * se indica el significado (fijo por la tarea) y el motivo, se acepta el
 * consentimiento y se ve exactamente qué contenido se firma (nombre y
 * SHA-256). La contraseña solo vive en este formulario y en el POST; se borra
 * después de cada intento. Si la tarea tiene lista de chequeo de Calidad, se
 * responde aquí mismo.
 */

export interface SgcSignPayload {
  meaning: SgcSignatureMeaning;
  reason: string;
  consentAccepted: boolean;
  password: string;
  comment: string;
  draftRef: string | null;
  draftSha256: string | null;
  checklist?: Record<string, { answer: SgcCheckAnswer; observation: string }>;
}

export interface SgcSignModalProps {
  opened: boolean;
  onClose: () => void;
  title: string;
  meaning: SgcSignatureMeaning;
  draft: { ref: string; name: string; sha256: string } | null;
  draftHref?: string | null;
  checklist?: { key: string; label: string; required: boolean; helpText: string | null }[];
  submitLabel?: string;
  onSign: (payload: SgcSignPayload) => Promise<void>;
}

export default function SgcSignModal({ opened, onClose, title, meaning, draft, draftHref, checklist = [], submitLabel, onSign }: SgcSignModalProps) {
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [answers, setAnswers] = useState<Record<string, { answer: SgcCheckAnswer | ''; observation: string }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 2026-10-05: un adjunto (borrador cargado) se VE en el visor seguro de la app; nunca se descarga ni abre otra pestaña.
  const [viewing, setViewing] = useState(false);
  const draftIsAttachment = Boolean(draftHref && /^\/api\/sgc\/requests\/\d+\/attachments\/\d+$/.test(draftHref));
  const { data: session } = useSession();
  const sessionEmail = session?.user?.email ?? '';

  useEffect(() => {
    if (!opened) {
      setPassword('');
      setError(null);
    }
  }, [opened]);
  // Si el navegador alcanzó a rellenar el motivo con el correo, se limpia: el motivo lo escribe la persona.
  useEffect(() => {
    if (opened && looksLikeAutofilledEmail(reason, sessionEmail)) setReason('');
  }, [opened, reason, sessionEmail]);

  const checklistComplete = checklist.every((c) => {
    const a = answers[c.key];
    if (!a?.answer) return false;
    if (a.answer === 'no_aplica' && c.required) return false;
    if (a.answer === 'no_cumple' && a.observation.trim().length < 5) return false;
    return true;
  });
  const anyNoCumple = checklist.some((c) => answers[c.key]?.answer === 'no_cumple');
  const ready = Boolean(draft) && reason.trim().length >= 5 && !looksLikeAutofilledEmail(reason, sessionEmail) && consent && password.length > 0 && checklistComplete && !anyNoCumple;

  const submit = async () => {
    if (!ready || !draft) return;
    setBusy(true);
    setError(null);
    const pw = password;
    setPassword('');
    try {
      await onSign({
        meaning,
        reason: reason.trim(),
        consentAccepted: consent,
        password: pw,
        comment: comment.trim(),
        draftRef: draft.ref,
        draftSha256: draft.sha256,
        checklist: checklist.length
          ? Object.fromEntries(checklist.map((c) => [c.key, { answer: answers[c.key]!.answer as SgcCheckAnswer, observation: answers[c.key]?.observation ?? '' }]))
          : undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <Modal opened={opened} onClose={onClose} title={title} centered size='lg' scrollAreaComponent={ScrollArea.Autosize}>
      {/* Formulario propio (sin envío nativo) para que el gestor de contraseñas asocie la contraseña al usuario explícito, no al motivo. */}
      <form autoComplete='off' onSubmit={(e) => e.preventDefault()} data-testid='sgc-firma-form'>
      <Stack gap='sm' data-testid='sgc-firma-modal'>
        <Group gap='xs'>
          <IconSignature size={18} />
          <Text fw={600}>
            Significado de la firma: <span data-testid='sgc-firma-significado'>{SGC_SIGNATURE_LABELS[meaning]}</span>
          </Text>
        </Group>
        <Card withBorder radius='md' p='sm'>
          <Text size='xs' c='dimmed'>
            Contenido que firma
          </Text>
          {draft ? (
            <>
              <Text size='sm' fw={500} data-testid='sgc-firma-contenido'>
                {draftHref && draftIsAttachment ? (
                  <Anchor component='button' type='button' onClick={() => setViewing(true)} data-testid='sgc-firma-ver-documento'>
                    {draft.name}
                  </Anchor>
                ) : draftHref ? (
                  <Anchor href={draftHref}>
                    {draft.name}
                  </Anchor>
                ) : (
                  draft.name
                )}
              </Text>
              <Text size='xs' c='dimmed'>
                SHA-256 <Code>{draft.sha256}</Code>
              </Text>
            </>
          ) : (
            <Text size='sm' c='red'>
              No hay contenido para firmar (borrador, PDF controlado o resultados): no se puede firmar.
            </Text>
          )}
        </Card>

        {checklist.length > 0 && (
          <Card withBorder radius='md' p='sm' data-testid='sgc-chequeo-calidad'>
            <Text fw={600} size='sm' mb={4}>
              Lista de chequeo de estructura documental (Calidad)
            </Text>
            <Stack gap='xs'>
              {checklist.map((c) => {
                const a = answers[c.key] ?? { answer: '', observation: '' };
                const data = (Object.keys(SGC_CHECK_ANSWER_LABELS) as SgcCheckAnswer[])
                  .filter((k) => !(k === 'no_aplica' && c.required))
                  .map((k) => ({ value: k, label: SGC_CHECK_ANSWER_LABELS[k] }));
                return (
                  <div key={c.key} data-testid={`sgc-chequeo-${c.key}`}>
                    <Text size='sm'>
                      {c.label}
                      {c.required ? ' *' : ''}
                    </Text>
                    {c.helpText && (
                      <Text size='xs' c='dimmed'>
                        {c.helpText}
                      </Text>
                    )}
                    <SegmentedControl size='xs' mt={4} data={data} value={a.answer || ''} onChange={(v) => setAnswers((s) => ({ ...s, [c.key]: { ...a, answer: v as SgcCheckAnswer } }))} />
                    {a.answer === 'no_cumple' && (
                      <TextInput size='xs' mt={4} placeholder='Qué no cumple (mínimo 5 caracteres)' {...sgcNoAutofill(`chequeo-observacion-${c.key}`)} value={a.observation} onChange={(e) => setAnswers((s) => ({ ...s, [c.key]: { ...a, observation: e.currentTarget.value } }))} />
                    )}
                  </div>
                );
              })}
            </Stack>
            {anyNoCumple && (
              <Alert color='orange' mt='xs' icon={<IconAlertCircle size={16} />}>
                Con puntos que no cumplen no se aprueba: cierre este formulario y devuelva el documento a elaboración con sus observaciones.
              </Alert>
            )}
          </Card>
        )}

        <Autocomplete comboboxProps={sgcTouchComboboxProps()}
          label='Motivo de la firma'
          placeholder='Escriba o elija el motivo'
          data={SGC_SIGNATURE_REASONS[meaning]}
          value={reason}
          onChange={setReason}
          required
          id='sgc-signature-reason'
          {...sgcNoAutofill('signature-reason')}
          data-testid='sgc-firma-motivo'
        />
        <Textarea label='Comentario para el historial (opcional)' autosize minRows={2} {...sgcNoAutofill('signature-comment')} value={comment} onChange={(e) => setComment(e.currentTarget.value)} data-testid='sgc-firma-comentario' />

        <Card withBorder radius='md' p='sm' bg='var(--app-surface-raised)'>
          <Text fw={600} size='sm'>
            {SGC_SIGNATURE_CONSENT.title}
          </Text>
          <Text size='xs' c='dimmed' mt={4}>
            {SGC_SIGNATURE_CONSENT.body}
          </Text>
          <Checkbox mt='xs' checked={consent} onChange={(e) => setConsent(e.currentTarget.checked)} label={SGC_SIGNATURE_CONSENT.checkbox} data-testid='sgc-firma-consentimiento' />
        </Card>

        {/* Usuario explícito para el gestor de contraseñas (solo lectura, fuera de la vista): es la persona de la sesión. */}
        <input
          type='email'
          name='username'
          autoComplete='username'
          value={sessionEmail}
          readOnly
          tabIndex={-1}
          aria-label='Usuario que firma'
          data-testid='sgc-firma-usuario'
          style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }}
        />
        <PasswordInput
          label='Contraseña de SynerLink'
          name='current-password'
          description={SGC_SIGNATURE_AUTH_METHOD_LABEL}
          leftSection={<IconLock size={16} />}
          autoComplete='current-password'
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          required
          data-testid='sgc-firma-contrasena'
        />
        {error && (
          <Alert color='red' icon={<IconAlertCircle size={16} />} data-testid='sgc-firma-error'>
            {error}
          </Alert>
        )}
        <Group justify='flex-end'>
          <Button variant='default' onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button color='green' leftSection={<IconSignature size={16} />} onClick={submit} disabled={!ready} loading={busy} data-testid='sgc-firma-confirmar'>
            {submitLabel ?? `Firmar (${SGC_SIGNATURE_LABELS[meaning]})`}
          </Button>
        </Group>
      </Stack>
      </form>
    </Modal>
    {draftIsAttachment && <SgcDocumentViewerModal fileUrl={opened && viewing ? draftHref! : null} title={draft?.name ?? 'Documento'} onClose={() => setViewing(false)} />}
    </>
  );
}
