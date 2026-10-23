'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Alert, Badge, Button, Card, Group, Loader, SimpleGrid, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconAlertTriangle, IconBooks, IconChevronRight, IconPresentation, IconSettings, IconStar, IconTable, IconWorld } from '@tabler/icons-react';
import { VITRINA_GESTION_NAME, VITRINA_GESTION_URL, VITRINA_URLS, vitrinaHref } from '../../lib/vitrina/constants';
import { destacadasDe, presentacionesPorPais, type CatalogoItem } from '../../lib/vitrina/catalogo';
import type { CompanyAccess } from './types';
import VitrinaEnConstruccion from './VitrinaEnConstruccion';
import VitrinaModoPresentacion from './VitrinaModoPresentacion';
import VitrinaTarjeta from './VitrinaTarjeta';
import { catalogoUrl, useVitrinaFetch } from './vitrinaClient';

/** Inicio del comercial: accesos (Biblioteca, Portafolio, Presencia LATAM) y hasta 3 destacadas. */
export default function VitrinaInicio({ company }: { company: CompanyAccess }) {
  const { data, error, loading } = useVitrinaFetch<{ presentaciones: CatalogoItem[] }>(catalogoUrl(company.idCompany));
  const [presentando, setPresentando] = useState(false);
  const items = useMemo(() => data?.presentaciones ?? [], [data]);
  const destacadas = useMemo(() => destacadasDe(items), [items]);
  const paises = useMemo(() => presentacionesPorPais(items).length, [items]);

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

  const accesos = [
    { href: VITRINA_URLS.biblioteca, icon: IconBooks, titulo: 'Biblioteca', texto: 'Presentaciones por familia, con buscador y filtros.', cuenta: `${items.length} presentaciones`, testid: 'vitrina-acceso-biblioteca' },
    { href: VITRINA_URLS.portafolio, icon: IconTable, titulo: 'Portafolio', texto: 'Lista completa: forma, nombre, concentración y unidades por caja.', cuenta: `${items.length} presentaciones`, testid: 'vitrina-acceso-portafolio' },
    { href: VITRINA_URLS.paises, icon: IconWorld, titulo: 'Presencia LATAM', texto: 'Países donde está el portafolio.', cuenta: `${paises} ${paises === 1 ? 'país' : 'países'}`, testid: 'vitrina-acceso-paises' },
  ];

  return (
    <Stack gap='lg'>
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing='md'>
        {accesos.map((a) => (
          <Card key={a.href} component={Link} href={vitrinaHref(a.href, company.idCompany)} withBorder radius='md' p='md' data-testid={a.testid}>
            <Group wrap='nowrap' align='flex-start' gap='md'>
              <ThemeIcon size={44} radius='md' variant='light'>
                <a.icon size={24} />
              </ThemeIcon>
              <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
                <Group justify='space-between' wrap='nowrap'>
                  <Text fw={700} size='lg'>
                    {a.titulo}
                  </Text>
                  <IconChevronRight size={18} color='var(--mantine-color-dimmed)' aria-hidden />
                </Group>
                <Text size='sm' c='dimmed'>
                  {a.texto}
                </Text>
                <Badge variant='light' color='gray' size='sm' mt={4}>
                  {a.cuenta}
                </Badge>
              </Stack>
            </Group>
          </Card>
        ))}
      </SimpleGrid>

      <Card withBorder radius='md' p='md'>
        <Group justify='space-between' wrap='wrap' gap='sm'>
          <div style={{ minWidth: 0 }}>
            <Text fw={600}>Modo presentación</Text>
            <Text size='sm' c='dimmed'>
              Pantalla completa para mostrar al cliente: solo lo que puede ver, sin códigos ni datos internos.
            </Text>
          </div>
          <Button size='md' leftSection={<IconPresentation size={18} />} onClick={() => setPresentando(true)} w={{ base: '100%', sm: 'auto' }} data-testid='vitrina-abrir-presentacion'>
            Presentar
          </Button>
        </Group>
      </Card>

      {destacadas.length > 0 && (
        <Stack gap='sm'>
          <Group gap='xs'>
            <IconStar size={20} aria-hidden />
            <Title order={2} size='h3'>
              Destacadas
            </Title>
          </Group>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing='md' data-testid='vitrina-destacadas'>
            {destacadas.map((p) => (
              <VitrinaTarjeta key={p.id} item={p} idCompany={company.idCompany} />
            ))}
          </SimpleGrid>
        </Stack>
      )}

      {company.canGestionar && (
        <Group>
          <Button component={Link} href={vitrinaHref(VITRINA_GESTION_URL, company.idCompany)} variant='subtle' leftSection={<IconSettings size={18} />}>
            Ir a {VITRINA_GESTION_NAME}
          </Button>
        </Group>
      )}

      <VitrinaModoPresentacion company={company} opened={presentando} onClose={() => setPresentando(false)} />
    </Stack>
  );
}
