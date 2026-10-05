'use client';

import { useState } from 'react';
import { Alert, Badge, Button, Card, Group, Modal, Stack, Text, Textarea, Title } from '@mantine/core';
import { IconBook, IconCheck, IconHelpCircle, IconLock, IconSignature } from '@tabler/icons-react';
import type { SgcRequestDetail } from '../../../lib/sgc/db/requests';
import SgcSecureViewer from '../SgcSecureViewer';
import SgcSignModal from '../signature/SgcSignModal';
import { sgcSend } from '../useSgcFetch';
import { formatDateCO } from './format';

/**
 * LECTURA OBLIGATORIA de la divulgación (Sprint 4, paso 4). La persona lee el
 * PDF controlado en el visor seguro (sin descarga ni impresión); «Leído» solo
 * se habilita cuando llega al FINAL del documento (el servidor lo registra y
 * lo vuelve a exigir al firmar). «Leído» es una firma electrónica propia del
 * SGC (significado «Leyó», contraseña de SynerLink y motivo).
 */
export interface SgcReadingPanelProps {
  idTask: number;
  requestId: number;
  reading: NonNullable<SgcRequestDetail['reading']>;
  canSign: boolean;
  onDone: (message: string) => void;
}

export default function SgcReadingPanel({ idTask, requestId, reading, canSign, onDone }: SgcReadingPanelProps) {
  const [reachedEnd, setReachedEnd] = useState<string | null>(reading.reachedEndAt);
  const [error, setError] = useState<string | null>(null);
  const [signOpen, setSignOpen] = useState(false);
  // 2026-10-03: «No entendí» (va al historial de la solicitud y avisa al creador y a Calidad).
  const [doubtOpen, setDoubtOpen] = useState(false);
  const [doubt, setDoubt] = useState('');
  const [doubtBusy, setDoubtBusy] = useState(false);
  const [doubtSent, setDoubtSent] = useState<string | null>(null);
  const pending = reading.status === 'pendiente';
  const canDoubt = reading.status !== 'excluido' && reading.pdfReady;

  const sendDoubt = async () => {
    setDoubtBusy(true);
    setError(null);
    try {
      await sgcSend(`/api/sgc/reading/${reading.idAssignee}/doubt`, 'POST', { body: doubt.trim() });
      setDoubtOpen(false);
      setDoubt('');
      setDoubtSent('Su «No entendí» quedó en el historial de la solicitud y se avisó al creador del documento y a Calidad.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDoubtOpen(false);
    } finally {
      setDoubtBusy(false);
    }
  };

  const onEnd = async (pages: number) => {
    if (!pending || reachedEnd) return;
    try {
      const res = await sgcSend<{ reachedEndAt: string | null }>(`/api/sgc/reading/${reading.idAssignee}/progress`, 'POST', { event: 'final', pages });
      setReachedEnd(res.reachedEndAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card shadow='sm' p='xl' radius='md' withBorder mb='6' data-testid='sgc-lectura'>
      <Group justify='space-between' mb='sm'>
        <Title order={4} className='flex items-center gap-2'>
          <IconBook size={18} className='text-blue-6' />
          Lectura obligatoria{reading.document ? ` · ${reading.document.code} V${reading.document.versionNumber}` : ''}
        </Title>
        <Badge color={reading.status === 'leido' ? 'green' : reading.status === 'excluido' ? 'gray' : 'blue'} variant='light' size='lg' radius='sm' data-testid='sgc-lectura-estado'>
          {reading.statusLabel}
        </Badge>
      </Group>
      {reading.document && (
        <Text size='sm' mb='sm'>
          {reading.document.title}
        </Text>
      )}
      <Stack gap='sm'>
        {pending && (
          <Alert color='blue' variant='light' icon={<IconLock size={16} />}>
            Lea el documento completo. «Leído» se habilita al llegar al final y se firma electrónicamente (contraseña de SynerLink y motivo). Mientras la divulgación no termine, la versión anterior sigue vigente.
          </Alert>
        )}
        {reading.status === 'leido' && (
          <Alert color='teal' icon={<IconCheck size={16} />} data-testid='sgc-lectura-firmada'>
            Firmó «Leído» el {formatDateCO(reading.signedAt)}.
          </Alert>
        )}
        {reading.status === 'excluido' && <Alert color='gray'>Su lectura fue excluida por Calidad: {reading.excludeReason}</Alert>}
        {error && <Alert color='red'>{error}</Alert>}
        {doubtSent && (
          <Alert color='teal' icon={<IconCheck size={16} />} data-testid='sgc-no-entendi-enviado'>
            {doubtSent}
          </Alert>
        )}
        {reading.pdfReady && reading.fileUrl ? (
          <SgcSecureViewer fileUrl={reading.fileUrl} canDownload={false} canPrint={false} onReachedEnd={pending ? onEnd : undefined} />
        ) : (
          <Alert color='yellow' icon={<IconLock size={16} />}>
            El PDF controlado de esta versión aún no está disponible. Intente de nuevo en unos minutos.
          </Alert>
        )}
        {(pending || canDoubt) && (
          <Group>
            {pending && (
              <Button color='green' leftSection={<IconSignature size={16} />} disabled={!reachedEnd || !canSign || !reading.content} onClick={() => setSignOpen(true)} data-testid='sgc-lectura-leido'>
                Leído
              </Button>
            )}
            {canDoubt && (
              <Button variant='light' color='orange' leftSection={<IconHelpCircle size={16} />} onClick={() => setDoubtOpen(true)} data-testid='sgc-no-entendi'>
                No entendí
              </Button>
            )}
            {pending && (
              <Text size='xs' c='dimmed' data-testid='sgc-lectura-ayuda'>
                {reachedEnd ? `Llegó al final del documento el ${formatDateCO(reachedEnd)}.` : '«Leído» se habilita al llegar al final del documento.'}
              </Text>
            )}
          </Group>
        )}
      </Stack>
      <Modal opened={doubtOpen} onClose={() => setDoubtOpen(false)} title='No entendí el documento' centered>
        <Stack>
          <Text size='sm' c='dimmed'>
            Cuéntenos qué parte no entendió. Queda en el historial de la solicitud y se avisa al creador del documento y a Calidad. No reemplaza la firma «Leído».
          </Text>
          <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='¿Qué no entendió?' required minRows={3} autosize value={doubt} onChange={(e) => setDoubt(e.currentTarget.value)} data-testid='sgc-no-entendi-texto' />
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setDoubtOpen(false)}>
              Volver
            </Button>
            <Button color='orange' disabled={doubt.trim().length < 10} loading={doubtBusy} onClick={() => void sendDoubt()} data-testid='sgc-no-entendi-enviar'>
              Enviar
            </Button>
          </Group>
        </Stack>
      </Modal>
      {reading.content && (
        <SgcSignModal
          opened={signOpen}
          onClose={() => setSignOpen(false)}
          title={`Firmar lectura · Solicitud #${requestId}`}
          meaning='leyo'
          draft={reading.content}
          submitLabel='Firmar «Leído»'
          onSign={async (payload) => {
            await sgcSend(`/api/sgc/tasks/${idTask}/sign`, 'POST', { ...payload, idAssignee: reading.idAssignee });
            setSignOpen(false);
            onDone('Lectura firmada: quedó registrada su firma «Leyó».');
          }}
        />
      )}
    </Card>
  );
}
