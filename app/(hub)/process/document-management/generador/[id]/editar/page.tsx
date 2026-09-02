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
  Group,
  Loader,
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
} from '@tabler/icons-react';
import toast from 'react-hot-toast';

/**
 * Sprint 8 — Editor de documentos (Tiptap) dentro de SynerLink.
 *
 * MVP genérico (sin plantillas por tipo de documento -- fuera de alcance):
 * el usuario edita texto enriquecido (títulos, párrafos, listas, tabla
 * simple) sobre la versión VIGENTE del documento. "Guardar y generar PDF"
 * persiste el HTML y sube un PDF real a OneDrive vía Chrome headless
 * (ver app/api/document-management/documents/[id]/editor/route.ts).
 *
 * Arranca con un esqueleto básico (título + sección + párrafo) cuando la
 * versión nunca se editó desde aquí (`content_html` viene null) -- NO
 * intenta convertir el DOCX/PDF ya subido, eso queda fuera de alcance.
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
}

interface EditorVersion {
  id_document_version: number;
  version_number: number;
  status: string;
  content_html: string | null;
  onedrive_item_id: string | null;
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
    if (!idDocument) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idDocument]);

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

  const handleSave = async () => {
    if (!editor) return;
    const html = editor.getHTML();
    if (!html || html === '<p></p>') {
      toast.error('El documento no puede quedar vacío.');
      return;
    }
    try {
      setSaving(true);
      const res = await fetch(`/api/document-management/documents/${idDocument}/editor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_html: html }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo guardar');

      setVersionInfo((prev) => (prev ? { ...prev, onedrive_item_id: data.version.onedrive_item_id } : prev));
      setLastSavedAt(new Date());
      toast.success('Guardado — PDF generado y subido a OneDrive.');
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
        </Card>

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
              Guardar y generar PDF
            </Button>
          </Group>

          <Divider mb="md" />

          <div className="tiptap-editor-wrapper">
            <EditorContent editor={editor} />
          </div>
        </Card>

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
