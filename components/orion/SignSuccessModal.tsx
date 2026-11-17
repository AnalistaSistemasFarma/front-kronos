'use client';

import { Button, Modal, Stack, Text } from '@mantine/core';
import { IconArrowBackUp, IconCheck, IconFileText } from '@tabler/icons-react';
import styles from './signSuccessModal.module.css';

export type SignSuccessInfo = {
  message: string;
  fileName?: string | null;
  kind?: 'signed' | 'already' | 'closed' | 'returned';
  /** Todos los firmantes ya terminaron. */
  documentComplete?: boolean;
  nextSignerLabel?: string | null;
  signedAt?: Date;
};

type Props = {
  info: SignSuccessInfo | null;
  userName?: string | null;
  requestTitle?: string | null;
  onClose: () => void;
};

function firstName(full?: string | null): string {
  const raw = String(full || '').trim();
  if (!raw) return '';
  return raw.split(/\s+/)[0] || '';
}

function formatSignedAt(date: Date): string {
  try {
    return new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return date.toLocaleString('es-CO');
  }
}

function SuccessMark({ kind, replayKey }: { kind: SignSuccessInfo['kind']; replayKey: string }) {
  const isReturn = kind === 'returned';
  return (
    <div
      key={replayKey}
      className={styles.hero}
      data-tone={isReturn ? 'return' : 'ok'}
      aria-hidden
    >
      <div className={styles.orbGlow} />
      {!isReturn ? (
        <>
          <span className={styles.spark} />
          <span className={styles.spark} />
          <span className={styles.spark} />
          <span className={styles.spark} />
          <span className={styles.spark} />
        </>
      ) : null}
      <svg className={styles.markSvg} viewBox='0 0 112 112' role='img'>
        <circle className={styles.circle} cx='56' cy='52' r='34' />
        {isReturn ? (
          <path
            className={styles.returnArrow}
            d='M44 52h28M44 52l10-10M44 52l10 10'
          />
        ) : (
          <>
            <path className={styles.check} d='M38 53l12 12 24-26' />
            {/* Trazo tipo rúbrica debajo del chulito */}
            {kind === 'signed' ? (
              <path
                className={styles.signature}
                d='M22 92c8-10 14-4 20 2 7 7 12-12 20-8 7 3 10 10 18 6 6-3 10-8 16-6'
              />
            ) : null}
          </>
        )}
      </svg>
    </div>
  );
}

export default function SignSuccessModal({
  info,
  userName,
  requestTitle,
  onClose,
}: Props) {
  const opened = Boolean(info);
  const kind = info?.kind ?? 'signed';
  const name = firstName(userName);
  const fileName = String(info?.fileName || '').trim() || 'Documento';
  const signedAt = info?.signedAt ?? new Date();
  const replayKey = opened
    ? `${kind}-${info?.fileName || ''}-${info?.signedAt?.getTime?.() || 'x'}`
    : 'closed';

  const headline =
    kind === 'already'
      ? name
        ? `${name}, su firma ya estaba registrada`
        : 'Su firma ya estaba registrada'
      : kind === 'closed'
        ? 'Este documento ya está cerrado'
        : kind === 'returned'
          ? 'Documento devuelto'
          : name
            ? `¡Listo, ${name}!`
            : '¡Documento firmado!';

  const sub =
    kind === 'signed'
      ? info?.documentComplete
        ? 'Su firma quedó registrada y el documento quedó completo. Gracias por completar el flujo.'
        : info?.nextSignerLabel
          ? `Su firma quedó registrada. Sigue ${info.nextSignerLabel} en la secuencia.`
          : 'Su firma quedó registrada correctamente en GSS Firma.'
      : info?.message ||
        (kind === 'already'
          ? 'No es necesario firmar de nuevo. Puede continuar con el flujo.'
          : kind === 'returned'
            ? 'El documento volvió a quien gestiona la firma para corrección.'
            : 'No hay firma pendiente en este documento.');

  const buttonColor = kind === 'returned' ? 'orange' : 'green';

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      size='sm'
      radius='lg'
      padding={0}
      withCloseButton={false}
      zIndex={500}
      overlayProps={{ blur: 6, backgroundOpacity: 0.45 }}
      transitionProps={{ transition: 'pop', duration: 220 }}
      aria-labelledby='orion-sign-success-title'
    >
      <div className={styles.shell} data-tone={kind === 'returned' ? 'return' : 'ok'}>
        <Stack align='center' gap='sm'>
          <SuccessMark kind={kind} replayKey={replayKey} />

          <span className={styles.kicker} data-tone={kind === 'returned' ? 'return' : 'ok'}>
            {kind === 'returned' ? (
              <IconArrowBackUp size={12} stroke={2.5} />
            ) : (
              <IconCheck size={12} stroke={2.5} />
            )}
            {kind === 'signed'
              ? 'Firma registrada'
              : kind === 'returned'
                ? 'Devuelto'
                : 'Confirmación'}
          </span>

          <Text id='orion-sign-success-title' fw={800} fz='xl' ta='center' lh={1.25}>
            {headline}
          </Text>

          <Text size='sm' c='dimmed' ta='center' maw={340} lh={1.45}>
            {sub}
          </Text>

          <div className={styles.fileChip} title={fileName}>
            <IconFileText size={15} stroke={1.8} aria-hidden />
            <span>{fileName}</span>
          </div>

          <div className={styles.metaRow}>
            {requestTitle ? <span>Solicitud · {requestTitle}</span> : null}
            {kind === 'signed' ? <span>{formatSignedAt(signedAt)}</span> : null}
          </div>

          <Button
            mt='xs'
            fullWidth
            color={buttonColor}
            radius='md'
            leftSection={
              kind === 'returned' ? <IconArrowBackUp size={16} /> : <IconCheck size={16} />
            }
            onClick={onClose}
          >
            Continuar
          </Button>
        </Stack>
      </div>
    </Modal>
  );
}
