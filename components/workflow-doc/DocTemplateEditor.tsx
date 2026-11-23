'use client';

import { useEffect, useRef } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import Mention from '@tiptap/extension-mention';
import { ActionIcon, Group, Paper, Tooltip } from '@mantine/core';
import { IconBold, IconH2, IconH3, IconItalic, IconList, IconListNumbers, IconTable } from '@tabler/icons-react';
import { HTML_TOKEN_RE, escapeHtml, type DocMarker } from '../../lib/workflow-doc/fields';

/**
 * Editor TipTap de la tarea «Plantilla de documento» (mismas extensiones base que el editor de
 * borradores del SGC + menciones). Escribiendo «@» aparece la lista de campos del proceso y
 * variables del sistema; cada marca queda como <span data-field="clave">@Etiqueta</span>.
 * El servidor la guarda como «{{CAMPO_FLUJO:clave}}».
 */

/** Tokens guardados → menciones del editor (con la etiqueta vigente del campo). */
export function tokensToMentions(html: string, markers: readonly DocMarker[]): string {
  const labels = new Map(markers.map((m) => [m.key, m.label]));
  return String(html ?? '').replace(HTML_TOKEN_RE, (_, rawKey: string) => {
    const key = rawKey.toLowerCase();
    const label = escapeHtml(labels.get(key) ?? key);
    return `<span data-type="mention" data-id="${key}" data-label="${label}" data-field="${key}">@${label}</span>`;
  });
}

type SuggestionProps = {
  items: DocMarker[];
  command: (attrs: { id: string; label: string }) => void;
  clientRect?: (() => DOMRect | null) | null;
};

/** Lista flotante de sugerencias (DOM simple, sin dependencias extra). */
function suggestionRenderer() {
  let el: HTMLDivElement | null = null;
  let props: SuggestionProps | null = null;
  let selected = 0;

  const draw = () => {
    if (!el || !props) return;
    el.innerHTML = '';
    if (!props.items.length) {
      const empty = document.createElement('div');
      empty.textContent = 'Sin campos que coincidan';
      empty.style.cssText = 'padding:6px 10px;color:#868e96;font-size:13px;';
      el.appendChild(empty);
    }
    props.items.forEach((item, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `${item.label}${item.kind === 'system' ? ' · sistema' : ''}`;
      b.style.cssText = `display:block;width:100%;text-align:left;border:0;padding:6px 10px;font-size:13px;cursor:pointer;background:${
        i === selected ? 'var(--mantine-color-violet-light, #f3f0ff)' : 'transparent'
      };color:inherit;`;
      b.onmousedown = (e) => {
        e.preventDefault();
        props?.command({ id: item.key, label: item.label });
      };
      el!.appendChild(b);
    });
    const rect = props.clientRect?.();
    if (rect) {
      el.style.left = `${rect.left + window.scrollX}px`;
      el.style.top = `${rect.bottom + window.scrollY + 4}px`;
    }
  };

  return {
    onStart: (p: SuggestionProps) => {
      props = p;
      selected = 0;
      el = document.createElement('div');
      el.style.cssText =
        'position:absolute;z-index:10000;min-width:220px;max-height:260px;overflow:auto;background:var(--mantine-color-body, #fff);border:1px solid var(--mantine-color-default-border, #dee2e6);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);padding:4px 0;';
      document.body.appendChild(el);
      draw();
    },
    onUpdate: (p: SuggestionProps) => {
      props = p;
      selected = Math.min(selected, Math.max(0, p.items.length - 1));
      draw();
    },
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (!props) return false;
      if (event.key === 'ArrowDown') {
        selected = (selected + 1) % Math.max(1, props.items.length);
        draw();
        return true;
      }
      if (event.key === 'ArrowUp') {
        selected = (selected - 1 + props.items.length) % Math.max(1, props.items.length);
        draw();
        return true;
      }
      if (event.key === 'Enter') {
        const item = props.items[selected];
        if (item) props.command({ id: item.key, label: item.label });
        return true;
      }
      if (event.key === 'Escape') {
        el?.remove();
        el = null;
        return true;
      }
      return false;
    },
    onExit: () => {
      el?.remove();
      el = null;
      props = null;
    },
  };
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function DocTemplateEditor({
  initialHtml,
  markers,
  onChange,
  withMentions = true,
  minHeight = 320,
}: {
  initialHtml: string;
  markers: readonly DocMarker[];
  onChange: (html: string) => void;
  withMentions?: boolean;
  minHeight?: number;
}) {
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      ...(withMentions
        ? [
            Mention.configure({
              HTMLAttributes: { class: 'doc-mention' },
              renderHTML: ({ node }) => [
                'span',
                {
                  'data-type': 'mention',
                  'data-id': node.attrs.id,
                  'data-label': node.attrs.label,
                  'data-field': node.attrs.id,
                  style: 'background:var(--mantine-color-violet-light, #f3f0ff);color:var(--mantine-color-violet-filled, #7048e8);border-radius:4px;padding:0 3px;',
                },
                `@${node.attrs.label ?? node.attrs.id}`,
              ],
              renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
              suggestion: {
                char: '@',
                items: ({ query }: { query: string }) => {
                  const q = normalize(query);
                  return markersRef.current.filter((m) => normalize(m.label).includes(q)).slice(0, 12);
                },
                render: suggestionRenderer as never,
              },
            }),
          ]
        : []),
    ],
    content: withMentions ? tokensToMentions(initialHtml, markers) : initialHtml,
    onUpdate: ({ editor: e }) => onChangeRef.current(e.getHTML()),
  });

  // Contenido nuevo (otro Word u otro documento del SGC): se reemplaza.
  useEffect(() => {
    if (!editor) return;
    const next = withMentions ? tokensToMentions(initialHtml, markersRef.current) : initialHtml;
    if (next !== editor.getHTML()) editor.commands.setContent(next);
  }, [editor, initialHtml]);

  return (
    <Paper withBorder radius='md' p='xs'>
      <Toolbar editor={editor} />
      <div className='doc-template-editor' style={{ minHeight, padding: '8px 12px' }}>
        <EditorContent editor={editor} />
      </div>
    </Paper>
  );
}

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null;
  const btn = (label: string, icon: React.ReactNode, run: () => void, active = false) => (
    <Tooltip label={label} withArrow>
      <ActionIcon variant={active ? 'filled' : 'subtle'} color='violet' onClick={run} aria-label={label}>
        {icon}
      </ActionIcon>
    </Tooltip>
  );
  return (
    <Group gap={4} pb='xs' style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
      {btn('Negrita', <IconBold size={16} />, () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'))}
      {btn('Cursiva', <IconItalic size={16} />, () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'))}
      {btn('Título', <IconH2 size={16} />, () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive('heading', { level: 2 }))}
      {btn('Subtítulo', <IconH3 size={16} />, () => editor.chain().focus().toggleHeading({ level: 3 }).run(), editor.isActive('heading', { level: 3 }))}
      {btn('Lista', <IconList size={16} />, () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'))}
      {btn('Lista numerada', <IconListNumbers size={16} />, () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'))}
      {btn('Tabla', <IconTable size={16} />, () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
    </Group>
  );
}
