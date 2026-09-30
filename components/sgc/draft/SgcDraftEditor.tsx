'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { ActionIcon, Alert, Anchor, Badge, Breadcrumbs, Button, Card, Code, Divider, FileInput, Group, Loader, Table as MTable, Text, TextInput, Title, Tooltip } from '@mantine/core';
import {
  IconAlertCircle,
  IconArrowLeft,
  IconBold,
  IconCheck,
  IconChevronRight,
  IconDeviceFloppy,
  IconFileDescription,
  IconH1,
  IconH2,
  IconH3,
  IconItalic,
  IconList,
  IconListNumbers,
  IconTable,
  IconUpload,
} from '@tabler/icons-react';
import { sgcSend, useSgcFetch } from '../useSgcFetch';
import { formatDateCO } from '../tareas/format';

/**
 * EDITOR DEL BORRADOR en la app (Sprint 3). Copia adaptada del editor Tiptap
 * del módulo documental anterior (traído del historial de git), en el
 * namespace del SGC: el elaborador parte de la versión VIGENTE (su Word
 * convertido), de un Word que sube o en blanco, y cada «Guardar revisión»
 * crea una revisión NUEVA (control de versiones; nada se sobrescribe). La
 * última revisión es el borrador que se firma y del que sale el PDF
 * controlado. Quien no es el elaborador (o fuera de la elaboración) solo lo
 * consulta.
 */

interface DraftMeta {
  request: { id: number; subject: string; status: string; elaboratorEmail: string; idCompany: number };
  document: { code: string; title: string } | null;
  vigente: { versionNumber: number; hasWord: boolean } | null;
  canEdit: boolean;
  revisions: { id: number; number: number; origin: string; originRef: string | null; sha256: string; sizeBytes: number; note: string | null; savedBy: string; savedAt: string }[];
}

const ORIGIN_LABELS: Record<string, string> = { blanco: 'En blanco', vigente: 'Desde la versión vigente', word: 'Desde un Word', revision: 'Edición' };
const SKELETON = '<h1>Título del documento</h1><h2>1. Objetivo</h2><p>Escriba aquí el objetivo.</p><h2>2. Alcance</h2><p>Escriba aquí el alcance.</p>';

function Tool({ label, icon, active, onClick, disabled }: { label: string; icon: React.ReactNode; active?: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <Tooltip label={label}>
      <ActionIcon variant={active ? 'filled' : 'default'} color={active ? 'blue' : undefined} onClick={onClick} aria-label={label} disabled={disabled}>
        {icon}
      </ActionIcon>
    </Tooltip>
  );
}

export default function SgcDraftEditor({ idRequest }: { idRequest: number }) {
  const search = useSearchParams();
  const viewRev = search.get('ver');
  const meta = useSgcFetch<DraftMeta>(`/api/sgc/requests/${idRequest}/draft`);
  const [origin, setOrigin] = useState<{ origin: string; originRef: string | null }>({ origin: 'revision', originRef: null });
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [wordFile, setWordFile] = useState<File | null>(null);
  const [loaded, setLoaded] = useState<{ number: number | null; sha256: string | null } | null>(null);
  const editable = Boolean(meta.data?.canEdit) && !viewRev;

  const editor = useEditor({ extensions: [StarterKit, Table.configure({ resizable: true }), TableRow, TableHeader, TableCell], content: '', immediatelyRender: false, editable: false });

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  const load = useCallback(async () => {
    if (!editor || !meta.data) return;
    const target = viewRev ?? (meta.data.revisions.length ? 'ultima' : null);
    if (!target) {
      editor.commands.setContent(meta.data.canEdit ? SKELETON : '<p></p>');
      setOrigin({ origin: 'blanco', originRef: null });
      setLoaded({ number: null, sha256: null });
      return;
    }
    const res = await fetch(`/api/sgc/requests/${idRequest}/draft/${target}`, { cache: 'no-store' });
    const body = await res.json();
    if (!res.ok) {
      setMsg({ ok: false, text: body.error || `Error ${res.status}` });
      return;
    }
    editor.commands.setContent(body.html);
    setOrigin({ origin: 'revision', originRef: `revision ${body.number}` });
    setLoaded({ number: body.number, sha256: body.sha256 });
  }, [editor, meta.data, viewRev, idRequest]);

  useEffect(() => {
    void load();
  }, [load]);

  const fromVigente = async () => {
    setMsg(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/sgc/requests/${idRequest}/draft/base`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      editor?.commands.setContent(body.html);
      setOrigin({ origin: 'vigente', originRef: body.originRef });
      setMsg({ ok: true, text: `Se cargó el contenido de ${body.originRef}. Guarde la revisión para conservarlo.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const fromWord = async () => {
    if (!wordFile) return;
    setMsg(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', wordFile);
      const res = await fetch(`/api/sgc/requests/${idRequest}/draft/word`, { method: 'POST', body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      editor?.commands.setContent(body.html);
      setOrigin({ origin: 'word', originRef: body.originRef });
      setWordFile(null);
      setMsg({ ok: true, text: 'Word convertido. Revise el contenido y guarde la revisión.' });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!editor) return;
    setMsg(null);
    setBusy(true);
    try {
      const r = await sgcSend<{ number: number; sha256: string; unchanged: boolean }>(`/api/sgc/requests/${idRequest}/draft`, 'POST', { html: editor.getHTML(), note, ...origin });
      setMsg({ ok: true, text: r.unchanged ? 'Sin cambios frente a la última revisión.' : `Revisión ${r.number} guardada (SHA-256 ${r.sha256.slice(0, 16)}…).` });
      setNote('');
      meta.reload();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  if (meta.loading && !meta.data) {
    return (
      <div className='min-h-screen flex items-center justify-center'>
        <Loader size='sm' />
      </div>
    );
  }
  if (meta.error || !meta.data) {
    return (
      <div className='max-w-5xl mx-auto py-8 px-4'>
        <Alert color='red' icon={<IconAlertCircle size={16} />} title='Error'>
          {meta.error ?? 'No se encontró la solicitud.'}
        </Alert>
      </div>
    );
  }
  const d = meta.data;
  const back = `/process/sgc-documental/solicitudes/${idRequest}?empresa=${d.request.idCompany}`;

  return (
    <div className='app-canvas'>
      <div className='max-w-5xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
        <Card shadow='sm' p='xl' radius='md' withBorder mb='6'>
          <Breadcrumbs separator={<IconChevronRight size={16} />} className='mb-4'>
            <Anchor component={Link} href='/process'>
              Procesos
            </Anchor>
            <Anchor component={Link} href={back}>
              Solicitud #{idRequest}
            </Anchor>
            <Text c='dimmed'>Borrador</Text>
          </Breadcrumbs>
          <Group justify='space-between' align='flex-start'>
            <div>
              <Title order={1} className='text-2xl font-bold mb-1 flex items-center gap-3' data-testid='sgc-borrador-titulo'>
                <IconFileDescription size={28} className='text-blue-6' />
                Borrador · Solicitud #{idRequest}
              </Title>
              <Text size='sm' c='dimmed'>
                {d.document ? `${d.document.code} · ${d.document.title}` : d.request.subject}
              </Text>
            </div>
            <Group gap='xs'>
              {loaded?.number ? (
                <Badge variant='light' data-testid='sgc-borrador-revision'>
                  Revisión {loaded.number}
                </Badge>
              ) : (
                <Badge variant='light' color='gray'>
                  Sin guardar
                </Badge>
              )}
              {!editable && <Badge color='gray'>Solo consulta</Badge>}
            </Group>
          </Group>
          {loaded?.sha256 && (
            <Text size='xs' c='dimmed' mt='xs'>
              SHA-256 de la revisión: <Code>{loaded.sha256}</Code>
            </Text>
          )}
          {msg && (
            <Alert mt='sm' color={msg.ok ? 'green' : 'red'} icon={msg.ok ? <IconCheck size={16} /> : <IconAlertCircle size={16} />} data-testid='sgc-borrador-mensaje'>
              {msg.text}
            </Alert>
          )}
        </Card>

        {editable && (
          <Card shadow='sm' p='lg' radius='md' withBorder mb='6'>
            <Text fw={600} mb='xs'>
              Punto de partida
            </Text>
            <Group align='flex-end' wrap='wrap'>
              {d.vigente?.hasWord && (
                <Button variant='light' onClick={fromVigente} loading={busy} data-testid='sgc-borrador-desde-vigente'>
                  Partir de la versión vigente (V{d.vigente.versionNumber})
                </Button>
              )}
              <FileInput
                placeholder='Importar un Word (.docx)'
                accept='.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                value={wordFile}
                onChange={setWordFile}
                leftSection={<IconUpload size={16} />}
                style={{ flex: 1, minWidth: 240 }}
                data-testid='sgc-borrador-word'
              />
              <Button onClick={fromWord} disabled={!wordFile} loading={busy}>
                Convertir y cargar
              </Button>
            </Group>
          </Card>
        )}

        <Card shadow='sm' radius='md' withBorder>
          {editable && (
            <>
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
                  <TextInput size='sm' placeholder='Nota de la revisión (opcional)' value={note} onChange={(e) => setNote(e.currentTarget.value)} w={260} data-testid='sgc-borrador-nota' />
                  <Button leftSection={<IconDeviceFloppy size={16} />} onClick={save} loading={busy} data-testid='sgc-borrador-guardar'>
                    Guardar revisión
                  </Button>
                </Group>
              </Group>
              <Divider mb='md' />
            </>
          )}
          <div className='sgc-editor-wrapper' data-testid='sgc-borrador-editor'>
            <EditorContent editor={editor} />
          </div>
        </Card>

        <Card shadow='sm' p='lg' radius='md' withBorder mt='6'>
          <Text fw={600} mb='xs'>
            Control de versiones del borrador
          </Text>
          {d.revisions.length === 0 ? (
            <Text size='sm' c='dimmed'>
              Aún no hay revisiones guardadas.
            </Text>
          ) : (
            <MTable withTableBorder striped verticalSpacing='xs'>
              <MTable.Thead>
                <MTable.Tr>
                  <MTable.Th>Revisión</MTable.Th>
                  <MTable.Th>Origen</MTable.Th>
                  <MTable.Th>Guardó</MTable.Th>
                  <MTable.Th>Fecha</MTable.Th>
                  <MTable.Th>Nota</MTable.Th>
                  <MTable.Th>SHA-256</MTable.Th>
                </MTable.Tr>
              </MTable.Thead>
              <MTable.Tbody>
                {d.revisions.map((r) => (
                  <MTable.Tr key={r.id} data-testid='sgc-borrador-fila'>
                    <MTable.Td>
                      <Anchor component={Link} href={`/process/sgc-documental/solicitudes/${idRequest}/borrador?empresa=${d.request.idCompany}&ver=${r.id}`}>
                        {r.number}
                      </Anchor>
                    </MTable.Td>
                    <MTable.Td>{ORIGIN_LABELS[r.origin] ?? r.origin}{r.originRef ? ` · ${r.originRef}` : ''}</MTable.Td>
                    <MTable.Td>{r.savedBy}</MTable.Td>
                    <MTable.Td>{formatDateCO(r.savedAt)}</MTable.Td>
                    <MTable.Td>{r.note ?? ''}</MTable.Td>
                    <MTable.Td>
                      <Code>{r.sha256.slice(0, 16)}…</Code>
                    </MTable.Td>
                  </MTable.Tr>
                ))}
              </MTable.Tbody>
            </MTable>
          )}
          <Group mt='md'>
            <Button component={Link} href={back} variant='outline' leftSection={<IconArrowLeft size={16} />}>
              Volver a la solicitud
            </Button>
          </Group>
        </Card>

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
        `}</style>
      </div>
    </div>
  );
}
