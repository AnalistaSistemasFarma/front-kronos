'use client';

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useMediaQuery } from '@mantine/hooks';
import {
  ActionIcon,
  Box,
  Group,
  Menu,
  Popover,
  Text,
  Textarea,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconAt,
  IconBlockquote,
  IconBold,
  IconCode,
  IconEye,
  IconEyeOff,
  IconItalic,
  IconKeyboard,
  IconLink,
  IconList,
  IconListNumbers,
  IconMoodSmile,
  IconPaperclip,
  IconPlus,
  IconSend,
  IconStrikethrough,
  IconTypography,
  IconX,
} from '@tabler/icons-react';
import AgentAvatar from './AgentAvatar';
import ChatMarkdown from './ChatMarkdown';
import ComposerLetterFx from './ComposerLetterFx';
import { MAX_USER_MESSAGE_CHARS } from '../../lib/chat/constants';
import {
  MAX_CHAT_ATTACHMENTS_PER_MESSAGE,
  formatBytes,
  getChatAttachmentError,
} from '../../lib/chat/attachments';
import { MAX_UPLOAD_REQUEST_BYTES } from '../../lib/attachments/uploadRules';
import ChatVoice from './ChatVoice';
import ChatExpresiones from './ChatExpresiones';
import ChatMisStickers from './ChatMisStickers';
import type { MediaParaEnviar } from './useChatConversation';
import type { ChatReplyToDto } from '../../lib/chat/client';

/**
 * Tope de caracteres para la animación de letras (ComposerLetterFx). Mensajes
 * más largos que esto se ven y se comportan como siempre, sin la capa
 * decorativa — no vale la pena mantener cientos de `<span>` animados para un
 * mensaje largo que casi siempre es un pegado, no algo tecleado letra a letra.
 */
const LETTERFX_MAX_CHARS = 600;

/**
 * Entrada de texto del chat — v1: Markdown CRUDO con ayudas.
 *
 * DISPOSICIÓN: una sola fila, como WhatsApp — caja (con el clip adentro) y el
 * botón de enviar al lado. El panel de emojis se quitó el 2026-09-09: el
 * teclado del sistema ya trae los suyos y ese botón solo robaba ancho.
 * Volvió el 2026-10-20, ya como en Telegram y WhatsApp: un botón al lado del
 * clip que abre Emoji | Stickers | GIF (ChatExpresiones), pedido de Nicolás.
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
 * YA NO HAY SELECTOR DE EMOJIS. Tenía una rejilla propia con una selección
 * curada —las librerías pesan cientos de kilobytes para un botón secundario—,
 * pero se quitó el 2026-09-09: el teclado del sistema ya trae los suyos, y en
 * el celular ese botón se comía ancho que le hacía falta a la caja de texto.
 */

/**
 * BORRADOR del mensaje (pedido de Nicolás, 2026-10-01): lo que se va
 * escribiendo se guarda en `localStorage` por persona y por conversación, así
 * no se pierde al cambiar de chat, salir del chat o redimensionar la ventana
 * (al cruzar el corte de celular/escritorio el compositor se desmonta y se
 * vuelve a montar). Se borra al enviar. Con try/catch: en modo privado o con
 * el almacenamiento bloqueado simplemente no hay borrador.
 */
const PREFIJO_BORRADOR = 'chat-borrador:';

function leerBorrador(clave: string | null): string {
  if (!clave) return '';
  try {
    return window.localStorage.getItem(PREFIJO_BORRADOR + clave) ?? '';
  } catch {
    return '';
  }
}

function guardarBorrador(clave: string | null, valor: string) {
  if (!clave) return;
  try {
    if (valor) window.localStorage.setItem(PREFIJO_BORRADOR + clave, valor);
    else window.localStorage.removeItem(PREFIJO_BORRADOR + clave);
  } catch {
    // Sin almacenamiento: no hay borrador, el chat funciona igual.
  }
}

// 2026-10-21: tachado, lista numerada, cita y enlace para la barra de formato
// estilo Teams. Todo es Markdown que ChatMarkdown ya pinta (del, ol,
// blockquote, a): ni subrayado, ni color, ni tamaño, que el Markdown no tiene
// y que los agentes, la bandeja y las notificaciones verían como marcas sueltas.
type WrapKind = 'bold' | 'italic' | 'code' | 'list' | 'strike' | 'olist' | 'quote' | 'link';

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
  /** Pone el cursor en la caja. Lo usa el hilo al citar un mensaje: citar y
   *  tener que tocar la caja aparte sobraría. */
  focus: () => void;
};

/** Un candidato del autocompletado del `@` (los asistentes de un grupo). */
export interface MencionCandidato {
  /** Lo que se inserta después de la arroba. */
  valor: string;
  /** Cómo se muestra en la lista. */
  nombre: string;
  avatarUrl: string | null;
}

const ChatComposer = forwardRef<ChatComposerHandle, {
  /** Devuelve lo que quiera (p. ej. si el envío tuvo éxito); aquí solo se espera. */
  onSend: (body: string, files: File[]) => void | Promise<unknown>;
  disabled?: boolean;
  sending?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /**
   * A quién se puede mencionar con `@`. Vacío (lo normal en un hilo directo)
   * apaga el autocompletado por completo.
   */
  menciones?: MencionCandidato[];
  /**
   * Mensaje que se está CITANDO. Se pinta como una tarjeta encima de la caja,
   * con el autor y un extracto, igual que en WhatsApp y Telegram. Quién la
   * manda es el hilo: el compositor solo la muestra y ofrece quitarla.
   */
  cita?: ChatReplyToDto | null;
  onQuitarCita?: () => void;
  voiceConversationId?: number;
  /**
   * Clave del borrador (persona + conversación). Sin clave no se guarda nada.
   */
  draftKey?: string | null;
  /**
   * Envía un sticker o un GIF (2026-10-20). Con esto aparece el botón de
   * emoji/stickers/GIF AL LADO del clip (ChatExpresiones). Sin esto (p. ej. un
   * proyecto de solo lectura) el botón no aparece.
   */
  onEnviarMedia?: (media: MediaParaEnviar) => void;
}>(function ChatComposer(
  {
    onSend,
    disabled = false,
    sending = false,
    placeholder = 'Escriba su mensaje… (Markdown: **negrita**, _cursiva_, - viñetas)',
    autoFocus = false,
    menciones = [],
    cita = null,
    onQuitarCita,
    voiceConversationId,
    draftKey = null,
    onEnviarMedia,
  },
  ref
) {
  const [value, setValue] = useState('');
  // Borrador: al montar o al cambiar de conversación se carga el de esa
  // conversación (antes de pintar, para que no parpadee vacío). Se guarda
  // cuando cambia el TEXTO, no cuando cambia la clave: así el texto de una
  // conversación nunca se escribe en la clave de otra al pasar entre ellas.
  // `saltarGuardadoRef` evita que la pasada con el texto viejo (la que corre
  // justo antes de que llegue el borrador cargado) borre lo que se cargó.
  const claveBorradorRef = useRef<string | null>(null);
  const valorRef = useRef(value);
  valorRef.current = value;
  const saltarGuardadoRef = useRef(false);
  useLayoutEffect(() => {
    claveBorradorRef.current = draftKey;
    const cargado = leerBorrador(draftKey);
    if (cargado !== valorRef.current) {
      saltarGuardadoRef.current = true;
      setValue(cargado);
    }
  }, [draftKey]);
  useEffect(() => {
    if (saltarGuardadoRef.current) {
      saltarGuardadoRef.current = false;
      return;
    }
    guardarBorrador(claveBorradorRef.current, value);
  }, [value]);
  const [preview, setPreview] = useState(false);
  // Con teclado TÁCTIL el Enter hace salto de línea y para enviar está el
  // botón. Se detecta por `pointer: coarse` y no por ancho de pantalla a
  // propósito: lo que manda no es que la pantalla sea angosta sino que el
  // teclado sea de vidrio — un portátil con la ventana chica sigue teniendo
  // Enter físico y ahí Enter debe seguir enviando. Pedido de Nicolás
  // (2026-09-08): en el celular no hay un Shift+Enter cómodo.
  const tecladoTactil = useMediaQuery('(pointer: coarse)');
  // Apaga la animación de letras (ComposerLetterFx) para quien pide menos
  // movimiento en el sistema — la misma señal que ya se respeta en el resto
  // del chat.
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  // El id amarra la opción "Adjuntar archivos" (una <label>) con el input de
  // archivos. Va con useId y no con una constante porque puede haber más de un
  // compositor montado (el panel flotante y la página) y dos labels apuntando
  // al mismo id abrirían siempre el input equivocado.
  const fileInputId = useId();
  // El menú del clip se maneja controlado: la opción de adjuntar NO puede
  // cerrarlo al tocarla (ver el comentario de esa opción), así que hay que
  // cerrarlo a mano cuando ya se escogió el archivo.
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /*
   * Panel de Emoji | Stickers | GIF (2026-10-20), con botón propio al lado del
   * clip. En el celular (≤ 768 px, el mismo corte del resto del chat) es una
   * hoja DENTRO del compositor que reemplaza al teclado, como WhatsApp y
   * Telegram; en escritorio, un globo encima de la caja.
   */
  const [expresiones, setExpresiones] = useState(false);
  // «Mis stickers» (2026-10-21): la ventana vive AQUÍ y no dentro del panel:
  // en escritorio el panel es un globo que se cierra al tocar fuera, y se
  // llevaría la ventana con él.
  const [misStickersAbierto, setMisStickersAbierto] = useState(false);
  const enCelular = Boolean(useMediaQuery('(max-width: 768px)'));
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ─────────────────── Autocompletado de menciones (@) ────────────────── */
  /**
   * Solo se activa cuando hay a quién mencionar (grupos). En un hilo directo
   * `menciones` viene vacío y todo esto queda inerte: escribir una arroba no
   * abre nada.
   *
   * El disparador es la arroba MÁS CERCANA hacia atrás desde el cursor, y solo
   * cuenta si viene tras un inicio o un espacio — la misma condición que usa
   * el servidor para no confundir un correo con una mención
   * (lib/chat/groups.ts). Si aquí fuera distinto, la interfaz sugeriría
   * menciones que el servidor después no reconoce.
   */
  const [mencionAbierta, setMencionAbierta] = useState(false);
  const [mencionFiltro, setMencionFiltro] = useState('');
  const [mencionIndice, setMencionIndice] = useState(0);
  const mencionInicioRef = useRef(0);

  const candidatos = menciones.filter((m) => {
    if (mencionFiltro === '') return true;
    const f = mencionFiltro.toLowerCase();
    return m.valor.toLowerCase().includes(f) || m.nombre.toLowerCase().includes(f);
  });
  const mencionVisible = mencionAbierta && menciones.length > 0 && candidatos.length > 0;

  /** Revisa, tras cada cambio, si el cursor está justo detrás de una arroba. */
  const revisarMencion = useCallback(
    (texto: string, cursor: number) => {
      if (menciones.length === 0) return;

      const antes = texto.slice(0, cursor);
      const arroba = antes.lastIndexOf('@');
      if (arroba < 0) {
        setMencionAbierta(false);
        return;
      }

      // Lo escrito entre la arroba y el cursor. Un espacio o un salto de línea
      // cierran la mención: ya se pasó a escribir otra cosa.
      const parcial = antes.slice(arroba + 1);
      if (/[\s]/.test(parcial)) {
        setMencionAbierta(false);
        return;
      }

      // La arroba debe estar al inicio o tras un separador (si va pegada a
      // texto, es un correo).
      const anterior = arroba === 0 ? '' : antes[arroba - 1];
      if (anterior !== '' && /[\w@.]/.test(anterior)) {
        setMencionAbierta(false);
        return;
      }

      mencionInicioRef.current = arroba;
      setMencionFiltro(parcial);
      setMencionIndice(0);
      setMencionAbierta(true);
    },
    [menciones.length]
  );

  /** Reemplaza lo escrito tras la arroba por el nombre elegido. */
  const insertarMencion = useCallback(
    (candidato: MencionCandidato) => {
      const area = textareaRef.current;
      const inicio = mencionInicioRef.current;
      const cursor = area?.selectionStart ?? value.length;

      const texto = `${value.slice(0, inicio)}@${candidato.valor} ${value.slice(cursor)}`;
      setValue(texto);
      setMencionAbierta(false);

      // El cursor queda después del espacio que se acaba de insertar.
      const posicion = inicio + candidato.valor.length + 2;
      requestAnimationFrame(() => {
        area?.focus();
        area?.setSelectionRange(posicion, posicion);
      });
    },
    [value]
  );

  const tooLong = value.length > MAX_USER_MESSAGE_CHARS;
  // Solo se activa la capa decorativa de letras cuando es seguro: sin
  // menciones abiertas (esa lista depende de leer el texto real a tiempo),
  // sin vista previa de Markdown, mensaje corto, y sin
  // `prefers-reduced-motion`. Fuera de estas condiciones el campo se ve y se
  // comporta exactamente como siempre — nunca a medias.
  const letterFxActive =
    !preview && !mencionVisible && !disabled && !reducedMotion && value.length <= LETTERFX_MAX_CHARS;
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

      // Todos los adjuntos de un mensaje viajan en UNA petición, y IIS corta las de más de
      // 30.000.000 bytes con un 413 que la app nunca ve (se veía "No se pudo enviar el
      // mensaje."). Con fotos o videos de celular el tope se alcanza rápido: se avisa aquí.
      const merged = [...files];
      let totalBytes = merged.reduce((sum, f) => sum + f.size, 0);
      let overTotal = false;
      for (const file of accepted) {
        // Mismo nombre y mismo tamaño = el usuario lo escogió dos veces.
        if (merged.some((x) => x.name === file.name && x.size === file.size)) continue;
        if (merged.length >= MAX_CHAT_ATTACHMENTS_PER_MESSAGE) break;
        if (totalBytes + file.size > MAX_UPLOAD_REQUEST_BYTES) {
          overTotal = true;
          continue;
        }
        totalBytes += file.size;
        merged.push(file);
      }
      setFiles(merged);
      if (!problem && overTotal) {
        problem = `Los adjuntos de un mensaje pueden sumar máximo ${formatBytes(
          MAX_UPLOAD_REQUEST_BYTES
        )}. Envíe los demás en otro mensaje.`;
      }

      if (!problem && files.length + accepted.length > MAX_CHAT_ATTACHMENTS_PER_MESSAGE) {
        problem = `Puede adjuntar máximo ${MAX_CHAT_ATTACHMENTS_PER_MESSAGE} archivos por mensaje.`;
      }
      setFileError(problem);
    },
    [files]
  );

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setFileError(null);
  }, []);

  // El arrastrar-y-soltar vive en el hilo (para poder soltar sobre toda la
  // conversación, no solo sobre la caja de texto), pero los archivos y su
  // validación viven aquí. Esta es la única puerta entre los dos.
  useImperativeHandle(
    ref,
    () => ({ addFiles, focus: () => textareaRef.current?.focus() }),
    [addFiles]
  );

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

    if (kind === 'list' || kind === 'olist' || kind === 'quote') {
      // Viñetas, números y cita van por línea, no envolviendo.
      const block = selected || (kind === 'quote' ? 'cita' : 'elemento');
      const marcar = (line: string, i: number) => {
        if (kind === 'list') return line.trim().startsWith('- ') ? line : `- ${line}`;
        if (kind === 'quote') return line.startsWith('> ') ? line : `> ${line}`;
        return /^\s*\d{1,3}\.\s/.test(line) ? line : `${i + 1}. ${line}`;
      };
      const bulleted = block.split('\n').map(marcar).join('\n');
      const prefix = start === 0 || value[start - 1] === '\n' ? '' : '\n';
      next = value.slice(0, start) + prefix + bulleted + value.slice(end);
      cursorStart = start + prefix.length;
      cursorEnd = cursorStart + bulleted.length;
    } else if (kind === 'link') {
      const texto = selected || 'texto del enlace';
      const url = 'https://';
      next = `${value.slice(0, start)}[${texto}](${url})${value.slice(end)}`;
      // Queda seleccionada la dirección, lista para pegar la real.
      cursorStart = start + texto.length + 3;
      cursorEnd = cursorStart + url.length;
    } else {
      const marker = kind === 'bold' ? '**' : kind === 'italic' ? '_' : kind === 'strike' ? '~~' : '`';
      const inner =
        selected ||
        (kind === 'bold' ? 'negrita' : kind === 'italic' ? 'cursiva' : kind === 'strike' ? 'tachado' : 'código');
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
      // ⚠️ La lista de menciones se atiende ANTES que todo lo demás: con la
      // lista abierta, Enter escoge el nombre resaltado en vez de enviar el
      // mensaje. Si se atendiera después, escribir "@pl" + Enter mandaría el
      // mensaje a medio escribir, que es el error clásico de estos menús.
      if (mencionVisible) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setMencionIndice((i) => (i + 1) % candidatos.length);
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setMencionIndice((i) => (i - 1 + candidatos.length) % candidatos.length);
          return;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          insertarMencion(candidatos[Math.min(mencionIndice, candidatos.length - 1)]);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          setMencionAbierta(false);
          return;
        }
      }

      // Enter envía; Shift+Enter hace salto de línea (convención universal).
      // Con teclado táctil se invierte: Enter salta de línea y se envía con el
      // botón. No se llama a preventDefault, así que el salto lo hace el
      // navegador solo.
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        if (tecladoTactil) return;
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
    [applyFormat, candidatos, insertarMencion, mencionIndice, mencionVisible, submit, tecladoTactil]
  );

  /*
   * COMPOSITOR ESTILO TEAMS (2026-10-21). Nicolás mandó de referencia el
   * compositor de Microsoft Teams: «no debe ser igual, pero al menos, con la
   * nueva funcionalidad de los stickers, debe ser similar».
   *   - ESCRITORIO: marco con la caja arriba y, abajo a la derecha, una fila
   *     de íconos de línea — formato («A», que despliega arriba la barra de
   *     formato), emoji/stickers/GIF, clip, voz si la hay, «+» con más
   *     acciones y, separado, enviar. Una línea de acento abajo cuando el
   *     compositor tiene el foco.
   *   - CELULAR: la fila de antes (caja en cápsula y enviar al lado), con los
   *     íconos AGRUPADOS dentro de la caja: emoji/stickers y «+», que trae
   *     adjuntar, formato y vista previa.
   * La barra de formato reutiliza `applyFormat` (Markdown con ayudas): solo
   * lo que el Markdown del chat sabe pintar.
   */
  const [formatoAbierto, setFormatoAbierto] = useState(false);

  // Nunca se roba el foco de la caja al tocar un botón de la barra.
  const sinRobarFoco = (event: React.MouseEvent) => {
    if (document.activeElement === textareaRef.current) event.preventDefault();
  };

  const opcionAdjuntar = (
    /* ETIQUETA, no botón con `.click()` por programa.
       Abrir el selector desde JavaScript es frágil en el celular: se pierde
       el gesto del usuario, el teclado se cierra y no pasa nada más (Nicolás
       en iPhone, 2026-09-08). Con una <label> amarrada por `htmlFor`, quien
       abre el selector es el navegador de forma nativa.
       `closeMenuOnClick={false}` es indispensable: si el menú se desmonta con
       el mismo toque, la etiqueta desaparece antes de que el navegador
       alcance a activar el input. El menú se cierra en el `onChange` del
       input, cuando ya escogieron el archivo. */
    <Menu.Item
      component='label'
      htmlFor={fileInputId}
      closeMenuOnClick={false}
      leftSection={<IconPaperclip size={14} />}
      disabled={files.length >= MAX_CHAT_ATTACHMENTS_PER_MESSAGE}
      style={{ cursor: 'pointer' }}
    >
      Adjuntar archivos
    </Menu.Item>
  );

  const insertarArroba = () => {
    const el = textareaRef.current;
    const actual = valorRef.current;
    const pos = el?.selectionStart ?? actual.length;
    const antes = actual.slice(0, pos);
    const separador = antes === '' || /\s$/.test(antes) ? '' : ' ';
    const siguiente = `${antes}${separador}@${actual.slice(pos)}`;
    setValue(siguiente);
    const cursor = pos + separador.length + 1;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(cursor, cursor);
      revisarMencion(siguiente, cursor);
    });
  };

  // «+»: más acciones. En el celular también agrupa adjuntar y formato.
  const menuMas = (
    <Menu
      opened={menuAbierto}
      onChange={setMenuAbierto}
      position='top-end'
      withArrow
      shadow='md'
      width={225}
      trapFocus={!tecladoTactil}
      returnFocus={!tecladoTactil}
      menuItemTabIndex={0}
    >
      <Menu.Target>
        <ActionIcon
          variant='subtle'
          color='gray'
          size={34}
          radius='xl'
          disabled={disabled}
          aria-label='Más opciones'
          title='Más opciones'
          onMouseDown={sinRobarFoco}
        >
          <IconPlus size={19} stroke={1.6} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown className='chat-surface'>
        {enCelular && opcionAdjuntar}
        {enCelular && (
          <Menu.Item leftSection={<IconTypography size={14} />} onClick={() => setFormatoAbierto((f) => !f)}>
            {formatoAbierto ? 'Ocultar formato' : 'Formato'}
          </Menu.Item>
        )}
        {menciones.length > 0 && (
          <Menu.Item leftSection={<IconAt size={14} />} onClick={insertarArroba}>
            Mencionar a un asistente
          </Menu.Item>
        )}
        <Menu.Item leftSection={<IconCode size={14} />} onClick={() => applyFormat('code')}>
          Código
        </Menu.Item>
        <Menu.Item
          leftSection={preview ? <IconEyeOff size={14} /> : <IconEye size={14} />}
          onClick={() => setPreview((p) => !p)}
          disabled={value.trim().length === 0}
        >
          {preview ? 'Volver a editar' : 'Vista previa'}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );

  const botonFormato = (etiqueta: string, icono: React.ReactNode, kind: WrapKind, atajo?: string) => (
    <Tooltip label={atajo ? `${etiqueta} (${atajo})` : etiqueta} withArrow openDelay={400}>
      <ActionIcon
        variant='subtle'
        color='gray'
        size={30}
        radius='md'
        aria-label={etiqueta}
        onMouseDown={sinRobarFoco}
        onClick={() => applyFormat(kind)}
        disabled={disabled || preview}
      >
        {icono}
      </ActionIcon>
    </Tooltip>
  );

  // Barra de formato: se despliega ARRIBA de la caja con la «A» (como Teams).
  const barraFormato = formatoAbierto ? (
    <div className='chat-composer__formato' role='toolbar' aria-label='Formato del mensaje'>
      {botonFormato('Negrita', <IconBold size={17} stroke={1.8} />, 'bold', 'Ctrl+B')}
      {botonFormato('Cursiva', <IconItalic size={17} stroke={1.6} />, 'italic', 'Ctrl+I')}
      {botonFormato('Tachado', <IconStrikethrough size={17} stroke={1.6} />, 'strike')}
      <span className='chat-composer__separador' aria-hidden />
      {botonFormato('Lista con viñetas', <IconList size={17} stroke={1.6} />, 'list')}
      {botonFormato('Lista numerada', <IconListNumbers size={17} stroke={1.6} />, 'olist')}
      <span className='chat-composer__separador' aria-hidden />
      {botonFormato('Cita', <IconBlockquote size={17} stroke={1.6} />, 'quote')}
      {botonFormato('Código', <IconCode size={17} stroke={1.6} />, 'code')}
      {botonFormato('Enlace', <IconLink size={17} stroke={1.6} />, 'link')}
      <span style={{ flex: 1 }} />
      <Tooltip label='Ocultar formato' withArrow openDelay={400}>
        <ActionIcon
          variant='subtle'
          color='gray'
          size={30}
          radius='md'
          aria-label='Ocultar formato'
          onMouseDown={sinRobarFoco}
          onClick={() => setFormatoAbierto(false)}
        >
          <IconX size={16} stroke={1.6} />
        </ActionIcon>
      </Tooltip>
    </div>
  ) : null;

  /* ───── Panel de Emoji | Stickers | GIF (2026-10-20) ───── */

  // Inserta el emoji donde está el cursor (o reemplaza la selección). En el
  // celular NO se enfoca la caja: eso abriría el teclado encima del panel.
  const insertarEmoji = useCallback(
    (emoji: string) => {
      const area = textareaRef.current;
      const actual = valorRef.current;
      const inicio = area?.selectionStart ?? actual.length;
      const fin = area?.selectionEnd ?? actual.length;
      const siguiente = `${actual.slice(0, inicio)}${emoji}${actual.slice(fin)}`;
      if (siguiente.length > MAX_USER_MESSAGE_CHARS) return;
      setValue(siguiente);
      const pos = inicio + emoji.length;
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        if (!enCelular) el.focus({ preventScroll: true });
        el.setSelectionRange(pos, pos);
      });
    },
    [enCelular]
  );

  const enviarMedia = useCallback(
    (media: MediaParaEnviar) => {
      onEnviarMedia?.(media);
      // En escritorio el globo se cierra al enviar; en el celular la hoja
      // queda abierta, como en WhatsApp, para mandar otro si se quiere.
      if (!enCelular) setExpresiones(false);
    },
    [onEnviarMedia, enCelular]
  );

  const alternarExpresiones = useCallback(() => {
    const abrir = !expresiones;
    if (enCelular) {
      if (abrir) {
        // El panel reemplaza al teclado: se suelta el foco para cerrarlo.
        textareaRef.current?.blur();
      } else {
        // Volver al teclado: el panel se va y la caja recibe el foco.
        requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
      }
    }
    setExpresiones(abrir);
  }, [expresiones, enCelular]);

  const panelAbiertoEnCelular = expresiones && enCelular;

  const abrirMisStickers = useCallback(() => {
    if (!enCelular) setExpresiones(false);
    setMisStickersAbierto(true);
  }, [enCelular]);

  const iconoExpresiones = (
    <ActionIcon
      variant={expresiones ? 'light' : 'subtle'}
      color='gray'
      size={34}
      radius='xl'
      disabled={disabled}
      aria-label={panelAbiertoEnCelular ? 'Volver al teclado' : 'Emojis, stickers y GIF'}
      title={panelAbiertoEnCelular ? 'Volver al teclado' : 'Emojis, stickers y GIF'}
      aria-expanded={expresiones}
      data-testid='chat-boton-expresiones'
      onMouseDown={(event) => {
        // En escritorio la caja conserva el foco (y el cursor) al abrir.
        if (!enCelular && document.activeElement === textareaRef.current) event.preventDefault();
      }}
      onClick={alternarExpresiones}
    >
      {panelAbiertoEnCelular ? <IconKeyboard size={19} /> : <IconMoodSmile size={19} />}
    </ActionIcon>
  );

  const botonExpresiones = !onEnviarMedia ? null : enCelular ? (
    iconoExpresiones
  ) : (
    <Popover
      opened={expresiones}
      onChange={setExpresiones}
      position='top-end'
      offset={10}
      width={380}
      shadow='md'
      radius='md'
      withArrow
      trapFocus={false}
      returnFocus={false}
    >
      <Popover.Target>{iconoExpresiones}</Popover.Target>
      <Popover.Dropdown className='chat-surface chat-expresiones-globo' p='sm'>
        {expresiones && (
          <ChatExpresiones alto={320} onEmoji={insertarEmoji} onEnviar={enviarMedia} onMisStickers={abrirMisStickers} />
        )}
      </Popover.Dropdown>
    </Popover>
  );

  // CELULAR: botones dentro de la caja (emoji/stickers si hay, «+» y voz si
  // hay). En escritorio la caja no lleva nada adentro: los íconos van en la
  // fila de abajo.
  const botonesDentro = enCelular ? 1 + (onEnviarMedia ? 1 : 0) + (voiceConversationId ? 1 : 0) : 0;
  const anchoDentro = enCelular ? 42 * botonesDentro : 12;

  /* El recordatorio de Enter / Shift+Enter era un renglón entero; ahora vive
     en el globo de este botón. En el celular es grande (46 px contra los 34
     de los secundarios): es la acción principal y se toca con el pulgar. En
     escritorio, como en Teams, es un ícono de línea separado del resto. */
  const botonEnviar = (
    <Tooltip
      label={
        tecladoTactil
          ? 'Enviar · con teclado táctil, Enter salta de línea'
          : 'Enviar · Enter envía, Shift+Enter salta de línea'
      }
      withArrow
    >
      <ActionIcon
        className={enCelular ? 'chat-composer__send' : 'chat-composer__send chat-composer__send--marco'}
        size={enCelular ? 46 : 34}
        radius='xl'
        variant={enCelular ? 'filled' : 'subtle'}
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
        <IconSend size={enCelular ? 20 : 19} stroke={enCelular ? 2 : 1.6} />
      </ActionIcon>
    </Tooltip>
  );

  return (
    <Box
      className={[
        'chat-composer',
        letterFxActive ? 'chat-composer--letterfx-active' : '',
        enCelular ? '' : 'chat-composer--marco',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Lista de menciones. Va como primer hijo del compositor, así que se
          dibuja ARRIBA de la caja de escribir: en el celular, un menú que
          apareciera debajo quedaría tapado por el teclado. */}
      {mencionVisible && (
        <Box className='chat-menciones' role='listbox' aria-label='Asistentes del grupo'>
          {candidatos.map((c, i) => (
            <UnstyledButton
              key={c.valor}
              role='option'
              aria-selected={i === mencionIndice}
              className={[
                'chat-menciones__item',
                i === mencionIndice ? 'chat-menciones__item--activo' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              // `onMouseDown` y no `onClick`: el clic llega después del blur
              // del textarea, que cierra la lista, y el `onClick` nunca se
              // dispararía.
              onMouseDown={(event) => {
                event.preventDefault();
                insertarMencion(c);
              }}
              onMouseEnter={() => setMencionIndice(i)}
            >
              <Group gap={8} wrap='nowrap'>
                <AgentAvatar
                  code={c.valor}
                  displayName={c.nombre}
                  avatarUrl={c.avatarUrl}
                  size={22}
                  showStatus={false}
                  withTooltip={false}
                />
                <Text size='sm' fw={600} lineClamp={1}>
                  {c.nombre}
                </Text>
                <Text size='xs' className='chat-text-muted' lineClamp={1}>
                  @{c.valor}
                </Text>
              </Group>
            </UnstyledButton>
          ))}
        </Box>
      )}

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

      {/* La cita, encima de la caja y cancelable. Va ARRIBA y no dentro de la
          caja para no robarle renglones al texto: el compositor arranca en una
          sola fila y así se queda. */}
      {cita && (
        <Group gap={6} wrap='nowrap' mb={6} className='chat-cita chat-cita--compositor'>
          <Box className='chat-cita__barra' aria-hidden />
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Text size='xs' fw={600} lineClamp={1}>
              Respondiendo a {cita.author}
            </Text>
            <Text size='xs' className='chat-text-muted' lineClamp={1}>
              {cita.preview}
            </Text>
          </Box>
          <ActionIcon
            size='sm'
            variant='subtle'
            color='gray'
            onClick={() => onQuitarCita?.()}
            aria-label='Quitar la cita'
          >
            <IconX size={14} />
          </ActionIcon>
        </Group>
      )}

      {/* El contador solo aparece cerca del tope; el resto del tiempo no ocupa
          renglón, que es justamente lo que se buscaba. */}
      {value.length > MAX_USER_MESSAGE_CHARS * 0.8 && (
        <Text size='xs' c={tooLong ? 'red' : 'dimmed'} ta='right' mb={4}>
          {value.length.toLocaleString('es-CO')} / {MAX_USER_MESSAGE_CHARS.toLocaleString('es-CO')}
        </Text>
      )}

      {barraFormato}

      {/* `align='center'` y no `flex-end`: la caja (min-height 42 px) y el
          botón de enviar (46 px) tienen alturas DISTINTAS a propósito (ver el
          comentario del radio en `.chat-composer__input`), pero alineándolos
          por abajo esos pocos píxeles de diferencia quedan todos arriba de la
          caja y se ve corrida hacia abajo respecto al botón. Centrados, la
          diferencia se reparte mitad arriba y mitad abajo y no se nota.
          El `gap` sube de 2 a 8 px por lo mismo que reportó Nicolás
          (2026-09-10): pegados así la fila se ve amontonada, no espaciada. */}
      <Group gap={8} align='center' wrap='nowrap' className='chat-composer__row'>
        {preview ? (
          <Box
            className='chat-composer__preview'
            style={{ minHeight: 42, paddingRight: anchoDentro }}
            onDoubleClick={() => setPreview(false)}
          >
            <ChatMarkdown content={value} />
          </Box>
        ) : null}
        {!preview && (
          <Box pos='relative' style={{ display: 'flex', flex: 1, minWidth: 0 }}>
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => {
              setValue(event.currentTarget.value);
              revisarMencion(event.currentTarget.value, event.currentTarget.selectionStart ?? 0);
            }}
            onKeyUp={(event) => {
              // Mover el cursor con las flechas también cambia si estamos o no
              // dentro de una mención.
              if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
                revisarMencion(event.currentTarget.value, event.currentTarget.selectionStart ?? 0);
              }
            }}
            onBlur={() => setMencionAbierta(false)}
            // En el celular, tocar la caja con el panel abierto vuelve al
            // teclado (el panel lo estaba reemplazando).
            onFocus={() => {
              if (enCelular) setExpresiones(false);
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={placeholder}
            /* Sin corrector del navegador: nada de subrayado rojo ni
               autocorrección/mayúsculas automáticas en la caja del chat
               (Nicolás, 2026-09-09). spellCheck apaga el subrayado; autoCorrect
               y autoCapitalize evitan que el móvil "arregle" lo que se escribe. */
            spellCheck={false}
            autoCorrect='off'
            autoCapitalize='off'
            autosize
            /* size='md': Mantine no expone `size`, así que caía en su default
               ("sm") y ponía `--input-fz: 0.875rem` (14px) en el wrapper. Esa
               variable la hereda el `<textarea>` real y gana el empate de
               especificidad contra `.chat-composer__input` en globals.css
               (mismo peso, una sola clase, y `@mantine/core/styles.css` carga
               DESPUÉS en app/layout.tsx) — por eso el input seguía quedando
               en 14px pese al `font-size: 16px` del CSS, y Safari le seguía
               haciendo zoom al enfocarlo. */
            size='md'
            radius={enCelular ? 23 : 0}
            /* Arranca en UN renglón, como WhatsApp, y crece al escribir. */
            minRows={1}
            maxRows={6}
            disabled={disabled}
            autoFocus={autoFocus}
            error={tooLong ? 'El mensaje es demasiado largo.' : undefined}
            classNames={{
              root: 'chat-composer__field',
              input: enCelular ? 'chat-composer__input' : 'chat-composer__input chat-composer__input--marco',
            }}
            /* El clip (y, si la conversación admite voz, el ícono de llamada)
               va DENTRO de la caja. `rightSectionPointerEvents='all'` no es
               opcional: por defecto Mantine le pone `pointer-events: none` a
               esa zona —está pensada para iconos decorativos— y el botón
               quedaría pintado pero muerto al tacto. El ancho y el padding
               crecen de 42 a 84 px cuando hay ícono de voz, para que no se
               encimen los dos botones. */
            rightSection={
              enCelular ? (
                <Group gap={0} wrap='nowrap'>
                  {botonExpresiones}
                  {menuMas}
                  {voiceConversationId && (
                    <ChatVoice key={voiceConversationId} conversationId={voiceConversationId} />
                  )}
                </Group>
              ) : undefined
            }
            rightSectionWidth={enCelular ? anchoDentro : undefined}
            rightSectionPointerEvents='all'
            styles={{ input: { paddingRight: anchoDentro } }}
          />
          {letterFxActive && <ComposerLetterFx textareaRef={textareaRef} value={value} />}
          </Box>
        )}

        {enCelular && botonEnviar}
      </Group>

      {/* ESCRITORIO: la fila de íconos de línea abajo a la derecha, como Teams. */}
      {!enCelular && (
        <div className='chat-composer__acciones'>
          <Tooltip label={formatoAbierto ? 'Ocultar formato' : 'Formato'} withArrow openDelay={400}>
            <ActionIcon
              variant={formatoAbierto ? 'light' : 'subtle'}
              color='gray'
              size={34}
              radius='xl'
              disabled={disabled}
              aria-label='Formato'
              aria-pressed={formatoAbierto}
              onMouseDown={sinRobarFoco}
              onClick={() => setFormatoAbierto((f) => !f)}
            >
              <IconTypography size={19} stroke={1.6} />
            </ActionIcon>
          </Tooltip>
          {botonExpresiones}
          <Tooltip label='Adjuntar archivos' withArrow openDelay={400}>
            {/* Etiqueta amarrada al input de archivos: el navegador abre el
                selector de forma nativa (ver «Adjuntar archivos» del menú). */}
            <ActionIcon
              component='label'
              htmlFor={fileInputId}
              variant='subtle'
              color='gray'
              size={34}
              radius='xl'
              aria-label='Adjuntar archivos'
              // Una <label> no es enfocable ni responde al teclado: se le da
              // el papel de botón y Enter/Espacio abren el selector.
              role='button'
              tabIndex={0}
              onKeyDown={(event: React.KeyboardEvent) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              aria-disabled={disabled || files.length >= MAX_CHAT_ATTACHMENTS_PER_MESSAGE}
              style={{
                cursor: 'pointer',
                pointerEvents: disabled || files.length >= MAX_CHAT_ATTACHMENTS_PER_MESSAGE ? 'none' : undefined,
                opacity: disabled || files.length >= MAX_CHAT_ATTACHMENTS_PER_MESSAGE ? 0.5 : undefined,
              }}
            >
              <IconPaperclip size={19} stroke={1.6} />
            </ActionIcon>
          </Tooltip>
          {voiceConversationId && <ChatVoice key={voiceConversationId} conversationId={voiceConversationId} />}
          {menuMas}
          <span className='chat-composer__separador chat-composer__separador--alto' aria-hidden />
          {botonEnviar}
        </div>
      )}

      {/* Hoja del celular: ocupa el lugar del teclado, debajo de la caja. */}
      {panelAbiertoEnCelular && (
        <Box className='chat-expresiones-hoja'>
          <ChatExpresiones
            alto='min(34dvh, 280px)'
            onEmoji={insertarEmoji}
            onEnviar={enviarMedia}
            onMisStickers={abrirMisStickers}
          />
        </Box>
      )}

      {onEnviarMedia && <ChatMisStickers abierto={misStickersAbierto} onCerrar={() => setMisStickersAbierto(false)} />}

      {/* NO va con `hidden`. Con `hidden` (o sea `display:none`) el input no se
          renderiza, y varios navegadores móviles se niegan a abrir el selector
          de archivos cuando se le hace `.click()` por programa a un input que
          no está en el layout. En escritorio funcionaba y en el celular no
          pasaba nada al tocar "Adjuntar archivos" (Nicolás, 2026-09-08).
          Queda renderizado pero sin ocupar espacio: bloque de 0×0 y
          transparente. Va como `block` a propósito — en línea generaría una
          caja de renglón y le sumaría alto al compositor. El `.click()` por
          programa sí lo alcanza. */}
      <input
        ref={fileInputRef}
        id={fileInputId}
        type='file'
        multiple
        tabIndex={-1}
        aria-hidden='true'
        style={{
          display: 'block',
          width: 0,
          height: 0,
          padding: 0,
          border: 0,
          opacity: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
        onChange={(event) => {
          // El menú quedó abierto a propósito mientras se escogía el archivo;
          // ya con el archivo en mano se cierra.
          setMenuAbierto(false);
          addFiles(event.currentTarget.files);
          // Se limpia para que escoger DOS VECES el mismo archivo vuelva a
          // disparar el onChange.
          event.currentTarget.value = '';
          textareaRef.current?.focus({ preventScroll: true });
        }}
      />
    </Box>
  );
});

/*
 * En `memo` (2026-09-29): el hilo se re-renderiza en cada vuelta del sondeo
 * que trae un estado del agente (cada 1 s mientras trabaja) y arrastraba con
 * él todo el compositor —Textarea de Mantine, menú, voz— aunque no hubiera
 * cambiado nada de lo suyo. ChatThread le pasa props estables para que el
 * `memo` sirva.
 */
export default memo(ChatComposer);
