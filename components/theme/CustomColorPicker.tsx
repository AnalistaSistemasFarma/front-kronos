'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ColorPicker,
  ColorSwatch,
  Group,
  Popover,
  Text,
  TextInput,
  UnstyledButton,
  rem,
} from '@mantine/core';
import { IconCheck, IconColorPicker } from '@tabler/icons-react';
import { normalizeHex } from '../../lib/theme/colorMath';
import {
  parseCustomPaletteHex,
  toCustomPaletteKey,
} from '../../lib/theme/customPalette';
import { PALETTES } from '../../lib/theme/palettes';

interface CustomColorPickerProps {
  palette: string;
  onSelect: (key: string) => void;
  onPreview: (key: string) => void;
}

function startingHex(palette: string): string {
  const custom = parseCustomPaletteHex(palette);
  if (custom) return custom;
  const preset = PALETTES.find((p) => p.key === palette);
  return preset?.swatch ?? '#2563eb';
}

export function CustomColorPicker({
  palette,
  onSelect,
  onPreview,
}: CustomColorPickerProps) {
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customHex = parseCustomPaletteHex(palette);
  const active = customHex != null;
  const displayHex = startingHex(palette);
  const [opened, setOpened] = useState(false);
  const [hexDraft, setHexDraft] = useState(displayHex);

  useEffect(() => {
    setHexDraft(displayHex);
  }, [displayHex]);

  useEffect(() => {
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, []);

  const commit = (hex: string, persistNow: boolean) => {
    const key = toCustomPaletteKey(hex);
    if (!key) return;
    if (persistNow) {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      onSelect(key);
      return;
    }
    onPreview(key);
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => onSelect(key), 400);
  };

  const persistNow = () => {
    if (persistTimer.current) {
      clearTimeout(persistTimer.current);
      persistTimer.current = null;
    }
    const key = toCustomPaletteKey(displayHex);
    if (key) onSelect(key);
  };

  return (
    <div>
      <Text fw={600} size='sm' mb={4}>
        Color libre
      </Text>
      <Text size='xs' c='dimmed' mb='sm'>
        Abra el selector y gradúe el color. El cambio se aplica de inmediato y
        queda guardado en su perfil.
      </Text>

      <Popover
        opened={opened}
        onChange={setOpened}
        onClose={persistNow}
        position='bottom-start'
        withArrow
        shadow='md'
        radius='md'
        withinPortal
      >
        <Popover.Target>
          <UnstyledButton
            type='button'
            onClick={() => setOpened((o) => !o)}
            aria-pressed={active}
            aria-expanded={opened}
            aria-haspopup='dialog'
            aria-label='Elegir color personalizado'
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: rem(8),
              padding: rem(8),
              borderRadius: 'var(--mantine-radius-md)',
              border: active
                ? '2px solid var(--mantine-primary-color-filled)'
                : '1px solid var(--app-border, var(--mantine-color-default-border))',
              background: active
                ? 'var(--mantine-primary-color-light)'
                : 'transparent',
              cursor: 'pointer',
            }}
          >
            <ColorSwatch color={displayHex} size={22} withShadow={false}>
              {active ? <IconCheck size={14} color='#fff' /> : null}
            </ColorSwatch>
            <Group gap={6} wrap='nowrap'>
              <IconColorPicker size={16} />
              <Text size='sm' fw={active ? 600 : 400}>
                Personalizado
              </Text>
              <Text size='xs' c='dimmed' ff='monospace'>
                {displayHex}
              </Text>
            </Group>
          </UnstyledButton>
        </Popover.Target>

        <Popover.Dropdown p='sm'>
          <ColorPicker
            format='hex'
            value={displayHex}
            onChange={(value) => commit(value, false)}
            onChangeEnd={(value) => commit(value, true)}
            saturationLabel='Saturación y luminosidad'
            hueLabel='Matiz'
            size='sm'
          />
          <TextInput
            label='Hex'
            size='xs'
            mt='sm'
            value={hexDraft}
            onChange={(e) => {
              const next = e.currentTarget.value;
              setHexDraft(next);
              const normalized = normalizeHex(next);
              if (normalized) commit(normalized, false);
            }}
            onBlur={() => {
              const normalized = normalizeHex(hexDraft);
              if (normalized) {
                setHexDraft(normalized);
                commit(normalized, true);
              } else {
                setHexDraft(displayHex);
              }
            }}
            styles={{ input: { fontFamily: 'monospace' } }}
          />
        </Popover.Dropdown>
      </Popover>
    </div>
  );
}
