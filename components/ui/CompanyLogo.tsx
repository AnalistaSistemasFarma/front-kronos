'use client';

import React from 'react';
import { Group, Text, Tooltip } from '@mantine/core';
import { IconBuilding } from '@tabler/icons-react';

/**
 * Logo real de la compañía (archivos locales en /public/landing/empresas, los mismos de la
 * landing). Si la compañía no tiene logo, se muestra su nombre con el ícono de siempre.
 */
const LOGOS: { match: RegExp; src: string }[] = [
  // Farmalógica y Unidossis son horizontales: en la caja 4:3 se usa su isotipo (versión cuadrada).
  { match: /farmal[oó]gica/i, src: '/landing/empresas/farmalogica-icono.png' },
  // BIOSELECT y FARMADOSIS (2026-11-27, logos enviados por Cristian Baldión).
  { match: /farma\s*dosis/i, src: '/landing/empresas/farmadosis.png' },
  { match: /bio\s*select/i, src: '/landing/empresas/bioselect.png' },
  { match: /ryan/i, src: '/landing/empresas/ryan.png' },
  // ONE LATAM ONCO must be matched before the generic OneLatam Pharma rule.
  { match: /one\s*latam\s*onco|\bolp\s*onco\b/i, src: '/landing/empresas/onelatam-onco.svg' },
  { match: /onelatam|one latam|\bolp\b/i, src: '/landing/empresas/onelatam-pharma.svg' },
  { match: /meditrack/i, src: '/landing/empresas/meditrack.png' },
  { match: /abamia/i, src: '/landing/empresas/abamia.png' },
  { match: /kelab/i, src: '/landing/empresas/kelab.png' },
  { match: /unidossis/i, src: '/landing/empresas/unidossis-icono.png' },
  { match: /^\s*gss\b|group shared services/i, src: '/landing/empresas/gss.png' },
];

export function companyLogoSrc(name?: string | null): string | null {
  const n = String(name ?? '');
  return LOGOS.find((l) => l.match.test(n))?.src ?? null;
}

/** Logo en una caja de proporción 4:3 (alto `height`), igual para todas las compañías. */
export default function CompanyLogo({ name, height = 30 }: { name?: string | null; height?: number }) {
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
      <img src={src} alt={label} style={{ height, width: Math.round((height * 4) / 3), objectFit: 'contain', display: 'block' }} />
    </Tooltip>
  );
}
