'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import {
  Alert,
  Anchor,
  Badge,
  Breadcrumbs,
  Button,
  Card,
  Divider,
  FileInput,
  Group,
  Loader,
  Modal,
  Text,
  Title,
  Tooltip,
  ActionIcon,
} from '@mantine/core';
import {
  IconChevronRight,
  IconFileDescription,
  IconBold,
  IconItalic,
  IconH1,
  IconH2,
  IconH3,
  IconList,
  IconListNumbers,
  IconTable,
  IconDeviceFloppy,
  IconArrowBackUp,
  IconAlertTriangle,
  IconUpload,
} from '@tabler/icons-react';
import toast from 'react-hot-toast';

/**
 * Sprint 8 — Editor de documentos (Tiptap) dentro de SynerLink.
 *
 * MVP genérico (sin plantillas por tipo de documento -- fuera de alcance):
 * el usuario edita texto enriquecido (títulos, párrafos, listas, tabla
 * simple) sobre la versión VIGENTE del documento.
 *
 * Decisión de producto de Nicolás (2026-09-03): "Guardar" ya NO se comporta
 * igual siempre -- depende de si el documento tiene proceso/categoría
 * asociado (`document.id_process`, resuelto por el SERVIDOR en
 * app/api/document-management/documents/[id]/editor/route.ts, nunca
 * decidido aquí):
 *
 *   - Sin proceso: el PDF se descarga directo al equipo del usuario. No se
 *     toca OneDrive ni la base de datos.
 *   - Con proceso: se crea una versión NUEVA que entra al flujo de
 *     aprobación de 14 estados. La versión vigente actual no cambia hasta
 *     que ese flujo la publique.
 *
 * La respuesta del POST distingue el caso por su Content-Type: un PDF
 * binario (`application/pdf`) dispara la descarga en el navegador; un JSON
 * trae la versión nueva creada.
 *
 * Arranca con un esqueleto básico (título + sección + párrafo) cuando la
 * versión nunca se editó desde aquí (`content_html` viene null). Salvaguarda:
 * si el `content_html` de la versión que se está editando es null o es
 * exactamente ese esqueleto, se exige una confirmación explícita antes de
 * guardar -- aplica tanto si el guardado termina en descarga como si
 * termina en versión nueva.
 *
 * Sprint 9 (2026-09-03, aclaración de Nicolás con captura de pantalla): el
 * flujo real no es "crear desde cero en el editor en blanco" -- el usuario
 * SUBE un Word (.docx) ya elaborado y ese contenido convertido es el punto
 * de partida para que otros usuarios trabajen sobre la plantilla. Por eso,
 * mientras `isEditingEmptyTemplate` sea true, se muestra un bloque para
 * subir un .docx: se convierte en el servidor (`mammoth`, ver
 * app/api/document-management/documents/[id]/upload-word/route.ts, que
 * también persiste el HTML convertido en `content_html`) y el resultado se
 * carga directo en Tiptap para seguir editando -- no hace falta presionar
 * "Guardar" aparte para que quede la carga inicial, aunque el usuario sigue
 * pudiendo seguir editando y guardando normalmente después.
 */

const SKELETON_HTML = `
<h1>Título del documento</h1>
<h2>1. Sección</h2>
<p>Escriba aquí el contenido de esta sección.</p>
`;

interface EditorDocument {
  id_document: number;
  code: string;
  title: string;
  company: string;
  documentType: string;
  id_process: number | null;
}

interface EditorVersion {
  id_document_version: number;
  version_number: number;
  status: string;
  content_html: string | null;
  onedrive_item_id: string | null;
}

interface NewVersionResponse {
  version: {
    id_document_version: number;
    version_number: number;
    status: string;
    content_html: string | null;
    id_request_general: number;
  };
  pdfBytes: number;
}

function ToolbarButton({
  onClick,
  active,
  label,
  icon,
}: {
  onClick: () => void;
  active?: boolean;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <Tooltip label={label}>
      <ActionIcon variant={active ? 'filled' : 'default'} color={active ? 'blue' : undefined} onClick={onClick} aria-label={label}>
        {icon}
      </ActionIcon>
    </Tooltip>
  );
}

export default function DocumentEditorPage() {
  const params = useParams();
  const router = useRouter();
  const idDocument = Number(params?.id);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documentInfo, setDocumentInfo] = useState<EditorDocument | null>(null);
  const [versionInfo, setVersionInfo] = useState<EditorVersion | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [confirmEmptyOpen, setConfirmEmptyOpen] = useState(false);
  const [wordFile, setWordFile] = useState<File | null>(null);
  const [uploadingWord, setUploadingWord] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: '',
    immediatelyRender: false,
  });

  useEffect(() => {
    // Fix 2026-09-04 (bug documento id=14, "editor vacío con content_html
    // real"): con `immediatelyRender: false` (arriba), `editor` llega como
    // `null` en el primer render -- Tiptap recién crea la instancia real en
    // un efecto interno posterior. Este efecto se define con `[idDocument]`
    // como dependencia, así que su closure capturaba ese `editor` nulo del
    // montaje INICIAL para siempre: `editor?.commands.setContent(...)` en
    // `loadData` quedaba como no-op permanente aunque el fetch trajera bien
    // los 2200 caracteres reales del documento (confirmado con curl directo
    // al endpoint) -- el editor nunca se enteraba. Se agrega `editor` a las
    // dependencias y se espera a que exista antes de cargar los datos.
    if (!idDocument || !editor) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idDocument, editor]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/document-management/documents/${idDocument}/editor`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo cargar el editor');

      setDocumentInfo(data.document);
      setVersionInfo(data.version);
      editor?.commands.setContent(data.version.content_html || SKELETON_HTML);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  };

  // Salvaguarda: la versión que se está editando nunca tuvo contenido real
  // cargado (todavía es null en la base, o es literalmente el esqueleto
  // genérico) -- ver nota de módulo arriba.
  const isEditingEmptyTemplate =
    versionInfo?.content_html === null || versionInfo?.content_html === SKELETON_HTML;

  // Sprint 9: sube el .docx elegido, lo convierte en el servidor (mammoth) y
  // carga el HTML resultante directo en Tiptap para que el usuario siga
  // editando -- ver nota de módulo arriba.
  const handleWordUpload = async () => {
    if (!wordFile || !idDocument) return;
    try {
      setUploadingWord(true);
      const formData = new FormData();
      formData.append('file', wordFile);

      const res = await fetch(`/api/document-management/documents/${idDocument}/upload-word`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || 'No se pudo convertir el documento Word');
      }

      editor?.commands.setContent(data.version.content_html);
      setVersionInfo((prev) =>
        prev
          ? { ...prev, content_html: data.version.content_html, status: data.version.status }
          : prev
      );
      setWordFile(null);
      toast.success(
        'Word convertido y cargado en el editor. Revise el contenido y presione "Guardar" cuando esté listo.'
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado al subir el Word');
    } finally {
      setUploadingWord(false);
    }
  };

  const handleSave = () => {
    if (!editor) return;
    const html = editor.getHTML();
    if (!html || html === '<p></p>') {
      toast.error('El documento no puede quedar vacío.');
      return;
    }
    if (isEditingEmptyTemplate) {
      setConfirmEmptyOpen(true);
      return;
    }
    void doSave(html);
  };

  const doSave = async (html: string) => {
    try {
      setSaving(true);
      const res = await fetch(`/api/document-management/documents/${idDocument}/editor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_html: html }),
      });

      const contentType = res.headers.get('content-type') || '';

      if (!res.ok) {
        let message = 'No se pudo guardar';
        if (contentType.includes('application/json')) {
          const data = await res.json().catch(() => null);
          message = data?.error || message;
        }
        throw new Error(message);
      }

      if (contentType.includes('application/pdf')) {
        // Caso A (sin proceso): descarga directa, no se tocó OneDrive ni la BD.
        const blob = await res.blob();
        const disposition = res.headers.get('content-disposition') || '';
        const match = disposition.match(/filename="([^"]+)"/);
        const fileName = match ? match[1] : `${documentInfo?.code || 'documento'}.pdf`;
        const url = URL.createObjectURL(blob);
        const link = window.document.createElement('a');
        link.href = url;
        link.download = fileName;
        window.document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        setLastSavedAt(new Date());
        toast.success('PDF generado y descargado. La versión vigente no se modificó.');
        return;
      }

      // Caso B (con proceso): versión nueva creada, enviada al flujo de aprobación.
      const data: NewVersionResponse = await res.json();
      setLastSavedAt(new Date());
      toast.success(
        `Versión v${data.version.version_number} creada y enviada al flujo de aprobación. La versión vigente actual no cambió.`
      );
      router.push(`/process/document-management/${idDocument}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error guardando el documento');
    } finally {
      setSaving(false);
    }
  };

  const breadcrumbItems = useMemo(
    () =>
      [
        { title: 'Procesos', href: '/process' },
        { title: 'Gestión Documental', href: '/process/document-management' },
        { title: 'Generador de Documentos', href: '/process/document-management/generador' },
        { title: documentInfo?.code || 'Editar', href: '#' },
      ].map((item, index) =>
        item.href !== '#' ? (
          <Link key={index} href={item.href} passHref>
            <Anchor component="span" size="sm">
              {item.title}
            </Anchor>
          </Link>
        ) : (
          <Text key={index} component="span" size="sm" c="dimmed">
            {item.title}
          </Text>
        )
      ),
    [documentInfo]
  );

  if (loading) {
    return (
      <Group justify="center" mt="xl">
        <Loader />
      </Group>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto py-8 px-4">
        <Alert color="red" title="Editor de documentos">
          {error}
        </Alert>
        <Button
          mt="md"
          variant="default"
          leftSection={<IconArrowBackUp size={16} />}
          onClick={() => router.push('/process/document-management/generador')}
        >
          Volver al Generador
        </Button>
      </div>
    );
  }

  const hasProcess = documentInfo?.id_process != null;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
      <div className="max-w-5xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <Card shadow="sm" p="xl" radius="md" withBorder mb="6">
          <Breadcrumbs separator={<IconChevronRight size={16} />} className="mb-4">
            {breadcrumbItems}
          </Breadcrumbs>

          <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
            <div>
              <Title order={1} className="text-2xl font-bold mb-1 flex items-center gap-3">
                <IconFileDescription size={28} className="text-blue-600" />
                Editar {documentInfo?.code}
              </Title>
              <Text size="sm" c="dimmed">
                {documentInfo?.title} — {documentInfo?.company} — {documentInfo?.documentType}
              </Text>
            </div>
            <Group gap="xs">
              <Badge color="green" variant="light">
                v{versionInfo?.version_number} · {versionInfo?.status}
              </Badge>
              {lastSavedAt && (
                <Badge color="blue" variant="light">
                  Guardado {lastSavedAt.toLocaleTimeString('es-CO')}
                </Badge>
              )}
            </Group>
          </Group>

          <Alert color={hasProcess ? 'orange' : 'blue'} variant="light" mt="md">
            {hasProcess
              ? 'Este documento tiene proceso asociado: al guardar se crea una versión nueva que inicia el flujo de aprobación de 14 estados. La versión vigente actual no cambia hasta que ese flujo la publique.'
              : 'Este documento no tiene proceso asociado: al guardar, el PDF se descarga directo a su equipo. No se modifica OneDrive ni la base de datos.'}
          </Alert>
        </Card>

        {isEditingEmptyTemplate && (
          <Card shadow="sm" p="lg" radius="md" withBorder mb="6">
            <Group gap={6} mb="xs">
              <IconUpload size={18} className="text-blue-600" />
              <Text fw={600}>Subir documento Word (.docx)</Text>
            </Group>
            <Text size="sm" c="dimmed" mb="sm">
              Este documento todavía no tiene contenido cargado. Si ya cuenta con un Word (.docx)
              elaborado previamente, súbalo aquí: se convierte automáticamente a contenido editable
              y queda cargado en el editor de abajo para que continúe trabajando sobre esa
              plantilla.
            </Text>
            <Group align="flex-end" wrap="wrap">
              <FileInput
                placeholder="Seleccione el archivo .docx"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                value={wordFile}
                onChange={setWordFile}
                leftSection={<IconUpload size={16} />}
                disabled={uploadingWord}
                style={{ flex: 1, minWidth: 260 }}
              />
              <Button onClick={handleWordUpload} loading={uploadingWord} disabled={!wordFile}>
                Convertir y cargar
              </Button>
            </Group>
          </Card>
        )}

        <Card shadow="sm" radius="md" withBorder>
          <Group justify="space-between" mb="sm" wrap="wrap">
            <Group gap={4}>
              <ToolbarButton
                label="Negrita"
                icon={<IconBold size={16} />}
                active={editor?.isActive('bold')}
                onClick={() => editor?.chain().focus().toggleBold().run()}
              />
              <ToolbarButton
                label="Cursiva"
                icon={<IconItalic size={16} />}
                active={editor?.isActive('italic')}
                onClick={() => editor?.chain().focus().toggleItalic().run()}
              />
              <Divider orientation="vertical" />
              <ToolbarButton
                label="Título 1"
                icon={<IconH1 size={16} />}
                active={editor?.isActive('heading', { level: 1 })}
                onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
              />
              <ToolbarButton
                label="Título 2"
                icon={<IconH2 size={16} />}
                active={editor?.isActive('heading', { level: 2 })}
                onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
              />
              <ToolbarButton
                label="Título 3"
                icon={<IconH3 size={16} />}
                active={editor?.isActive('heading', { level: 3 })}
                onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
              />
              <Divider orientation="vertical" />
              <ToolbarButton
                label="Lista con viñetas"
                icon={<IconList size={16} />}
                active={editor?.isActive('bulletList')}
                onClick={() => editor?.chain().focus().toggleBulletList().run()}
              />
              <ToolbarButton
                label="Lista numerada"
                icon={<IconListNumbers size={16} />}
                active={editor?.isActive('orderedList')}
                onClick={() => editor?.chain().focus().toggleOrderedList().run()}
              />
              <Divider orientation="vertical" />
              <ToolbarButton
                label="Insertar tabla 3x3"
                icon={<IconTable size={16} />}
                onClick={() =>
                  editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
                }
              />
            </Group>

            <Button
              leftSection={<IconDeviceFloppy size={16} />}
              onClick={handleSave}
              loading={saving}
            >
              Guardar {hasProcess ? '(nueva versión)' : '(descargar PDF)'}
            </Button>
          </Group>

          <Divider mb="md" />

          <div className="tiptap-editor-wrapper">
            <EditorContent editor={editor} />
          </div>
        </Card>

        <Modal
          opened={confirmEmptyOpen}
          onClose={() => setConfirmEmptyOpen(false)}
          title={
            <Group gap={6}>
              <IconAlertTriangle size={18} className="text-orange-500" />
              <Text fw={600}>Documento sin contenido cargado</Text>
            </Group>
          }
          centered
        >
          <Text size="sm" mb="lg">
            Este documento no tiene contenido cargado, está editando una plantilla vacía. ¿Está
            seguro de continuar?
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmEmptyOpen(false)}>
              Cancelar
            </Button>
            <Button
              color="orange"
              onClick={() => {
                setConfirmEmptyOpen(false);
                const html = editor?.getHTML();
                if (html) void doSave(html);
              }}
            >
              Continuar de todas formas
            </Button>
          </Group>
        </Modal>

        <style jsx global>{`
          .tiptap-editor-wrapper .ProseMirror {
            min-height: 500px;
            padding: 24px 32px;
            background: white;
            border: 1px solid var(--mantine-color-gray-3);
            border-radius: 8px;
            outline: none;
            font-size: 14px;
            line-height: 1.6;
            color: #1a1a1a;
          }
          .tiptap-editor-wrapper .ProseMirror h1 {
            font-size: 1.6em;
            font-weight: 700;
            margin: 0 0 0.4em;
          }
          .tiptap-editor-wrapper .ProseMirror h2 {
            font-size: 1.3em;
            font-weight: 700;
            margin: 1em 0 0.4em;
          }
          .tiptap-editor-wrapper .ProseMirror h3 {
            font-size: 1.1em;
            font-weight: 700;
            margin: 0.8em 0 0.4em;
          }
          .tiptap-editor-wrapper .ProseMirror p {
            margin: 0 0 0.6em;
          }
          .tiptap-editor-wrapper .ProseMirror table {
            border-collapse: collapse;
            width: 100%;
            margin: 0.6em 0;
          }
          .tiptap-editor-wrapper .ProseMirror td,
          .tiptap-editor-wrapper .ProseMirror th {
            border: 1px solid #ccc;
            padding: 6px 10px;
            min-width: 60px;
          }
          .tiptap-editor-wrapper .ProseMirror th {
            background: #f2f2f2;
            font-weight: 600;
          }
        `}</style>
      </div>
    </div>
  );
}
