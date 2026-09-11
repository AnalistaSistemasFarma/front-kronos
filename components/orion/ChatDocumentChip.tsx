'use client';

import { Box, Group, Paper, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import { IconExternalLink, IconFileText, IconSignature } from '@tabler/icons-react';

type Props = {
  name: string;
  url: string;
  variant?: 'attachment' | 'signed';
  tone?: 'default' | 'chat';
  onOpen?: () => void;
};

/** Adjunto compacto para el hilo del chat o listas. */
export default function ChatDocumentChip({
  name,
  url,
  variant = 'attachment',
  tone = 'default',
  onOpen,
}: Props) {
  const handleOpen = () => {
    if (onOpen) onOpen();
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  const isChat = tone === 'chat';
  const color = variant === 'signed' ? 'green' : 'blue';

  return (
    <UnstyledButton onClick={handleOpen} aria-label={`Abrir ${name}`} w='100%'>
      <Paper
        p='xs'
        radius='md'
        withBorder
        style={{
          background: isChat ? 'rgba(255,255,255,0.95)' : 'var(--mantine-color-body)',
          borderColor: isChat ? 'transparent' : undefined,
        }}
      >
        <Group gap='sm' wrap='nowrap' align='center'>
          <ThemeIcon size={36} radius='md' variant='light' color={color}>
            {variant === 'signed' ? <IconSignature size={18} /> : <IconFileText size={18} />}
          </ThemeIcon>
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Text size='xs' fw={600} lineClamp={2} c={isChat ? 'dark' : undefined}>
              {name}
            </Text>
            <Text size='10px' c='dimmed'>
              PDF · tocar para abrir
            </Text>
          </Box>
          <IconExternalLink size={14} style={{ opacity: 0.45, flexShrink: 0 }} />
        </Group>
      </Paper>
    </UnstyledButton>
  );
}
