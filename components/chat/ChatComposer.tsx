'use client';

import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import {
  ActionIcon,
  Box,
  Group,
  Menu,
  Popover,
  ScrollArea,
  Text,
  Textarea,
  Tooltip,
} from '@mantine/core';
import {
  IconBold,
  IconCode,
  IconEye,
  IconEyeOff,
  IconItalic,
  IconList,
  IconMoodSmile,
  IconPaperclip,
  IconSend,
  IconX,
} from '@tabler/icons-react';
import ChatMarkdown from './ChatMarkdown';
import { MAX_USER_MESSAGE_CHARS } from '../../lib/chat/constants';
import {
  MAX_CHAT_ATTACHMENTS_PER_MESSAGE,
  formatBytes,
  getChatAttachmentError,
} from '../../lib/chat/attachments';

/**
 * Entrada de texto del chat — v1: Markdown CRUDO con ayudas.
 *
 * DISPOSICIÓN: una sola fila, como WhatsApp — emoji · caja · clip · ⋯ · enviar.
 * Antes eran tres filas apiladas (barra de siete botones, caja de dos renglones
 * mínimos y el renglón del recordatorio con el botón de enviar): unos 155 px que
 * le quitaba a la conversación. Ahora son ~55 px, unos tres renglones más de
 * texto en pantalla. Lo secundario —formato y vista previa— vive en el menú ⋯,
 * y los atajos Ctrl+B / Ctrl+I siguen funcionando aunque el botón no esté
 * a la vista.
 *
 * Es lo que hacen Slack y GitHub: el usuario escribe Markdown y unos botones
 * envuelven la selección por él. Un editor visual completo (WYSIWYG) exigiría
 * ProseMirror/TipTap — una decena de dependencias y varios días — y no cambia
 * lo que llega a la base, que es Markdown de todas formas. Queda para v2.
 *
 * Los adjuntos se validan aquí con LA MISMA función del servidor
 * (getChatAttachmentError, lib/chat/attachments.ts) para que el usuario vea el
 * problema antes de subir 20 MB por nada. Es comodidad, no seguridad: la
 * validación que manda es la de la API, que vuelve a correr exactamente esa
 * misma comprobación.
 *
 * El selector de emojis es una rejilla propia con una selección curada: las
 * librerías de emojis pesan cientos de kilobytes (traen catálogo completo,
 * índice de búsqueda y a veces sprites remotos) para un botón secundario.
 * Además, el sistema operativo ya trae su propio selector.
 */

/** Emojis frecuentes en conversación de trabajo, agrupados por intención. */
const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: 'Frecuentes',
    emojis: ['👍', '🙏', '✅', '❌', '⚠️', '📌', '🔧', '📊', '🚀', '🔥', '⏰', '📎'],
  },
  {
    label: 'Caras',
    emojis: ['🙂', '😀', '😅', '😉', '😍', '🤔', '😐', '😴', '😬', '😊', '🥳', '😎'],
  },
  {
    label: 'Trabajo',
    emojis: ['📁', '📄', '📥', '📤', '💡', '🧾', '🗓️', '🔍', '🖥️', '🛠️', '📈', '📉'],
  },
  {
    label: 'Señales',
    emojis: ['🟢', '🟡', '🔴', '⭐', '❗', '❓', '➡️', '⬅️', '🔁', '🔒', '🔓', '💬'],
  },
];

type WrapKind = 'bold' | 'italic' | 'code' | 'list';

/**
 * Le pone un nombre útil a lo que llega sin él.
 *
 * Una captura pegada del portapapeles llega SIEMPRE como "image.png": los
 * navegadores no le dan otro nombre. Si se dejara así, dos capturas del mismo
 * tamaño se verían como el mismo archivo y la regla de duplicados de
 * `addFiles` se comería la segunda. Se renombra con la fecha y la hora.
 *
 * Lo que ya viene con nombre propio (el clip, un archivo arrastrado) se
 * devuelve intacto.
 */
function conNombreUtil(file: File, index: number): File {
  const generico = !file.name || /^image\.[a-z0-9]+$/i.test(file.name);
  if (!generico) return file;

  const sello = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  const ext = (file.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '');
  const sufijo = index > 0 ? `-${index + 1}` : '';
  return new File([file], `captura-${sello}${sufijo}.${ext}`, {
    type: file.type,
    lastModified: file.lastModified,
  });
}

/** Lo que el hilo puede pedirle al compositor desde afuera. */
export type ChatComposerHandle = {
  /** Agrega archivos a la bandeja del mensaje, con la misma validación del clip. */
  addFiles: (incoming: FileList | File[] | null) => void;
};

const ChatComposer = forwardRef<ChatComposerHandle, {
  /** Devuelve lo que quiera (p. ej. si el envío tuvo éxito); aquí solo se espera. */
  onSend: (body: string, files: File[]) => void | Promise<unknown>;
  disabled?: boolean;
  sending?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}>(function ChatComposer(
  {
    onSend,
    disabled = false,
    sending = false,
    placeholder = 'Escriba su mensaje… (Markdown: **negrita**, _cursiva_, - viñetas)',
    autoFocus = false,
  },
  ref
) {
  const [value, setValue] = useState('');
  const [preview, setPreview] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tooLong = value.length > MAX_USER_MESSAGE_CHARS;
  // Con adjuntos el texto puede ir vacío (mandar solo un archivo es válido);
  // lo que no se puede enviar es un mensaje sin texto Y sin archivos.
  const canSend = (value.trim().length > 0 || files.length > 0) && !disabled && !sending && !tooLong;

  /**
   * Agrega lo que el usuario escogió, validando cada archivo y el tope.
   * Acepta un `FileList` (el input de archivos) o un arreglo de `File` (lo que
   * entrega un arrastrar-y-soltar), para que las dos vías compartan la misma
   * validación y el mismo tope por mensaje.
   */
  const addFiles = useCallback(
    (incoming: FileList | File[] | null) => {
      if (!incoming || incoming.length === 0) return;

      const accepted: File[] = [];
      let problem: string | null = null;

      for (const file of Array.from(incoming).map(conNombreUtil)) {
        const error = getChatAttachmentError({ name: file.name, size: file.size });
        if (error) {
          problem = error;
          continue;
        }
        accepted.push(file);
      }

      setFiles((prev) => {
        const merged = [...prev];
        for (const file of accepted) {
          // Mismo nombre y mismo tamaño = el usuario lo escogió dos veces.
          if (merged.some((x) => x.name === file.name && x.size === file.size)) continue;
          if (merged.length >= MAX_CHAT_ATTACHMENTS_PER_MESSAGE) break;
          merged.push(file);
        }
        return merged;
      });

      if (!problem && files.length + accepted.length > MAX_CHAT_ATTACHMENTS_PER_MESSAGE) {
        problem = `Puede adjuntar máximo ${MAX_CHAT_ATTACHMENTS_PER_MESSAGE} archivos por mensaje.`;
      }
      setFileError(problem);
    },
    [files.length]
  );

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setFileError(null);
  }, []);

  // El arrastrar-y-soltar vive en el hilo (para poder soltar sobre toda la
  // conversación, no solo sobre la caja de texto), pero los archivos y su
  // validación viven aquí. Esta es la única puerta entre los dos.
  useImperativeHandle(ref, () => ({ addFiles }), [addFiles]);

  /**
   * Pegar una imagen del portapapeles (Ctrl+V / Cmd+V) — el caso de todos los
   * días: uno toma una captura y la pega en el chat.
   *
   * Solo se intercepta cuando de verdad viene un archivo; pegar texto sigue
   * funcionando igual. El nombre se lo pone `conNombreUtil`, porque el
   * portapapeles entrega las capturas como "image.png".
   */
  const onPaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (disabled) return;
      const pegados = Array.from(event.clipboardData?.files ?? []);
      if (pegados.length === 0) return;
      event.preventDefault();
      addFiles(pegados);
    },
    [addFiles, disabled]
  );

  /**
   * Envuelve la selección (o inserta el marcador donde esté el cursor) y deja
   * el foco listo para seguir escribiendo, con la selección conservada. Sin
   * esto, cada clic en un botón obligaría a volver a ubicarse a mano.
   */
  const applyFormat = useCallback((kind: WrapKind) => {
    const el = textareaRef.current;
    if (!el) return;

    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const selected = value.slice(start, end);

    let next: string;
    let cursorStart: number;
    let cursorEnd: number;

    if (kind === 'list') {
      // Las viñetas van por línea, no envolviendo.
      const block = selected || 'elemento';
      const bulleted = block
        .split('\n')
        .map((line) => (line.trim().startsWith('- ') ? line : `- ${line}`))
        .join('\n');
      const prefix = start === 0 || value[start - 1] === '\n' ? '' : '\n';
      next = value.slice(0, start) + prefix + bulleted + value.slice(end);
      cursorStart = start + prefix.length;
      cursorEnd = cursorStart + bulleted.length;
    } else {
      const marker = kind === 'bold' ? '**' : kind === 'italic' ? '_' : '`';
      const inner = selected || (kind === 'bold' ? 'negrita' : kind === 'italic' ? 'cursiva' : 'código');
      next = value.slice(0, start) + marker + inner + marker + value.slice(end);
      cursorStart = start + marker.length;
      cursorEnd = cursorStart + inner.length;
    }

    setValue(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursorStart, cursorEnd);
    });
  }, [value]);

  const insertEmoji = useCallback((emoji: string) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + emoji + value.slice(end);
    setValue(next);
    setEmojiOpen(false);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + emoji.length;
      el?.setSelectionRange(pos, pos);
    });
  }, [value]);

  const submit = useCallback(async () => {
    if (!canSend) return;
    const body = value.trim();
    const attachments = files;
    setValue('');
    setFiles([]);
    setFileError(null);
    setPreview(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    // El foco vuelve a la caja ANTES de esperar el envío: en el celular, si el
    // textarea pierde el foco (por ejemplo al tocar el botón de enviar) el
    // teclado se cierra y hay que volver a tocarlo para escribir el mensaje
    // siguiente. Conversar así es incómodo.
    textareaRef.current?.focus();
    await onSend(body, attachments);
    textareaRef.current?.focus();
  }, [canSend, files, onSend, value]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter envía; Shift+Enter hace salto de línea (convención universal).
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        void submit();
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === 'b') {
          event.preventDefault();
          applyFormat('bold');
        } else if (key === 'i') {
          event.preventDefault();
          applyFormat('italic');
        }
      }
    },
    [applyFormat, submit]
  );

  return (
    <Box className='chat-composer'>
      {files.length > 0 && (
        <Group gap={6} mb={6} wrap='wrap'>
          {files.map((file, index) => (
            <div
              key={`${file.name}-${file.size}-${index}`}
              className='chat-attachment chat-attachment--draft'
            >
              <IconPaperclip size={13} />
              <Text size='xs' lineClamp={1} className='chat-attachment__name'>
                {file.name}
              </Text>
              <Text size='xs' className='chat-attachment__size'>
                {formatBytes(file.size)}
              </Text>
              <ActionIcon
                size='xs'
                variant='subtle'
                color='gray'
                onClick={() => removeFile(index)}
                aria-label={`Quitar ${file.name}`}
              >
                <IconX size={12} />
              </ActionIcon>
            </div>
          ))}
        </Group>
      )}

      {fileError && (
        <Text size='xs' c='red' mb={4}>
          {fileError}
        </Text>
      )}

      {/* El contador solo aparece cerca del tope; el resto del tiempo no ocupa
          renglón, que es justamente lo que se buscaba. */}
      {value.length > MAX_USER_MESSAGE_CHARS * 0.8 && (
        <Text size='xs' c={tooLong ? 'red' : 'dimmed'} ta='right' mb={4}>
          {value.length.toLocaleString('es-CO')} / {MAX_USER_MESSAGE_CHARS.toLocaleString('es-CO')}
        </Text>
      )}

      <Group gap={2} align='flex-end' wrap='nowrap'>
        <Popover opened={emojiOpen} onChange={setEmojiOpen} position='top-start' withArrow shadow='md' width={260}>
          <Popover.Target>
            <Tooltip label='Emojis' withArrow>
              <ActionIcon
                variant='subtle'
                color='gray'
                size={34}
                radius='xl'
                disabled={disabled}
                onClick={() => setEmojiOpen((o) => !o)}
                aria-label='Insertar emoji'
              >
                <IconMoodSmile size={18} />
              </ActionIcon>
            </Tooltip>
          </Popover.Target>
          <Popover.Dropdown p='xs' className='chat-surface'>
            <ScrollArea.Autosize mah={220}>
              {EMOJI_GROUPS.map((group) => (
                <Box key={group.label} mb={6}>
                  <Text size='xs' c='dimmed' mb={2}>
                    {group.label}
                  </Text>
                  <Group gap={2}>
                    {group.emojis.map((emoji) => (
                      <ActionIcon
                        key={emoji}
                        variant='subtle'
                        color='gray'
                        size='md'
                        onClick={() => insertEmoji(emoji)}
                        aria-label={`Insertar ${emoji}`}
                      >
                        <span style={{ fontSize: 16, lineHeight: 1 }}>{emoji}</span>
                      </ActionIcon>
                    ))}
                  </Group>
                </Box>
              ))}
            </ScrollArea.Autosize>
          </Popover.Dropdown>
        </Popover>

        {preview ? (
          <Box
            className='chat-composer__preview'
            style={{ flex: 1, minWidth: 0 }}
            onDoubleClick={() => setPreview(false)}
          >
            <ChatMarkdown content={value} />
          </Box>
        ) : (
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={placeholder}
            autosize
            /* Arranca en UN renglón, como WhatsApp, y crece al escribir. */
            minRows={1}
            maxRows={6}
            disabled={disabled}
            autoFocus={autoFocus}
            error={tooLong ? 'El mensaje es demasiado largo.' : undefined}
            style={{ flex: 1, minWidth: 0 }}
            classNames={{ input: 'chat-composer__input' }}
          />
        )}

        {/* UN SOLO botón secundario, como WhatsApp: el clip abre todo.
            Antes eran dos (clip y ⋯) y Nicolás lo pidió explícito: "solo hay
            un botón de clip y ese sí muestra todo". Adjuntar queda de primero
            porque es lo que la gente viene a buscar cuando toca un clip. */}
        <Menu position='top-end' withArrow shadow='md' width={225}>
          <Menu.Target>
            <ActionIcon
              variant='subtle'
              color='gray'
              size={34}
              radius='xl'
              disabled={disabled}
              aria-label='Adjuntar y más opciones'
              title='Adjuntar y más opciones'
            >
              <IconPaperclip size={19} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown className='chat-surface'>
            <Menu.Item
              leftSection={<IconPaperclip size={14} />}
              onClick={() => fileInputRef.current?.click()}
              disabled={files.length >= MAX_CHAT_ATTACHMENTS_PER_MESSAGE}
            >
              Adjuntar archivos
            </Menu.Item>
            <Menu.Divider />
            <Menu.Label>Formato</Menu.Label>
            <Menu.Item
              leftSection={<IconBold size={14} />}
              rightSection={
                <Text size='xs' c='dimmed'>
                  Ctrl+B
                </Text>
              }
              onClick={() => applyFormat('bold')}
            >
              Negrita
            </Menu.Item>
            <Menu.Item
              leftSection={<IconItalic size={14} />}
              rightSection={
                <Text size='xs' c='dimmed'>
                  Ctrl+I
                </Text>
              }
              onClick={() => applyFormat('italic')}
            >
              Cursiva
            </Menu.Item>
            <Menu.Item leftSection={<IconList size={14} />} onClick={() => applyFormat('list')}>
              Lista
            </Menu.Item>
            <Menu.Item leftSection={<IconCode size={14} />} onClick={() => applyFormat('code')}>
              Código
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item
              leftSection={preview ? <IconEyeOff size={14} /> : <IconEye size={14} />}
              onClick={() => setPreview((p) => !p)}
              disabled={value.trim().length === 0}
            >
              {preview ? 'Volver a editar' : 'Vista previa'}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>

        {/* El recordatorio de Enter / Shift+Enter era un renglón entero; ahora
            vive en el globo de este botón. */}
        {/* Grande a propósito (46 px contra los 34 de los secundarios): es la
            acción principal y en el celular se toca con el pulgar. Es el
            círculo verde de WhatsApp. */}
        <Tooltip label='Enviar · Enter envía, Shift+Enter salta de línea' withArrow>
          <ActionIcon
            size={46}
            radius='xl'
            variant='filled'
            color='blue'
            loading={sending}
            disabled={!canSend}
            // Sin esto, TOCAR el botón le quita el foco al textarea y el teclado
            // del celular se cierra antes de que el mensaje salga. El
            // preventDefault del mousedown/touchstart evita ese robo de foco.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void submit()}
            aria-label='Enviar mensaje'
          >
            <IconSend size={20} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <input
        ref={fileInputRef}
        type='file'
        multiple
        hidden
        onChange={(event) => {
          addFiles(event.currentTarget.files);
          // Se limpia para que escoger DOS VECES el mismo archivo vuelva a
          // disparar el onChange.
          event.currentTarget.value = '';
        }}
      />
    </Box>
  );
});

export default ChatComposer;
