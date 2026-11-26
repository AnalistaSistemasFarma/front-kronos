/**
 * Animación "genio" (como el Dock de macOS) para la ventana flotante del chat.
 *
 * Al cerrar, la ventana se estrecha hacia el ícono que la abrió (el de la barra de chats)
 * como si la absorbiera; al abrir, sale de ese mismo ícono. Se hace con la Web Animations
 * API sobre `transform` + `clip-path`: el borde de la ventana más cercano al ícono se pincha
 * en un punto (el embudo) y todo se encoge hacia el centro del ícono.
 *
 * Los 4 puntos del `clip-path` van siempre en el mismo orden para que el navegador pueda
 * interpolar entre cuadros.
 */

type Side = 'left' | 'right' | 'top' | 'bottom';

export const GENIE_OPEN_MS = 380;
export const GENIE_CLOSE_MS = 440;
export const GENIE_OPEN_EASING = 'cubic-bezier(0.16, 0.84, 0.3, 1)';
export const GENIE_CLOSE_EASING = 'cubic-bezier(0.55, 0, 0.85, 0.36)';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Polígono con el borde "cercano" (hacia el ícono) entre nearA–nearB y el lejano entre farA–farB (en %). */
function polygon(side: Side, farA: number, farB: number, nearA: number, nearB: number): string {
  const p = (n: number) => `${n.toFixed(2)}%`;
  switch (side) {
    case 'left':
      return `polygon(100% ${p(farA)}, 100% ${p(farB)}, 0% ${p(nearB)}, 0% ${p(nearA)})`;
    case 'right':
      return `polygon(0% ${p(farA)}, 0% ${p(farB)}, 100% ${p(nearB)}, 100% ${p(nearA)})`;
    case 'top':
      return `polygon(${p(farA)} 100%, ${p(farB)} 100%, ${p(nearB)} 0%, ${p(nearA)} 0%)`;
    case 'bottom':
      return `polygon(${p(farA)} 0%, ${p(farB)} 0%, ${p(nearB)} 100%, ${p(nearA)} 100%)`;
  }
}

/**
 * Cuadros del CIERRE (ventana → ícono). `target` es el rectángulo del ícono; sin ícono visible,
 * la ventana se va a su esquina inferior derecha (de donde sale el panel).
 */
export function genieCloseFrames(panel: DOMRect, target: DOMRect | null): Keyframe[] {
  const tx = target ? target.left + target.width / 2 : panel.right - 24;
  const ty = target ? target.top + target.height / 2 : panel.bottom;
  const dx = tx - (panel.left + panel.width / 2);
  const dy = ty - (panel.top + panel.height / 2);
  const horizontal = Math.abs(dx) * panel.height >= Math.abs(dy) * panel.width;
  const side: Side = horizontal ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'top' : 'bottom';

  // Posición del ícono a lo largo del borde cercano, en % del panel.
  const along = horizontal
    ? clamp(((ty - panel.top) / panel.height) * 100, 4, 96)
    : clamp(((tx - panel.left) / panel.width) * 100, 4, 96);
  const origin = `${(tx - panel.left).toFixed(1)}px ${(ty - panel.top).toFixed(1)}px`;
  // Al principio se estira hacia el ícono y se adelgaza en la otra dirección (el "tirón").
  const squeeze = horizontal ? 'scale(0.9, 0.97)' : 'scale(0.97, 0.9)';
  const end = horizontal ? 'scale(0.03, 0.06)' : 'scale(0.06, 0.03)';

  return [
    { offset: 0, transformOrigin: origin, transform: 'scale(1)', clipPath: polygon(side, 0, 100, 0, 100), opacity: 1 },
    {
      offset: 0.42,
      transformOrigin: origin,
      transform: squeeze,
      clipPath: polygon(side, 0, 100, along - 6, along + 6),
      opacity: 1,
    },
    {
      offset: 1,
      transformOrigin: origin,
      transform: end,
      clipPath: polygon(side, along - 3, along + 3, along - 0.5, along + 0.5),
      opacity: 0.15,
    },
  ];
}

/** Cuadros de la APERTURA: los mismos del cierre al revés (sale del ícono). */
export function genieOpenFrames(panel: DOMRect, target: DOMRect | null): Keyframe[] {
  return genieCloseFrames(panel, target)
    .map((frame) => ({ ...frame, offset: 1 - Number(frame.offset ?? 0) }))
    .reverse();
}

/**
 * Cuadros de MAXIMIZAR: la ventana crece desde su lugar hasta cubrir `to` (la pantalla),
 * como el zoom de una ventana en macOS. Se anima el TAMAÑO REAL (posición, ancho y alto de un
 * elemento `position: fixed`), no `scale`: así el contenido se reacomoda en vez de estirarse
 * (con `scale` el texto quedaba deformado mientras cargaba la página de chats).
 */
export function zoomFrames(from: DOMRect, to: { left: number; top: number; width: number; height: number }): Keyframe[] {
  const px = (n: number) => `${n.toFixed(1)}px`;
  return [
    { left: px(from.left), top: px(from.top), width: px(from.width), height: px(from.height), borderRadius: '16px' },
    { left: px(to.left), top: px(to.top), width: px(to.width), height: px(to.height), borderRadius: '0px' },
  ];
}

/** Ícono de la barra de chats para una conversación (fila expandida o ícono colapsado). */
export function findChatLauncher(key: string | null | undefined): HTMLElement | null {
  if (!key || typeof document === 'undefined') return null;
  const nodes = document.querySelectorAll<HTMLElement>(`[data-chat-key="${CSS.escape(key)}"]`);
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    // Solo si se ve: un ícono oculto (barra cerrada, fuera de pantalla) no sirve de destino.
    if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight) return node;
  }
  return null;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}
