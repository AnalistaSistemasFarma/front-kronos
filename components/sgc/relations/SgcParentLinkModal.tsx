'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Group, Loader, Modal, Stack, Text, Textarea } from '@mantine/core';
import { IconAlertTriangle, IconHierarchy2, IconInfoCircle } from '@tabler/icons-react';
import SgcSelect from '../SgcSelect';
import { sgcSend, useSgcFetch } from '../useSgcFetch';
import type { SgcParentOptions } from '../../../lib/sgc/db/relations';
import { hierarchyRelationFor } from '../../../lib/sgc/hierarchy';
import { SGC_RELATION_LABELS } from '../../../lib/sgc/relations';

/**
 * «RELACIONAR CON PADRE» (documentos padre e hijos, 2026-10-19): la misma
 * confirmación para el ARRASTRE en el mapa (llega con el padre sobre el que se
 * soltó el hijo) y para el BOTÓN accesible, que funciona en el celular y con
 * teclado. Solo Calidad. Pide el motivo (queda en la auditoría) y muestra la
 * regla que impide relacionar: el padre no tiene padre, un hijo tiene un solo
 * padre y el padre debe ser de un tipo padre.
 */
export interface SgcParentLinkTarget {
  idDocument: number;
  code: string;
  title?: string;
}

export default function SgcParentLinkModal({
  child,
  presetParent,
  via,
  onClose,
  onDone,
}: {
  child: SgcParentLinkTarget | null;
  presetParent?: SgcParentLinkTarget | null;
  via: 'arrastre' | 'boton';
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const options = useSgcFetch<SgcParentOptions>(child ? `/api/sgc/relations/parent?document=${child.idDocument}` : null);
  const [idParent, setIdParent] = useState<string | null>(presetParent ? String(presetParent.idDocument) : null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIdParent(presetParent ? String(presetParent.idDocument) : null);
    setReason('');
    setError(null);
  }, [child?.idDocument, presetParent?.idDocument]);

  // useSgcFetch conserva la respuesta anterior mientras carga la nueva: solo vale la del documento actual.
  const o = options.data && child && options.data.document.idDocument === child.idDocument ? options.data : null;
  const parent = o?.candidates.find((c) => String(c.idDocument) === idParent) ?? null;
  const presetInvalid = Boolean(o && presetParent && !o.candidates.some((c) => c.idDocument === presetParent.idDocument));
  const relationLabel = o && parent ? SGC_RELATION_LABELS[hierarchyRelationFor(parent.idDocument, o.document.idDocument, o.document.documentTypeCode).type] : null;
  const blocked = !o || o.isParentType || Boolean(o.parent) || presetInvalid;

  const save = async () => {
    if (!o || !parent) return;
    setBusy(true);
    setError(null);
    try {
      await sgcSend('/api/sgc/relations/parent', 'POST', { idChild: o.document.idDocument, idParent: parent.idDocument, reason, via });
      onDone(`${o.document.code} quedó como hijo de ${parent.code}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={Boolean(child)} onClose={onClose} title={child ? `Relacionar ${child.code} con su documento padre` : ''} centered data-testid='sgc-padre-modal'>
      <Stack>
        {error && (
          <Alert color='red' icon={<IconAlertTriangle size={16} />} data-testid='sgc-padre-error'>
            {error}
          </Alert>
        )}
        {options.error && <Alert color='red'>{options.error}</Alert>}
        {!o && !options.error && (
          <Group justify='center'>
            <Loader size='sm' />
          </Group>
        )}
        {o?.isParentType && (
          <Alert color='orange' icon={<IconInfoCircle size={16} />} data-testid='sgc-padre-es-padre'>
            {o.document.code} es un documento padre (tipo {o.document.documentTypeCode}): el documento padre no tiene padre.
          </Alert>
        )}
        {o?.parent && (
          <Alert color='orange' icon={<IconInfoCircle size={16} />} data-testid='sgc-padre-ya-tiene'>
            {o.document.code} ya es hijo de {o.parent.code}. Un hijo tiene un solo padre: retire primero esa relación en la ficha del documento.
          </Alert>
        )}
        {o && presetParent && presetInvalid && !o.isParentType && !o.parent && (
          <Alert color='orange' icon={<IconInfoCircle size={16} />} data-testid='sgc-padre-no-es-padre'>
            {presetParent.code} no es un documento padre vigente (tipos padre de la empresa: {o.parentTypeCodes.join(', ') || 'ninguno configurado'}). Suelte el documento sobre un procedimiento.
          </Alert>
        )}
        {o && !blocked && (
          <>
            <SgcSelect
              label='Documento padre'
              description='Solo los documentos de un tipo padre (por ejemplo, el procedimiento), vigentes o pendientes de archivo.'
              data={o.candidates.map((c) => ({ value: String(c.idDocument), label: `${c.code} · ${c.title}` }))}
              value={idParent}
              onChange={setIdParent}
              searchable
              nothingFoundMessage='No hay documentos padre vigentes'
              data-testid='sgc-padre-select'
            />
            {parent && (
              <Alert color='blue' variant='light' icon={<IconHierarchy2 size={16} />} data-testid='sgc-padre-resumen'>
                <Text size='sm'>
                  <Text span ff='monospace' fw={700}>
                    {o.document.code}
                  </Text>{' '}
                  quedará como hijo de{' '}
                  <Text span ff='monospace' fw={700}>
                    {parent.code}
                  </Text>{' '}
                  ({relationLabel}). La relación queda confirmada y en la auditoría.
                </Text>
              </Alert>
            )}
            <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Motivo' description='Queda en la auditoría (mínimo 10 caracteres).' autosize minRows={2} value={reason} onChange={(e) => setReason(e.currentTarget.value)} data-testid='sgc-padre-motivo' />
          </>
        )}
        <Group justify='flex-end'>
          <Button variant='default' onClick={onClose}>
            Cancelar
          </Button>
          {!blocked && (
            <Button leftSection={<IconHierarchy2 size={16} />} loading={busy} disabled={!parent || reason.trim().length < 10} onClick={save} data-testid='sgc-padre-guardar'>
              Relacionar
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
