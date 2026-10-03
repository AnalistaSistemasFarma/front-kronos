'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Group, Loader, Modal, ScrollArea, Stack, Text } from '@mantine/core';
import { IconDeviceFloppy } from '@tabler/icons-react';
import {
  SGC_FIELD_KIND,
  fromPlacements,
  toPlacements,
  type SgcPlacementParticipant,
  type SgcStoredField,
  type SignatureFieldPlacement,
} from '../../../lib/sgc/signature/fields';
import SgcEditorSteps, { editorStepSubtitle } from './SgcEditorSteps';
import SgcSignaturePlacementCanvas, { type SgcPlacementPerson } from './SgcSignaturePlacementCanvas';
import SgcSignersPlacementList from './SgcSignersPlacementList';

/**
 * «Ubicar firmas» del SGC — COPIA CONGELADA (2026-10-03) del paso 3
 * «Ubicación» de SynerLink (modal «Preparar documento» de
 * components/orion/OrionSignaturePanel.tsx y su contenido de
 * OrionDocumentEditor.tsx: «Orden de firma» a la izquierda, el documento a la
 * derecha y la botonera abajo), con los mismos estilos y textos. El elaborador
 * elige en el documento dónde firma cada persona (Elaboró, Revisó, Aprobó y
 * el grupo de Calidad); las firmas quedan estampadas ahí en el PDF
 * controlado. Lo propio del SGC: el documento es la VISTA PREVIA del
 * documento final (/api/sgc/requests/<id>/layout/preview) y se guarda en
 * /api/sgc/requests/<id>/layout (no en Orión).
 */

export interface SgcLayoutData {
  idRequest: number;
  institutionalHeader: boolean;
  fields: SgcStoredField[];
  participants: SgcPlacementParticipant[];
  missing: string[];
  suggested: SgcStoredField[];
  canEdit: boolean;
  draft: { name: string; sha256: string; format: string } | null;
  stale: boolean;
  savedBy: string | null;
  savedAt: string | null;
  saves: number;
}

export interface SgcDocumentLayoutModalProps {
  opened: boolean;
  onClose: () => void;
  layout: SgcLayoutData;
  onSave: (fields: Omit<SgcStoredField, 'meaning'>[]) => Promise<void>;
}

const EDITOR_HEIGHT = '100%';

export default function SgcDocumentLayoutModal({ opened, onClose, layout, onSave }: SgcDocumentLayoutModalProps) {
  const documentId = `SOL-${layout.idRequest}`;
  const persons: SgcPlacementPerson[] = useMemo(
    () => layout.participants.map((p, i) => ({ order: i + 1, name: p.name, email: p.email, role: p.role, signatureDataUrl: null, signatureMarkId: null })),
    [layout.participants]
  );
  const initial = useMemo(() => {
    const base = [...layout.fields, ...(layout.canEdit ? layout.suggested.filter((s) => !layout.fields.some((f) => f.signerKey === s.signerKey)) : [])];
    return toPlacements(base, layout.participants, documentId);
  }, [documentId, layout.canEdit, layout.fields, layout.participants, layout.suggested]);
  const [fields, setFields] = useState<SignatureFieldPlacement[]>(initial);
  const [activeOrder, setActiveOrder] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    setFields(initial);
    setActiveOrder(1);
    setError(null);
  }, [opened, initial]);

  const handlePlacementChange = useCallback(
    (next: SignatureFieldPlacement[]) => {
      if (layout.canEdit) setFields(next);
    },
    [layout.canEdit]
  );

  const placedCount = persons.filter((p) => fields.some((f) => f.signerOrder === p.order)).length;
  const usedSuggestions = layout.canEdit && layout.suggested.some((s) => !layout.fields.some((f) => f.signerKey === s.signerKey));
  const pdfSrc = layout.draft ? `/api/sgc/requests/${layout.idRequest}/layout/preview?v=${layout.draft.sha256.slice(0, 12)}${layout.institutionalHeader ? '-i' : ''}` : null;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(fromPlacements(fields, layout.participants));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={`${layout.canEdit ? 'Ubicar firmas' : 'Ubicación de firmas'} — ${layout.draft?.name || 'Documento'}`}
      size='100%'
      centered
      zIndex={300}
      padding='md'
      overlayProps={{ blur: 3, backgroundOpacity: 0.45 }}
      styles={{
        content: {
          maxWidth: 'min(1600px, 98vw)',
          width: '98vw',
          height: '96vh',
          maxHeight: '96vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--app-surface)',
        },
        header: {
          background: 'var(--app-surface)',
          borderBottom: '1px solid var(--app-border)',
          flexShrink: 0,
        },
        title: {
          fontWeight: 700,
          color: 'var(--app-text)',
        },
        body: {
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--app-surface)',
        },
      }}
      data-testid='sgc-ubicar-firmas'
    >
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {!pdfSrc ? (
          <Stack align='center' py='xl'>
            <Text size='sm' c='dimmed'>
              No hay documento PDF disponible.
            </Text>
          </Stack>
        ) : (
          <Stack gap='sm' style={{ height: EDITOR_HEIGHT, minHeight: 0, flex: 1 }}>
            <Box px={4}>
              <Text size='xs' c='dimmed' mb={10} style={{ letterSpacing: '0.02em', textTransform: 'uppercase', fontWeight: 600 }}>
                {editorStepSubtitle(2)}
              </Text>
              <SgcEditorSteps active={2} />
            </Box>

            {error && (
              <Alert color='red' withCloseButton onClose={() => setError(null)}>
                {error}
              </Alert>
            )}

            <Box style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {!layout.canEdit && (
                <Alert color='gray' variant='light' mb='md'>
                  Solo el elaborador ubica las firmas mientras el documento está en elaboración.
                </Alert>
              )}
              {usedSuggestions && (
                <Alert color='blue' variant='light' mb='md' data-testid='sgc-ubicar-sugeridas'>
                  Las firmas sin ubicar se pusieron en los recuadros «Firma» del encabezado institucional. Puede moverlas o redimensionarlas; se guardan al presionar «Guardar ubicaciones».
                </Alert>
              )}
              <Box
                style={{
                  flex: 1,
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'row',
                  gap: 16,
                }}
              >
                <Box
                  style={{
                    width: '30%',
                    minWidth: 260,
                    maxWidth: 320,
                    minHeight: 0,
                    borderRadius: 12,
                    border: '1px solid var(--app-border)',
                    background: 'var(--app-surface-raised)',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <Box
                    px='md'
                    py='sm'
                    style={{
                      borderBottom: '1px solid var(--app-border)',
                      background: 'var(--app-surface)',
                    }}
                  >
                    <Text size='sm' fw={600}>
                      Orden de firma
                    </Text>
                    <Text size='xs' c='dimmed'>
                      Seleccione la persona y ubique su firma en el PDF. Quien elabora, revisa y aprueba (incluido el grupo de Calidad) firma en el lugar que usted elija.
                    </Text>
                  </Box>
                  <ScrollArea style={{ flex: 1 }} offsetScrollbars type='scroll' scrollbarSize={8}>
                    <Box p='md'>
                      <SgcSignersPlacementList participants={persons} activeOrder={activeOrder} onSelect={setActiveOrder} fields={fields} variant='placement' sequential={false} />
                    </Box>
                  </ScrollArea>
                </Box>

                <Box
                  style={{
                    flex: 1,
                    minWidth: 0,
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    borderRadius: 12,
                    border: '1px solid var(--app-border)',
                    background: 'var(--app-bg)',
                    overflow: 'hidden',
                  }}
                  data-testid='sgc-ubicar-documento'
                >
                  <SgcSignaturePlacementCanvas pdfSrc={pdfSrc} documentId={documentId} participants={persons} activeOrder={activeOrder} activeKind={SGC_FIELD_KIND} fields={fields} onChange={handlePlacementChange} />
                </Box>
              </Box>
            </Box>

            <Group justify='space-between' wrap='wrap' pt='sm' mt={4} style={{ borderTop: '1px solid var(--app-border-subtle)', flexShrink: 0 }}>
              <Text size='sm' c='dimmed' fw={500} data-testid='sgc-ubicar-conteo'>
                {placedCount} de {persons.length} firmante(s) con cajas listas
              </Text>
              <Group>
                <Button variant='default' radius='md' onClick={onClose} disabled={saving}>
                  {layout.canEdit ? 'Cancelar' : 'Cerrar'}
                </Button>
                {layout.canEdit && (
                  <Button color='teal' radius='md' leftSection={saving ? <Loader size={14} /> : <IconDeviceFloppy size={16} />} onClick={() => void handleSave()} disabled={saving} data-testid='sgc-ubicar-guardar'>
                    Guardar ubicaciones
                  </Button>
                )}
              </Group>
            </Group>
          </Stack>
        )}
      </div>
    </Modal>
  );
}
