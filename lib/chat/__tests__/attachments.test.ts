import { describe, expect, it } from 'vitest';
import {
  BLOCKED_ATTACHMENT_EXTENSIONS,
  CHAT_ATTACHMENTS_ROOT,
  MAX_CHAT_ATTACHMENTS_PER_MESSAGE,
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_CHAT_ATTACHMENT_NAME_CHARS,
  attachmentExtension,
  buildChatAttachmentFolderSegments,
  buildContentDisposition,
  buildStoredAttachmentName,
  canAccessChatAttachment,
  collectChatAttachments,
  formatBytes,
  getChatAttachmentError,
  isBlockedAttachmentExtension,
  safeDownloadContentType,
  sanitizeChatAttachmentName,
} from '../attachments';

/**
 * Pruebas de las utilidades PURAS de los adjuntos del chat (sin base de datos,
 * sin red y sin Microsoft Graph: eso vive en lib/chat/attachmentStorage.ts).
 *
 * El foco está en lo que puede hacer daño: travesía de rutas en el nombre del
 * archivo, ejecutables colados por la extensión, topes de tamaño y —sobre
 * todo— la regla de autorización de la descarga, que es el punto donde un
 * error se convierte en un IDOR.
 */

describe('sanitizeChatAttachmentName — travesía de rutas', () => {
  it('se queda solo con el último segmento de una ruta tipo Unix', () => {
    expect(sanitizeChatAttachmentName('../../../etc/passwd')).toBe('passwd');
    expect(sanitizeChatAttachmentName('/var/www/secreto.pdf')).toBe('secreto.pdf');
  });

  it('se queda solo con el último segmento de una ruta tipo Windows', () => {
    expect(sanitizeChatAttachmentName('..\\..\\windows\\system32\\cmd.txt')).toBe('cmd.txt');
    expect(sanitizeChatAttachmentName('C:\\Users\\nicolas\\informe.xlsx')).toBe('informe.xlsx');
  });

  it('no deja pasar "..", ni solo ni disfrazado', () => {
    for (const intento of ['..', '../..', '....//....//x', '..%2f..%2fetc']) {
      const salida = sanitizeChatAttachmentName(intento);
      expect(salida).not.toContain('..');
      expect(salida).not.toContain('/');
      expect(salida).not.toContain('\\');
    }
  });

  it('elimina saltos de línea y caracteres de control (inyección de cabeceras)', () => {
    const sucio = 'informe\r\nContent-Type: text/html\r\n\r\n<script>.pdf';
    const limpio = sanitizeChatAttachmentName(sucio);
    expect(limpio).not.toMatch(/[\r\n]/);
    expect(limpio).not.toContain('<');
    expect(limpio).not.toContain('>');
  });

  it('nunca devuelve cadena vacía', () => {
    expect(sanitizeChatAttachmentName('')).toBe('archivo');
    expect(sanitizeChatAttachmentName('   ')).toBe('archivo');
    expect(sanitizeChatAttachmentName('/////')).toBe('archivo');
    expect(sanitizeChatAttachmentName(null)).toBe('archivo');
    expect(sanitizeChatAttachmentName(42)).toBe('archivo');
  });

  it('conserva tildes, eñes y espacios normales', () => {
    expect(sanitizeChatAttachmentName('Informe de gestión — año 2026.pdf')).toBe(
      'Informe de gestión — año 2026.pdf'
    );
  });

  it('recorta un nombre larguísimo conservando la extensión', () => {
    const largo = `${'a'.repeat(500)}.pdf`;
    const salida = sanitizeChatAttachmentName(largo);
    expect(salida.length).toBeLessThanOrEqual(MAX_CHAT_ATTACHMENT_NAME_CHARS);
    expect(salida.endsWith('.pdf')).toBe(true);
  });
});

describe('extensiones bloqueadas', () => {
  it('lee la extensión en minúsculas', () => {
    expect(attachmentExtension('INFORME.PDF')).toBe('pdf');
    expect(attachmentExtension('sin-extension')).toBe('');
    expect(attachmentExtension('.gitignore')).toBe('');
  });

  it('rechaza ejecutables y guiones, sin importar mayúsculas', () => {
    for (const nombre of [
      'virus.exe',
      'INSTALADOR.MSI',
      'script.BAT',
      'tarea.cmd',
      'algo.ps1',
      'algo.sh',
      'algo.vbs',
      'payload.js',
      'app.jar',
      'lib.dll',
      'macro.docm',
    ]) {
      expect(isBlockedAttachmentExtension(nombre)).toBe(true);
      expect(getChatAttachmentError({ name: nombre, size: 10 })).not.toBeNull();
    }
  });

  it('no se deja engañar por la ruta ni por un nombre compuesto', () => {
    expect(isBlockedAttachmentExtension('../../carpeta/algo.exe')).toBe(true);
    expect(isBlockedAttachmentExtension('informe.pdf.exe')).toBe(true);
  });

  it('deja pasar los formatos de trabajo normales', () => {
    for (const nombre of [
      'informe.pdf',
      'cargue.xlsx',
      'acta.docx',
      'foto.png',
      'datos.csv',
      'presentacion.pptx',
      'notas.txt',
    ]) {
      expect(isBlockedAttachmentExtension(nombre)).toBe(false);
      expect(getChatAttachmentError({ name: nombre, size: 1024 })).toBeNull();
    }
  });

  it('la lista no tiene duplicados', () => {
    expect(new Set(BLOCKED_ATTACHMENT_EXTENSIONS).size).toBe(BLOCKED_ATTACHMENT_EXTENSIONS.length);
  });
});

describe('getChatAttachmentError — tamaño', () => {
  it('acepta exactamente el tope', () => {
    expect(
      getChatAttachmentError({ name: 'grande.pdf', size: MAX_CHAT_ATTACHMENT_BYTES })
    ).toBeNull();
  });

  it('rechaza un byte por encima del tope y dice cuánto pesa', () => {
    const error = getChatAttachmentError({
      name: 'grande.pdf',
      size: MAX_CHAT_ATTACHMENT_BYTES + 1,
    });
    expect(error).not.toBeNull();
    expect(error).toMatch(/25\.0 MB/);
  });

  it('rechaza un archivo vacío', () => {
    expect(getChatAttachmentError({ name: 'vacio.pdf', size: 0 })).not.toBeNull();
  });
});

describe('collectChatAttachments', () => {
  const archivo = (nombre: string, bytes: number, tipo = 'application/pdf') =>
    new File([new Uint8Array(bytes)], nombre, { type: tipo });

  it('devuelve los archivos con el nombre ya saneado', () => {
    const form = new FormData();
    form.append('body', 'hola');
    form.append('files', archivo('../../etc/passwd.pdf', 10));

    const r = collectChatAttachments(form);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.files).toHaveLength(1);
      expect(r.files[0].fileName).toBe('passwd.pdf');
      expect(r.files[0].size).toBe(10);
    }
  });

  it('sin campo `files` devuelve una lista vacía (mensaje de solo texto)', () => {
    const form = new FormData();
    form.append('body', 'hola');
    const r = collectChatAttachments(form);
    expect(r).toEqual({ ok: true, files: [] });
  });

  it('rechaza más archivos de los permitidos por mensaje', () => {
    const form = new FormData();
    for (let i = 0; i <= MAX_CHAT_ATTACHMENTS_PER_MESSAGE; i += 1) {
      form.append('files', archivo(`a${i}.pdf`, 10));
    }
    const r = collectChatAttachments(form);
    expect(r.ok).toBe(false);
  });

  it('rechaza el lote completo si UNO tiene extensión bloqueada', () => {
    const form = new FormData();
    form.append('files', archivo('bueno.pdf', 10));
    form.append('files', archivo('malo.exe', 10));
    const r = collectChatAttachments(form);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/exe/);
  });

  it('no confía en el content-type declarado: manda la extensión', () => {
    const form = new FormData();
    // Se disfraza de PDF, pero el nombre dice .exe.
    form.append('files', archivo('troyano.exe', 10, 'application/pdf'));
    expect(collectChatAttachments(form).ok).toBe(false);
  });
});

describe('buildChatAttachmentFolderSegments', () => {
  it('construye CHAT-AGENTES/<id_conversation>/<YYYY-MM>', () => {
    const segmentos = buildChatAttachmentFolderSegments(12, new Date(2026, 8, 6));
    expect(segmentos).toEqual([CHAT_ATTACHMENTS_ROOT, '12', '2026-09']);
  });

  it('rellena el mes con cero a la izquierda', () => {
    expect(buildChatAttachmentFolderSegments(1, new Date(2026, 0, 31))[2]).toBe('2026-01');
  });
});

describe('buildStoredAttachmentName', () => {
  it('antepone un token para que dos archivos iguales no se pisen', () => {
    expect(buildStoredAttachmentName('informe.pdf', 'abcd1234')).toBe('abcd1234-informe.pdf');
  });

  it('el nombre guardado tampoco lleva ruta', () => {
    const guardado = buildStoredAttachmentName('../../evil.pdf', 'tok');
    expect(guardado).toBe('tok-evil.pdf');
    expect(guardado).not.toContain('/');
  });

  it('dos llamadas seguidas producen nombres distintos', () => {
    expect(buildStoredAttachmentName('a.pdf')).not.toBe(buildStoredAttachmentName('a.pdf'));
  });
});

describe('canAccessChatAttachment — la regla anti-IDOR de la descarga', () => {
  const hilo = { conversationUserId: 'user-1', conversationAgentId: 7 };

  it('el dueño del hilo puede bajar su adjunto', () => {
    expect(canAccessChatAttachment(hilo, { kind: 'user', userId: 'user-1' })).toBe(true);
  });

  it('OTRO usuario no puede: cambiar el id en la URL no sirve de nada', () => {
    expect(canAccessChatAttachment(hilo, { kind: 'user', userId: 'user-2' })).toBe(false);
  });

  it('un usuario sin id tampoco pasa', () => {
    expect(canAccessChatAttachment(hilo, { kind: 'user', userId: '' })).toBe(false);
  });

  it('el agente del hilo sí puede', () => {
    expect(canAccessChatAttachment(hilo, { kind: 'agent', idAgent: 7 })).toBe(true);
  });

  it('OTRO agente no puede leer los adjuntos de un hilo ajeno', () => {
    expect(canAccessChatAttachment(hilo, { kind: 'agent', idAgent: 8 })).toBe(false);
  });

  it('el id del usuario y el del agente no se confunden entre sí', () => {
    // Un id de agente que "coincide" con el texto del usuario no abre nada.
    const raro = { conversationUserId: '7', conversationAgentId: 7 };
    expect(canAccessChatAttachment(raro, { kind: 'user', userId: 'user-1' })).toBe(false);
    expect(canAccessChatAttachment(raro, { kind: 'agent', idAgent: 1 })).toBe(false);
  });
});

describe('cabeceras de la descarga', () => {
  it('solo devuelve tipos conocidos; el resto va como binario', () => {
    expect(safeDownloadContentType('application/pdf')).toBe('application/pdf');
    expect(safeDownloadContentType('IMAGE/PNG')).toBe('image/png');
    expect(safeDownloadContentType('text/plain; charset=utf-8')).toBe('text/plain');
    expect(safeDownloadContentType('text/html')).toBe('application/octet-stream');
    expect(safeDownloadContentType('image/svg+xml')).toBe('application/octet-stream');
    expect(safeDownloadContentType(null)).toBe('application/octet-stream');
  });

  it('el Content-Disposition siempre es `attachment` y no se puede romper', () => {
    const cabecera = buildContentDisposition('inf"orme\r\n; x=1.pdf');
    expect(cabecera.startsWith('attachment; ')).toBe(true);
    expect(cabecera).not.toMatch(/[\r\n]/);
    // Solo pueden quedar las dos comillas que envuelven el `filename=`.
    expect((cabecera.match(/"/g) ?? []).length).toBe(2);
  });

  it('manda el nombre también en UTF-8 para no perder las tildes', () => {
    const cabecera = buildContentDisposition('gestión.pdf');
    expect(cabecera).toContain("filename*=UTF-8''");
    expect(cabecera).toContain(encodeURIComponent('gestión.pdf'));
  });
});

describe('formatBytes', () => {
  it('usa la unidad que corresponde', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
