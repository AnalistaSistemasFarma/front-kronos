'use client';

import React from 'react';
import { Group, Text, Tooltip } from '@mantine/core';
import { IconBuilding } from '@tabler/icons-react';

/**
 * Logo real de la compañía (archivos locales en /public/landing/empresas, los mismos de la
 * landing). Si la compañía no tiene logo, se muestra su nombre con el ícono de siempre.
 */
const LOGOS: { match: RegExp; src: string }[] = [
  { match: /farmal[oó]gica/i, src: '/landing/empresas/farmalogica.png' },
  { match: /ryan/i, src: '/landing/empresas/ryan.png' },
  { match: /onelatam|one latam|\bolp\b/i, src: '/landing/empresas/onelatam-pharma.svg' },
  { match: /meditrack/i, src: '/landing/empresas/meditrack.png' },
  { match: /abamia/i, src: '/landing/empresas/abamia.png' },
  { match: /kelab/i, src: '/landing/empresas/kelab.png' },
  { match: /unidossis/i, src: '/landing/empresas/unidossis.png' },
  { match: /^\s*gss\b|group shared services/i, src: '/landing/empresas/gss.png' },
];

export function companyLogoSrc(name?: string | null): string | null {
  const n = String(name ?? '');
  return LOGOS.find((l) => l.match.test(n))?.src ?? null;
}

export default function CompanyLogo({ name, height = 22, maxWidth = 120 }: { name?: string | null; height?: number; maxWidth?: number }) {
  const label = String(name ?? '').trim();
  const src = companyLogoSrc(label);
  if (!src) {
    return (
      <Group gap={4} wrap="nowrap">
        <IconBuilding size={14} className="text-gray-400" />
        <Text size="sm" fw={500}>
          {label}
        </Text>
      </Group>
    );
  }
  return (
    <Tooltip label={label} withArrow openDelay={300}>
      {/* eslint-disable-next-line @next/next/no-img-element -- logos estáticos pequeños */}
      <img src={src} alt={label} style={{ height, maxWidth, objectFit: 'contain', display: 'block' }} />
    </Tooltip>
  );
}
