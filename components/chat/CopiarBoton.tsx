'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionIcon, Tooltip } from '@mantine/core';
import { IconCheck, IconCopy } from '@tabler/icons-react';

/**
 * Botón chiquito de "copiar", para bloques de código y enlaces.
 *
 * Pedido de Nicolás (2026-09-08): "cuando es código o son links, ¿no podemos
 * generar como un botón muy pequeño que diga copiar? Para no tener que
 * seleccionar todo". Seleccionar a mano un bloque de código en el celular es
 * incómodo y casi siempre se lleva un espacio o un salto de línea de más.
 *
 * ⚠️ EL PORTAPAPELES NO SIEMPRE ESTÁ DISPONIBLE, y no por permisos: la API
 * `navigator.clipboard` **solo existe en contextos seguros** (HTTPS o
 * localhost). El front de PRUEBAS se sirve por HTTP en una IP interna, así que
 * allá no existe. Por eso hay respaldo con el método viejo —un textarea fuera
 * de pantalla y `document.execCommand('copy')`—, que sí funciona sin HTTPS.
 * Sin ese respaldo, el botón se vería igual y no haría nada justamente en el
 * entorno donde se prueba.
 */

async function copiarAlPortapapeles(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    // Cae al respaldo: el usuario pudo negar el permiso, o el navegador
    // bloquear la escritura por no venir de un gesto reconocido.
  }

  try {
    const area = document.createElement('textarea');
    area.value = texto;
    // Fuera de la vista, pero seleccionable: si se oculta con display:none o
    // visibility, la selección no funciona y no copia nada.
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export default function CopiarBoton({
  texto,
  etiqueta = 'Copiar',
  className,
  size = 22,
}: {
  /** Lo que se copia. */
  texto: string;
  /** Qué dice el globo antes de copiar. */
  etiqueta?: string;
  className?: string;
  size?: number;
}) {
  const [estado, setEstado] = useState<'listo' | 'copiado' | 'error'>('listo');
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sin esto, cambiar de conversación mientras el "Copiado" está en pantalla
  // deja un temporizador escribiendo en un componente que ya no existe.
  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    },
    []
  );

  const alPulsar = useCallback(
    async (event: React.MouseEvent) => {
      // El botón vive dentro de un bloque de código y, en el caso del enlace,
      // al lado de un <a>: sin esto, pulsarlo abriría el enlace.
      event.preventDefault();
      event.stopPropagation();

      const ok = await copiarAlPortapapeles(texto);
      setEstado(ok ? 'copiado' : 'error');
      if (temporizador.current) clearTimeout(temporizador.current);
      temporizador.current = setTimeout(() => setEstado('listo'), 1600);
    },
    [texto]
  );

  const globo =
    estado === 'copiado' ? '¡Copiado!' : estado === 'error' ? 'No se pudo copiar' : etiqueta;

  return (
    <Tooltip label={globo} withArrow position='left' opened={estado !== 'listo' ? true : undefined}>
      <ActionIcon
        className={['chat-copiar', className].filter(Boolean).join(' ')}
        variant='subtle'
        color={estado === 'error' ? 'red' : estado === 'copiado' ? 'green' : 'gray'}
        size={size}
        radius='sm'
        onClick={(event) => void alPulsar(event)}
        aria-label={globo}
      >
        {estado === 'copiado' ? <IconCheck size={13} /> : <IconCopy size={13} />}
      </ActionIcon>
    </Tooltip>
  );
}
