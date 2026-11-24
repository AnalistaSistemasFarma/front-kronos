'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ActionIcon, Box, Drawer, Group, Loader, Popover, ScrollArea, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconChevronRight, IconCrown, IconVideo } from '@tabler/icons-react';
import { MEETINGS_HREF, formatMinutes, formatTime, relativeDay } from '../../lib/meetings/format';
import type { Meeting } from '../../lib/meetings/metrics';

/**
 * "Reuniones recientes" in the header (2026-11-23, Nicolás Rivera): last
 * Teams/calendar meetings of the SIGNED-IN account, with a link to the full
 * history (/process/reuniones). Only shows up when the server says the module
 * is enabled for the person (REUNIONES_USUARIOS); never shows errors.
 */

const DELAY_MS = 2500;
const TTL_MS = 5 * 60 * 1000;

interface State {
  email: string;
  enabled: boolean;
  meetings: Meeting[];
  at: number;
}

// Shared across mounts (the header re-mounts when the layout changes).
let memory: State | null = null;

async function load(email: string): Promise<State | null> {
  try {
    const res = await fetch('/api/meetings/recent', { credentials: 'same-origin', cache: 'no-store' });
    if (res.status >= 500 || res.status === 429) return null;
    const body = (await res.json().catch(() => null)) as { enabled?: boolean; meetings?: Meeting[] } | null;
    const state: State = {
      email,
      enabled: res.ok && body?.enabled === true,
      meetings: body?.meetings ?? [],
      at: Date.now(),
    };
    memory = state;
    return state;
  } catch {
    return null;
  }
}

export default function MeetingsHeaderIcon() {
  const { data: session, status } = useSession();
  const email = session?.user?.email?.toLowerCase() ?? null;
  const pathname = usePathname();
  const mobile = useMediaQuery('(max-width: 48em)') ?? false;
  const [state, setState] = useState<State | null>(memory);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (status !== 'authenticated' || !email) {
      if (status === 'unauthenticated') memory = null;
      setState(null);
      return;
    }
    if (memory && memory.email === email) {
      setState(memory);
      if (Date.now() - memory.at < TTL_MS) return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      void load(email).then((s) => {
        if (!cancelled && s) setState(s);
      });
    }, DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [status, email]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const refresh = useCallback(async () => {
    if (!email) return;
    if (memory && memory.email === email && Date.now() - memory.at < TTL_MS) return;
    setLoading(true);
    const s = await load(email);
    if (s) setState(s);
    setLoading(false);
  }, [email]);

  if (!email || !state || state.email !== email || !state.enabled) return null;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void refresh();
  };

  const active = pathname?.startsWith(MEETINGS_HREF) ?? false;

  const button = (
    <Tooltip label='Reuniones recientes' withArrow disabled={open}>
      <ActionIcon
        variant='subtle'
        color='gray'
        onClick={toggle}
        aria-label='Reuniones recientes'
        aria-haspopup='dialog'
        aria-expanded={open}
        aria-current={active ? 'page' : undefined}
        data-testid='header-reuniones'
      >
        <IconVideo size={18} />
      </ActionIcon>
    </Tooltip>
  );

  const panel = (
    <Box>
      <Group justify='space-between' px='md' py='sm' style={{ borderBottom: '1px solid var(--app-border, rgba(0,0,0,.08))' }}>
        <Text fw={600} size='sm'>
          Reuniones recientes
        </Text>
        {loading && <Loader size='xs' />}
      </Group>
      <ScrollArea.Autosize mah={mobile ? undefined : 380}>
        {state.meetings.length === 0 ? (
          <Text size='sm' c='dimmed' px='md' py='lg' ta='center'>
            No tuvo reuniones en los últimos 7 días.
          </Text>
        ) : (
          state.meetings.map((m) => (
            <UnstyledButton
              key={m.id}
              component={Link}
              href={`${MEETINGS_HREF}?reunion=${encodeURIComponent(m.id)}`}
              onClick={() => setOpen(false)}
              px='md'
              py={8}
              w='100%'
              style={{ display: 'block' }}
              className='hover:bg-black/5 dark:hover:bg-white/5'
            >
              <Group gap={6} wrap='nowrap'>
                {m.isOrganizer && <IconCrown size={14} color='var(--mantine-color-yellow-6)' aria-label='Usted organizó' />}
                <Text size='sm' fw={500} lineClamp={1} style={{ flex: 1 }}>
                  {m.subject}
                </Text>
              </Group>
              <Text size='xs' c='dimmed'>
                {relativeDay(m.start)} · {formatTime(m.start)} · {formatMinutes(m.scheduledMinutes)}
                {m.isOrganizer ? '' : ` · ${m.organizerName}`}
              </Text>
            </UnstyledButton>
          ))
        )}
      </ScrollArea.Autosize>
      <UnstyledButton
        component={Link}
        href={MEETINGS_HREF}
        onClick={() => setOpen(false)}
        px='md'
        py='sm'
        w='100%'
        style={{ display: 'block', borderTop: '1px solid var(--app-border, rgba(0,0,0,.08))' }}
      >
        <Group justify='space-between'>
          <Text size='sm' fw={600} c='blue'>
            Ver todas mis reuniones
          </Text>
          <IconChevronRight size={16} />
        </Group>
      </UnstyledButton>
    </Box>
  );

  if (mobile) {
    return (
      <>
        {button}
        <Drawer opened={open} onClose={() => setOpen(false)} position='bottom' size='75%' title={null} withCloseButton={false} padding={0}>
          {panel}
        </Drawer>
      </>
    );
  }

  return (
    <Popover opened={open} onChange={setOpen} position='bottom-end' width={380} withArrow shadow='md'>
      <Popover.Target>{button}</Popover.Target>
      <Popover.Dropdown p={0} className='notification-bell-dropdown' aria-label='Reuniones recientes'>
        {panel}
      </Popover.Dropdown>
    </Popover>
  );
}
