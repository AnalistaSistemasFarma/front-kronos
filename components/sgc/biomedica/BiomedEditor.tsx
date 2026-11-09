'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Group, Loader, Modal, Stack, Text, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconEye, IconLock } from '@tabler/icons-react';
import PdfAnnotationsModal, { type PdfAnnotationDraft } from '../../pdf-annotations/PdfAnnotationsModal';
import SgcDocumentViewerModal from '../SgcDocumentViewerModal';
import { sgcSend } from '../useSgcFetch';
import type { BiomedRegistroDto } from '../../../lib/biomedica/db';

/**
 * DILIGENCIAR un formato vigente del SGC (Ingeniería biomédica, 2026-11-06):
 * «como si lo imprimiéramos y lo llenáramos a mano». Usa el mismo editor de
 * «Texto y sellos» de la validación de documentos (components/pdf-annotations):
 * texto con letra, tamaño y negrita, y sellos. El formato del SGC no cambia: lo
 * diligenciado queda encima. Si el formato dejó de estar vigente, el registro
 * queda bloqueado (solo consulta).
 */
export default function BiomedEditor({ idCompany, idRegistro, onClose, onChanged }: { idCompany: number; idRegistro: number; onClose: () => void; onChanged: () => void }) {
  const [registro, setRegistro] = useState<BiomedRegistroDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verPdf, setVerPdf] = useState<string | null>(null);

  const base = `/api/biomedica/registros/${idRegistro}`;

  const cargar = useCallback(async () => {
    const res = await fetch(`${base}?company=${idCompany}`, { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body as { error?: string }).error || `Error ${res.status}`);
    setRegistro(body as BiomedRegistroDto);
  }, [base, idCompany]);

  useEffect(() => {
    cargar().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [cargar]);

  const titulo = registro ? `${registro.code} V${registro.versionNumber} · ${registro.equipo}${registro.serial ? ` (serial ${registro.serial})` : ''}` : 'Formato';

  const verDiligenciado = async () => {
    try {
      const res = await fetch(`${base}/pdf?company=${idCompany}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || `Error ${res.status}`);
      setVerPdf(URL.createObjectURL(await res.blob()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const guardar = async (anotaciones: PdfAnnotationDraft[]) => {
    await sgcSend(base, 'PUT', { company: idCompany, anotaciones });
    await cargar();
    onChanged();
    return 'Formato guardado.';
  };

  const subirSello = async (file: File) => {
    const form = new FormData();
    form.append('company', String(idCompany));
    form.append('file', file);
    const res = await fetch(`${base}/sello`, { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || 'No se pudo cargar el sello');
    return data as { sealItemId: string; sealFileName: string };
  };

  const cerrarRegistro = async () => {
    setBusy(true);
    setError(null);
    try {
      await sgcSend(`${base}/cerrar`, 'POST', { company: idCompany });
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const visor = <SgcDocumentViewerModal fileUrl={verPdf} title='Formato diligenciado' onClose={() => setVerPdf(null)} />;

  // Borrador editable: el editor de «Texto y sellos».
  if (registro?.puedeEditar) {
    return (
      <>
        <PdfAnnotationsModal
          opened
          onClose={onClose}
          title={
            <Group gap='xs'>
              <Text fw={700}>Diligenciar · {titulo}</Text>
              <Badge variant='light' color='blue'>
                Borrador
              </Badge>
            </Group>
          }
          notice={
            <>
              {error ? (
                <Text size='sm' c='red' mb={4} data-testid='biomed-editor-error'>
                  {error}
                </Text>
              ) : null}
              Escriba sobre el formato vigente (V{registro.versionNumber}) como si lo llenara a mano: «Texto», clic donde va el dato y escriba
              (para marcar una casilla, escriba X). El formato del SGC no cambia. Guarde cuando quiera y, al terminar, cierre el registro: queda como
              evidencia y ya no se modifica.
            </>
          }
          pdfSrc={`${base}/pdf?company=${idCompany}&vacio=1`}
          initial={registro.anotaciones}
          loadingLabel='Cargando el formato…'
          sealSrc={(itemId) => `${base}/sello?${new URLSearchParams({ company: String(idCompany), itemId })}`}
          uploadSeal={subirSello}
          onSave={guardar}
          closeOnSave={false}
          showPreview={false}
          extraActions={({ dirty, saving }) => (
            <>
              <Button variant='subtle' leftSection={<IconEye size={16} />} onClick={() => void verDiligenciado()} disabled={saving} data-testid='biomed-ver-pdf'>
                Ver diligenciado
              </Button>
              <Tooltip label={dirty ? 'Guarde primero los cambios' : 'Queda como evidencia y ya no se modifica'} withArrow>
                <Button variant='light' color='green' leftSection={<IconCheck size={16} />} loading={busy} disabled={dirty || saving} onClick={() => void cerrarRegistro()} data-testid='biomed-cerrar'>
                  Cerrar registro
                </Button>
              </Tooltip>
            </>
          )}
        />
        {visor}
      </>
    );
  }

  // Cerrado, bloqueado o de otra persona: solo consulta.
  return (
    <>
      <Modal opened onClose={onClose} title={<Text fw={700}>{titulo}</Text>} size='lg' data-testid='biomed-editor'>
        <Stack gap='sm'>
          {error && (
            <Alert color='red' icon={<IconAlertTriangle size={18} />} data-testid='biomed-editor-error'>
              {error}
            </Alert>
          )}
          {!registro && !error && (
            <Group justify='center' my='md'>
              <Loader />
            </Group>
          )}
          {registro && (
            <>
              <Group gap='xs'>
                <Badge variant='light' color={registro.estado === 'cerrado' ? 'green' : registro.bloqueado ? 'orange' : 'blue'}>
                  {registro.estado === 'cerrado' ? 'Cerrado' : registro.bloqueado ? 'Bloqueado' : 'Borrador'}
                </Badge>
                <Text size='sm' c='dimmed'>
                  {registro.estado === 'cerrado' ? 'Registro cerrado: queda como evidencia.' : registro.motivoBloqueo ? '' : 'Solo quien lo diligenció (o Calidad) lo modifica.'}
                </Text>
              </Group>
              {registro.motivoBloqueo && (
                <Alert color='orange' icon={<IconLock size={18} />} title='Formato bloqueado' data-testid='biomed-bloqueado'>
                  {registro.motivoBloqueo}
                </Alert>
              )}
              <Group justify='flex-end'>
                <Button leftSection={<IconEye size={16} />} onClick={() => void verDiligenciado()} data-testid='biomed-ver-pdf'>
                  Ver diligenciado
                </Button>
              </Group>
            </>
          )}
        </Stack>
      </Modal>
      {visor}
    </>
  );
}
