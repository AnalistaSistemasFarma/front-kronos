'use client';

import Link from 'next/link';
import { Badge, Card, Group, Stack, Text } from '@mantine/core';
import { CANAL_LABEL, VITRINA_URLS, vitrinaHref } from '../../lib/vitrina/constants';
import { tituloPresentacion, type CatalogoItem } from '../../lib/vitrina/catalogo';
import { VisibilidadBadge } from './VitrinaBadges';
import VitrinaImagen from './VitrinaImagen';

/**
 * Tarjeta de una presentación en la Biblioteca y el Inicio. Celular primero: miniatura
 * del vial a la izquierda y los datos al lado; toda la tarjeta abre la ficha.
 */
export default function VitrinaTarjeta({ item, idCompany }: { item: CatalogoItem; idCompany: number }) {
  return (
    <Card
      component={Link}
      href={vitrinaHref(`${VITRINA_URLS.ficha}/${item.id}`, idCompany)}
      withBorder
      radius='md'
      p='sm'
      data-testid='vitrina-tarjeta'
    >
      <Group wrap='nowrap' align='flex-start' gap='sm'>
        <div style={{ width: 76, flexShrink: 0 }}>
          <VitrinaImagen id={item.imagenes.VIAL} etiqueta='Vial' compacta />
        </div>
        <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
          <Text fw={700} lineClamp={2}>
            {tituloPresentacion(item)}
          </Text>
          {(item.nombreComercial || item.formaFarmaceutica) && (
            <Text size='sm' c='dimmed' lineClamp={1}>
              {[item.formaFarmaceutica, item.nombreComercial].filter(Boolean).join(' · ')}
            </Text>
          )}
          <Group gap={4} wrap='wrap'>
            <VisibilidadBadge visibilidad={item.visibilidad} />
            {item.esParaTerceros && (
              <Badge variant='light' color='grape' size='sm'>
                Para terceros
              </Badge>
            )}
            {item.paises.length > 0 && (
              <Badge variant='outline' color='gray' size='sm'>
                {item.paises.length === 1 ? item.paises[0] : `${item.paises.length} países`}
              </Badge>
            )}
            {item.canales.map((c) => (
              <Badge key={c} variant='outline' color='gray' size='sm'>
                {CANAL_LABEL[c]}
              </Badge>
            ))}
            {item.areas.slice(0, 2).map((a) => (
              <Badge key={a} variant='light' size='sm'>
                {a}
              </Badge>
            ))}
            {item.areas.length > 2 && (
              <Badge variant='light' color='gray' size='sm'>
                +{item.areas.length - 2}
              </Badge>
            )}
          </Group>
        </Stack>
      </Group>
    </Card>
  );
}
