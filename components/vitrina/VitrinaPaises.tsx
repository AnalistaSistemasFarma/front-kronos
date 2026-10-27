'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Alert, Badge, Card, Group, Loader, NavLink, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconChevronRight, IconMapPin } from '@tabler/icons-react';
import { VITRINA_URLS, vitrinaHref } from '../../lib/vitrina/constants';
import { presentacionesPorPais, type CatalogoItem } from '../../lib/vitrina/catalogo';
import type { CompanyAccess } from './types';
import VitrinaEnConstruccion from './VitrinaEnConstruccion';
import { catalogoUrl, useVitrinaFetch } from './vitrinaClient';

/** Presencia LATAM (fase 1: LISTA, sin mapa). Cada país abre la Biblioteca filtrada por ese país. */
export default function VitrinaPaises({ company }: { company: CompanyAccess }) {
  const { data, error, loading } = useVitrinaFetch<{ presentaciones: CatalogoItem[] }>(catalogoUrl(company.idCompany));
  const items = useMemo(() => data?.presentaciones ?? [], [data]);
  const paises = useMemo(() => presentacionesPorPais(items), [items]);
  const sinPais = useMemo(() => items.filter((p) => p.paises.length === 0).length, [items]);

  if (loading && !data) {
    return (
      <Group justify='center' py='xl'>
        <Loader />
      </Group>
    );
  }
  if (error) {
    return (
      <Alert color='red' icon={<IconAlertTriangle size={18} />}>
        {error}
      </Alert>
    );
  }
  if (items.length === 0) return <VitrinaEnConstruccion company={company} />;

  return (
    <Stack gap='md'>
      <Card withBorder radius='md' p={0} data-testid='vitrina-paises'>
        {paises.map((p, i) => (
          <NavLink
            key={p.pais}
            component={Link}
            href={vitrinaHref(VITRINA_URLS.biblioteca, company.idCompany, { pais: p.pais })}
            label={<Text fw={600}>{p.pais}</Text>}
            leftSection={<IconMapPin size={20} />}
            rightSection={
              <Group gap='xs' wrap='nowrap'>
                <Badge variant='light' size='lg'>
                  {p.presentaciones}
                </Badge>
                <IconChevronRight size={18} />
              </Group>
            }
            description={p.presentaciones === 1 ? '1 presentación' : `${p.presentaciones} presentaciones`}
            py='sm'
            style={i > 0 ? { borderTop: '1px solid var(--mantine-color-default-border)' } : undefined}
            data-testid='vitrina-pais'
          />
        ))}
        {paises.length === 0 && (
          <Text c='dimmed' p='md'>
            Aún no hay países registrados en los códigos de la Vitrina.
          </Text>
        )}
      </Card>
      {sinPais > 0 && (
        <Text size='sm' c='dimmed'>
          {sinPais === 1 ? '1 presentación no tiene' : `${sinPais} presentaciones no tienen`} país en sus códigos: la completa un administrador en Gestión.
        </Text>
      )}
    </Stack>
  );
}
