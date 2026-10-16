'use client';

import { useMemo, useRef, useState } from 'react';
import { ActionIcon, Box, Group, Tabs, Text, Textarea, Tooltip } from '@mantine/core';
import { IconBold, IconItalic, IconLink, IconList, IconListNumbers, IconStrikethrough } from '@tabler/icons-react';
import { markdownAHtml } from '../../lib/correo/markdown';
import HtmlSeguro from './HtmlSeguro';

/**
 * Editor de la respuesta con formato sencillo: un cuadro de texto que entiende Markdown
 * (**negrita**, *cursiva*, listas y enlaces) con una barra que inserta las marcas y una
 * pestaña «Vista previa» que muestra el correo tal como saldrá (el mismo conversor y saneado
 * del servidor, dentro del visor aislado). Atajos: Ctrl/⌘+B, Ctrl/⌘+I, Ctrl/⌘+K.
 */
export interface EditorMarkdownProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  testId?: string;
  ariaLabel?: string;
  minRows?: number;
}

type Marca = 'b' | 'i' | 's' | 'ul' | 'ol' | 'link';

export default function EditorMarkdown({ value, onChange, placeholder, disabled, autoFocus, testId, ariaLabel = 'Respuesta', minRows = 5 }: EditorMarkdownProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState<string | null>('escribir');
  const previa = useMemo(() => (tab === 'previa' ? markdownAHtml(value) : ''), [tab, value]);

  const aplicar = (marca: Marca) => {
    const el = ref.current;
    if (!el || disabled) return;
    const ini = el.selectionStart ?? value.length;
    const fin = el.selectionEnd ?? value.length;
    const sel = value.slice(ini, fin);
    let nuevo = value;
    let selIni = ini;
    let selFin = fin;
    if (marca === 'b' || marca === 'i' || marca === 's') {
      const m = marca === 'b' ? '**' : marca === 'i' ? '*' : '~~';
      const txt = sel || (marca === 'b' ? 'texto en negrita' : marca === 'i' ? 'texto en cursiva' : 'texto tachado');
      nuevo = `${value.slice(0, ini)}${m}${txt}${m}${value.slice(fin)}`;
      selIni = ini + m.length;
      selFin = selIni + txt.length;
    } else if (marca === 'link') {
      const txt = sel || 'texto del enlace';
      const url = 'https://';
      nuevo = `${value.slice(0, ini)}[${txt}](${url})${value.slice(fin)}`;
      selIni = ini + txt.length + 3;
      selFin = selIni + url.length;
    } else {
      // Listas: se marca cada línea seleccionada (o la actual).
      const lIni = value.lastIndexOf('\n', ini - 1) + 1;
      const finLinea = value.indexOf('\n', fin);
      const lFin = finLinea === -1 ? value.length : finLinea;
      const lineas = value.slice(lIni, lFin).split('\n');
      const hecho = lineas.map((l, i) => `${marca === 'ul' ? '- ' : `${i + 1}. `}${l.replace(/^\s*(?:[-*+]|\d{1,3}[.)])\s+/, '')}`).join('\n');
      nuevo = `${value.slice(0, lIni)}${hecho}${value.slice(lFin)}`;
      selIni = lIni;
      selFin = selIni + hecho.length;
    }
    onChange(nuevo);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(selIni, selFin);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    const marca: Marca | null = k === 'b' ? 'b' : k === 'i' ? 'i' : k === 'k' ? 'link' : null;
    if (marca) {
      e.preventDefault();
      aplicar(marca);
    }
  };

  const boton = (marca: Marca, etiqueta: string, icono: React.ReactNode) => (
    <Tooltip label={etiqueta} withArrow openDelay={300}>
      <ActionIcon variant='subtle' color='gray' size='md' onClick={() => aplicar(marca)} disabled={disabled || tab !== 'escribir'} aria-label={etiqueta} data-testid={`correo-md-${marca}`}>
        {icono}
      </ActionIcon>
    </Tooltip>
  );

  return (
    <Box data-testid={testId ? `${testId}-editor` : undefined}>
      <Tabs value={tab} onChange={setTab} variant='outline' radius='md' keepMounted>
        <Group justify='space-between' wrap='nowrap' gap={4} style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
          <Tabs.List style={{ borderBottom: 0, flexWrap: 'nowrap' }}>
            <Tabs.Tab value='escribir' data-testid='correo-md-tab-escribir'>
              Escribir
            </Tabs.Tab>
            <Tabs.Tab value='previa' data-testid='correo-md-tab-previa'>
              Vista previa
            </Tabs.Tab>
          </Tabs.List>
          <Group gap={0} wrap='nowrap' role='toolbar' aria-label='Formato del texto' style={{ overflowX: 'auto' }}>
            {boton('b', 'Negrita (Ctrl+B)', <IconBold size={16} />)}
            {boton('i', 'Cursiva (Ctrl+I)', <IconItalic size={16} />)}
            {boton('s', 'Tachado', <IconStrikethrough size={16} />)}
            {boton('ul', 'Lista con viñetas', <IconList size={16} />)}
            {boton('ol', 'Lista numerada', <IconListNumbers size={16} />)}
            {boton('link', 'Enlace (Ctrl+K)', <IconLink size={16} />)}
          </Group>
        </Group>
        <Tabs.Panel value='escribir' pt='xs'>
          <Textarea
            ref={ref}
            placeholder={placeholder}
            autosize
            minRows={minRows}
            maxRows={16}
            value={value}
            onChange={(e) => onChange(e.currentTarget.value)}
            onKeyDown={onKeyDown}
            disabled={disabled}
            autoFocus={autoFocus}
            aria-label={ariaLabel}
            variant='unstyled'
            styles={{ input: { fontSize: 14, lineHeight: 1.5, paddingInline: 4 } }}
            data-testid={testId}
          />
        </Tabs.Panel>
        <Tabs.Panel value='previa' pt='xs'>
          <Box data-testid='correo-md-previa' mih={80}>
            {previa ? (
              <HtmlSeguro html={previa} remotas={false} titulo='Vista previa de la respuesta' />
            ) : (
              <Text size='sm' c='dimmed' p='xs'>
                Nada que mostrar todavía.
              </Text>
            )}
          </Box>
        </Tabs.Panel>
      </Tabs>
      <Text size='xs' c='dimmed' mt={4}>
        Formato: **negrita**, *cursiva*, «- » para listas y [texto](https://…) para enlaces.
      </Text>
    </Box>
  );
}
