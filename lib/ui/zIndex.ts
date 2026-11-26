/**
 * Stacking scale for the app-wide floating layers.
 *
 * Bug (Nicolás, 2026-11-24, msg 38445): the floating agent chat panel sat at
 * z-index 401, one step above the attachment preview (400) and far above every
 * Mantine Modal/Drawer (200 by default), so opening a PDF preview while the
 * panel was open left the panel covering the right side of the preview.
 *
 * Rule: anything modal (Modal, Drawer, lightbox, document viewer, confirm
 * dialog) must stack above the floating chat panel and above the in-app
 * notification cards. The floating layers therefore live BELOW Mantine's modal
 * layer, and page-level floating chrome (fixed action bars, FABs, the e-mail
 * compose window) lives below the chat panel:
 *
 *   app shell (100) < page floating chrome (150) < agent chat panel (190)
 *     < in-app notification cards (195) < Mantine modal/drawer (200)
 *     < popovers (300) < overlays/viewers (400+)
 *
 * Notification cards vs. an open modal: the modal wins. A card that arrives
 * while a preview is open stays behind the modal overlay (never on top of the
 * preview toolbar) and is still there when the modal closes, unless its 8 s
 * timer ran out — the same as any message that arrives while you read.
 *
 * Mantine's defaults are mirrored here (instead of importing `getDefaultZIndex`)
 * so this module stays importable from plain Node tests.
 */
export const MANTINE_Z_INDEX = {
  app: 100,
  modal: 200,
  popover: 300,
  overlay: 400,
} as const;

export const Z_INDEX = {
  /** Fixed action bars, floating action buttons and the e-mail compose window. */
  pageFloating: 150,
  /** Floating agent chat panel (AgentChatPanel), docked bottom-right or full screen on phones. */
  agentChatPanel: 190,
  /** In-app notification cards (InAppToastHost). Above the chat panel, below any modal. */
  inAppToasts: 195,
} as const;
