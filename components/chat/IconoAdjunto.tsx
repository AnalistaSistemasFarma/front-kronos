'use client';

import {
  IconFile,
  IconFileCode,
  IconFileMusic,
  IconFileTypeCsv,
  IconFileTypeDoc,
  IconFileTypePdf,
  IconFileTypePpt,
  IconFileTypeTxt,
  IconFileTypeXls,
  IconMarkdown,
  IconMovie,
  IconPhoto,
} from '@tabler/icons-react';
import { extensionDe, tipoDeVisor } from '../../lib/chat/visor';

/**
 * Ícono de la ficha de un adjunto según su tipo (2026-10-22). Antes la ficha
 * llevaba el ícono de descargar; ahora tocarla ABRE EL VISOR, así que el ícono
 * dice qué es el archivo, no qué pasa al tocarlo.
 */
export default function IconoAdjunto({ fileName, contentType, size = 13 }: { fileName: string; contentType: string | null; size?: number }) {
  const tipo = tipoDeVisor(contentType, fileName);
  const ext = extensionDe(fileName);
  const props = { size, style: { flexShrink: 0 } as const, 'aria-hidden': true };
  switch (tipo) {
    case 'imagen':
      return <IconPhoto {...props} />;
    case 'pdf':
      return <IconFileTypePdf {...props} />;
    case 'hoja':
      return <IconFileTypeXls {...props} />;
    case 'office':
      if (['ppt', 'pptx', 'pps', 'ppsx', 'odp'].includes(ext)) return <IconFileTypePpt {...props} />;
      if (['xls', 'ods'].includes(ext)) return <IconFileTypeXls {...props} />;
      return <IconFileTypeDoc {...props} />;
    case 'markdown':
      return <IconMarkdown {...props} />;
    case 'csv':
      return <IconFileTypeCsv {...props} />;
    case 'texto':
      return ['txt', 'log', ''].includes(ext) ? <IconFileTypeTxt {...props} /> : <IconFileCode {...props} />;
    case 'audio':
      return <IconFileMusic {...props} />;
    case 'video':
      return <IconMovie {...props} />;
    default:
      return <IconFile {...props} />;
  }
}
