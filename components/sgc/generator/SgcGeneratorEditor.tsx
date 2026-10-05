'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { ActionIcon, Alert, Badge, Button, Card, Divider, Group, Loader, Modal, Stack, Text, Tooltip } from '@mantine/core';
import {
  IconAlertCircle,
  IconArrowLeft,
  IconBold,
  IconDownload,
  IconFileExport,
  IconH1,
  IconH2,
  IconH3,
  IconInfoCircle,
  IconItalic,
  IconList,
  IconListNumbers,
  IconRefresh,
  IconTable,
} from '@tabler/icons-react';
import SgcSecureViewer from '../SgcSecureViewer';
import { SgcDocumentCode } from '../SgcBadges';
import { sgcHref } from '../useSgcCompany';
import { useSgcFetch } from '../useSgcFetch';
import { SgcImage } from '../draft/sgcImage';
import { SGC_BASE_URL } from '../../../lib/sgc/constants';
import type { SgcCompanyAccess } from '../../../lib/sgc/permissions';

/**
 * GENERADOR DE DOCUMENTOS — editor de la COPIA DE TRABAJO (2026-10-05).
 *
 * Mismo editor Tiptap del borrador (components/sgc/draft/SgcDraftEditor.tsx,
 * copia del módulo documental anterior) y misma barra de herramientas, pero
 * sin revisiones ni guardado: el contenido vigente se carga como copia de
 * trabajo, se modifica y «Generar documento» produce el PDF con el encabezado
 * del documento de origen. La vista previa va en el visor seguro y, solo aquí,
 * se permite «Descargar PDF» (es la versión modificada generada desde la
 * plataforma). No pide motivo de cambio: no es un cambio del documento.
 */

interface BaseResponse {
  document: { id: number; idCompany: number; code: string; title: string; versionNumber: number; idVersion: number };
  sourceFormat: 'docx' | 'html';
  html: string;
}

function Tool({ label, icon, active, onClick }: { label: string; icon: React.ReactNode; active?: boolean; onClick: () => void }) {
  return (
    <Tooltip label={label}>
      <ActionIcon variant={active ? 'filled' : 'default'} color={active ? 'blue' : undefined} onClick={onClick} aria-label={label}>
        {icon}
      </ActionIcon>
    </Tooltip>
  );
}

async function generate(idDocument: number, html: string, modo: 'vista' | 'descarga'): Promise<{ blob: Blob; fileName: string }> {
  const res = await fetch(`/api/sgc/generator/${idDocument}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ html, modo }) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `Error ${res.status}`);
  const disposition = res.headers.get('content-disposition') ?? '';
  const m = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  return { blob: await res.blob(), fileName: m ? decodeURIComponent(m[1]) : 'documento-generado.pdf' };
}

export default function SgcGeneratorEditor({ company, idDocument }: { company: SgcCompanyAccess; idDocument: number }) {
  const base = useSgcFetch<BaseResponse>(`/api/sgc/generator/${idDocument}`);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<'vista' | 'descarga' | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);

  const editor = useEditor({ extensions: [StarterKit, Table.configure({ resizable: true }), TableRow, TableHeader, TableCell, SgcImage], content: '', immediatelyRender: false, editable: true });

  useEffect(() => {
    if (editor && base.data) editor.commands.setContent(base.data.html);
  }, [editor, base.data]);

  // Libera la vista previa al cerrarla o al salir.
  const setPreviewUrl = (url: string | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = url;
    setPreview(url);
  };
  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  const onGenerate = async () => {
    if (!editor) return;
    setMsg(null);
    setBusy('vista');
    try {
      const { blob } = await generate(idDocument, editor.getHTML(), 'vista');
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const onDownload = async () => {
    if (!editor) return;
    setBusy('descarga');
    try {
      const { blob, fileName } = await generate(idDocument, editor.getHTML(), 'descarga');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMsg({ ok: true, text: `Se descargó «${fileName}». La generación y la descarga quedaron en la auditoría del SGC.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const back = sgcHref(`${SGC_BASE_URL}/generador`, company.idCompany);

  if (base.loading && !base.data) {
    return (
      <Group justify='center' my='xl'>
        <Loader />
      </Group>
    );
  }
  if (base.error || !base.data) {
    return (
      <Stack>
        <Alert color='red' icon={<IconAlertCircle size={16} />} title='No se pudo abrir el documento' data-testid='sgc-generador-error'>
          {base.error ?? 'No se encontró el documento.'}
        </Alert>
        <Group>
          <Button component={Link} href={back} variant='outline' leftSection={<IconArrowLeft size={16} />}>
            Volver al generador
          </Button>
        </Group>
      </Stack>
    );
  }
  const d = base.data.document;

  return (
    <Stack gap='lg'>
      <Card withBorder radius='md' p='lg' shadow='xs'>
        <Group justify='space-between' align='flex-start' wrap='wrap' gap='md'>
          <Stack gap={6}>
            <SgcDocumentCode code={d.code} versionNumber={d.versionNumber} />
            <Text fw={600} size='lg' data-testid='sgc-generador-titulo'>
              {d.title}
            </Text>
            <Group gap={6}>
              <Badge variant='light' color='orange'>
                Copia de trabajo
              </Badge>
              <Badge variant='light' color='gray'>
                Desde {base.data.sourceFormat === 'docx' ? 'el Word vigente' : 'el contenido vigente del editor'}
              </Badge>
            </Group>
          </Stack>
          <Group gap='xs'>
            <Button component={Link} href={back} variant='default' leftSection={<IconArrowLeft size={16} />}>
              Volver al generador
            </Button>
            <Button component={Link} href={sgcHref(`${SGC_BASE_URL}/documentos/${d.id}`, company.idCompany)} variant='light'>
              Ficha del documento
            </Button>
          </Group>
        </Group>
        <Alert mt='md' color='blue' variant='light' icon={<IconInfoCircle size={16} />}>
          Está editando una copia de trabajo de {d.code} V{d.versionNumber}. El documento controlado no cambia, no se crea versión ni solicitud y no se guarda nada: al pulsar «Generar documento» se arma un PDF con el encabezado del documento de origen y la leyenda «Documento generado a partir de {d.code} v{d.versionNumber}».
        </Alert>
        {msg && (
          <Alert mt='sm' color={msg.ok ? 'green' : 'red'} icon={<IconAlertCircle size={16} />} withCloseButton onClose={() => setMsg(null)} data-testid='sgc-generador-mensaje'>
            {msg.text}
          </Alert>
        )}
      </Card>

      <Card shadow='sm' radius='md' withBorder>
        <Group justify='space-between' mb='sm' wrap='wrap'>
          <Group gap={4}>
            <Tool label='Negrita' icon={<IconBold size={16} />} active={editor?.isActive('bold')} onClick={() => editor?.chain().focus().toggleBold().run()} />
            <Tool label='Cursiva' icon={<IconItalic size={16} />} active={editor?.isActive('italic')} onClick={() => editor?.chain().focus().toggleItalic().run()} />
            <Divider orientation='vertical' />
            <Tool label='Título 1' icon={<IconH1 size={16} />} active={editor?.isActive('heading', { level: 1 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} />
            <Tool label='Título 2' icon={<IconH2 size={16} />} active={editor?.isActive('heading', { level: 2 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} />
            <Tool label='Título 3' icon={<IconH3 size={16} />} active={editor?.isActive('heading', { level: 3 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} />
            <Divider orientation='vertical' />
            <Tool label='Lista con viñetas' icon={<IconList size={16} />} active={editor?.isActive('bulletList')} onClick={() => editor?.chain().focus().toggleBulletList().run()} />
            <Tool label='Lista numerada' icon={<IconListNumbers size={16} />} active={editor?.isActive('orderedList')} onClick={() => editor?.chain().focus().toggleOrderedList().run()} />
            <Divider orientation='vertical' />
            <Tool label='Insertar tabla 3x3' icon={<IconTable size={16} />} onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
          </Group>
          <Group gap='xs'>
            <Button variant='default' leftSection={<IconRefresh size={16} />} onClick={() => editor?.commands.setContent(base.data!.html)} disabled={busy !== null} data-testid='sgc-generador-restaurar'>
              Restaurar contenido vigente
            </Button>
            <Button leftSection={<IconFileExport size={16} />} onClick={onGenerate} loading={busy === 'vista'} disabled={busy !== null} data-testid='sgc-generador-generar'>
              Generar documento
            </Button>
          </Group>
        </Group>
        <Divider mb='md' />
        <div className='sgc-editor-wrapper' data-testid='sgc-generador-editor'>
          <EditorContent editor={editor} />
        </div>
      </Card>

      <Modal opened={Boolean(preview)} onClose={() => setPreviewUrl(null)} title={`Documento generado · ${d.code} V${d.versionNumber}`} centered size='xl' zIndex={400} overlayProps={{ blur: 3, backgroundOpacity: 0.45 }} data-testid='sgc-generador-vista'>
        <Stack gap='sm'>
          <Group justify='space-between' wrap='wrap'>
            <Text size='sm' c='dimmed'>
              Revise la vista previa. La descarga es solo del documento generado (no es copia controlada) y queda en la auditoría.
            </Text>
            <Button leftSection={<IconDownload size={16} />} onClick={onDownload} loading={busy === 'descarga'} disabled={busy !== null} data-testid='sgc-generador-descargar'>
              Descargar PDF
            </Button>
          </Group>
          {preview && <SgcSecureViewer key={preview} fileUrl={preview} canDownload={false} canPrint={false} hideDownloadPrint caption='Documento generado · vista previa' />}
        </Stack>
      </Modal>

      <style jsx global>{`
        .sgc-editor-wrapper .ProseMirror { min-height: 480px; padding: 24px 32px; background: white; border: 1px solid var(--mantine-color-gray-3); border-radius: 8px; outline: none; font-size: 14px; line-height: 1.6; color: #1a1a1a; }
        .sgc-editor-wrapper .ProseMirror h1 { font-size: 1.6em; font-weight: 700; margin: 0 0 0.4em; }
        .sgc-editor-wrapper .ProseMirror h2 { font-size: 1.3em; font-weight: 700; margin: 1em 0 0.4em; }
        .sgc-editor-wrapper .ProseMirror h3 { font-size: 1.1em; font-weight: 700; margin: 0.8em 0 0.4em; }
        .sgc-editor-wrapper .ProseMirror p { margin: 0 0 0.6em; }
        .sgc-editor-wrapper .ProseMirror ul { list-style: disc; padding-left: 1.4em; }
        .sgc-editor-wrapper .ProseMirror ol { list-style: decimal; padding-left: 1.4em; }
        .sgc-editor-wrapper .ProseMirror table { border-collapse: collapse; width: 100%; margin: 0.6em 0; }
        .sgc-editor-wrapper .ProseMirror td, .sgc-editor-wrapper .ProseMirror th { border: 1px solid #ccc; padding: 6px 10px; min-width: 60px; }
        .sgc-editor-wrapper .ProseMirror th { background: #f2f2f2; font-weight: 600; }
        .sgc-editor-wrapper .ProseMirror img { max-width: 100%; height: auto; }
      `}</style>
    </Stack>
  );
}
