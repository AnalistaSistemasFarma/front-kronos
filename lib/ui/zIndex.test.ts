import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getDefaultZIndex } from '@mantine/core';
import { describe, expect, it } from 'vitest';
import { MANTINE_Z_INDEX, Z_INDEX } from './zIndex';

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

describe('z-index scale of the floating layers', () => {
  it('mirrors the Mantine defaults it is built on', () => {
    expect(MANTINE_Z_INDEX.app).toBe(getDefaultZIndex('app'));
    expect(MANTINE_Z_INDEX.modal).toBe(getDefaultZIndex('modal'));
    expect(MANTINE_Z_INDEX.popover).toBe(getDefaultZIndex('popover'));
    expect(MANTINE_Z_INDEX.overlay).toBe(getDefaultZIndex('overlay'));
  });

  it('stacks app shell < page chrome < chat panel < notification cards < any modal', () => {
    expect(MANTINE_Z_INDEX.app).toBeLessThan(Z_INDEX.pageFloating);
    expect(Z_INDEX.pageFloating).toBeLessThan(Z_INDEX.agentChatPanel);
    expect(Z_INDEX.agentChatPanel).toBeLessThan(Z_INDEX.inAppToasts);
    expect(Z_INDEX.inAppToasts).toBeLessThan(MANTINE_Z_INDEX.modal);
  });

  it('the attachment preview and the SGC viewer stack above the chat panel (msg 38445)', () => {
    for (const file of ['components/chat/ChatAttachmentViewer.tsx', 'components/sgc/SgcDocumentViewerModal.tsx']) {
      const values = [...read(file).matchAll(/zIndex=\{(\d+)\}/g)].map((m) => Number(m[1]));
      expect(values.length, file).toBeGreaterThan(0);
      for (const value of values) expect(value, file).toBeGreaterThan(Z_INDEX.inAppToasts);
    }
  });

  it('the chat panel and the notification cards take their z-index from the scale', () => {
    expect(read('components/chat/AgentChatPanel.tsx')).toContain('zIndex={Z_INDEX.agentChatPanel}');
    expect(read('components/notifications/InAppToastHost.tsx')).toContain('zIndex: Z_INDEX.inAppToasts');
    // A hard-coded z-index in the CSS module would not win over the inline one, but it would mislead.
    expect(read('components/notifications/InAppToastHost.module.css')).not.toMatch(/z-index:\s*\d/);
  });
});
