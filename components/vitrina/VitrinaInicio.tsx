'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ActionIcon, Alert, Anchor, Badge, Button, Card, Divider, Group, Loader, SimpleGrid, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconAlertTriangle, IconBooks, IconChevronRight, IconFirstAidKit, IconPill, IconPresentation, IconSettings, IconStar, IconTable, IconWorld } from '@tabler/icons-react';
import { VITRINA_GESTION_NAME, VITRINA_GESTION_URL, VITRINA_URLS, vitrinaHref } from '../../lib/vitrina/constants';
import { conteoPor, destacadasDe, presentacionesPorPais, type CatalogoFiltros, type ConteoCatalogo } from '../../lib/vitrina/catalogo';
import type { CompanyAccess } from './types';
import VitrinaEnConstruccion from './VitrinaEnConstruccion';
import VitrinaModoPresentacion from './VitrinaModoPresentacion';
import VitrinaTarjeta from './VitrinaTarjeta';
import { catalogoUrl, useVitrinaFetch, type CatalogoResp } from './vitrinaClient';

/**
 * Inicio del comercial: accesos (Biblioteca, Portafolio, Presencia LATAM), accesos rápidos «Por servicio»
 * y «Por grupo terapéutico» (cada uno abre la Biblioteca filtrada o el modo presentación de ese
 * servicio: p. ej. una reunión con los intensivistas → todo lo de UCI) y hasta 3 destacadas.
 * Solo la empresa del comercial.
 */
export default function VitrinaInicio({ company }: { company: CompanyAccess }) {
  const { data, error, loading } = useVitrinaFetch<CatalogoResp>(catalogoUrl(company.idCompany));
  const [presentando, setPresentando] = useState<CatalogoFiltros | null>(null);
  const items = useMemo(() => data?.presentaciones ?? [], [data]);
  const destacadas = useMemo(() => destacadasDe(items), [items]);
  const paises = useMemo(() => presentacionesPorPais(items).length, [items]);
  const porServicio = useMemo(() => conteoPor(items, 'area', data?.orden), [items, data]);
  const porGrupo = useMemo(() => conteoPor(items, 'grupo', data?.orden), [items, data]);

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
    { href: VITRINA_URLS.biblioteca, icon: IconBooks, titulo: 'Biblioteca', texto: 'Por familia, línea comercial, grupo terapéutico o servicio, con buscador y filtros.', cuenta: `${items.length} presentaciones`, testid: 'vitrina-acceso-biblioteca' },
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
          <Button size='md' leftSection={<IconPresentation size={18} />} onClick={() => setPresentando({})} w={{ base: '100%', sm: 'auto' }} data-testid='vitrina-abrir-presentacion'>
            Presentar
          </Button>
        </Group>
      </Card>

      {(porServicio.length > 0 || porGrupo.length > 0) && (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing='md'>
          {porServicio.length > 0 && (
            <AccesoRapido
              titulo='Por servicio'
              texto='Qué ofrecer en cada servicio del hospital.'
              icon={IconFirstAidKit}
              filas={porServicio}
              clave='area'
              agruparEn='grupo'
              idCompany={company.idCompany}
              onPresentar={(nombre) => setPresentando({ area: nombre })}
              testid='vitrina-por-servicio'
            />
          )}
          {porGrupo.length > 0 && (
            <AccesoRapido
              titulo='Por grupo terapéutico'
              texto='Antibióticos, analgésicos, sedación…'
              icon={IconPill}
              filas={porGrupo}
              clave='grupo'
              agruparEn='area'
              idCompany={company.idCompany}
              onPresentar={(nombre) => setPresentando({ grupo: nombre })}
              testid='vitrina-por-grupo'
            />
          )}
        </SimpleGrid>
      )}

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

      <VitrinaModoPresentacion company={company} opened={presentando !== null} onClose={() => setPresentando(null)} filtros={presentando ?? undefined} />
    </Stack>
  );
}

/** Máximo de filas visibles en cada acceso rápido; el resto, en la Biblioteca. */
const MAX_FILAS = 8;

function AccesoRapido({
  titulo,
  texto,
  icon: Icon,
  filas,
  clave,
  agruparEn,
  idCompany,
  onPresentar,
  testid,
}: {
  titulo: string;
  texto: string;
  icon: typeof IconPill;
  filas: ConteoCatalogo[];
  clave: 'area' | 'grupo';
  agruparEn: 'area' | 'grupo';
  idCompany: number;
  onPresentar: (nombre: string) => void;
  testid: string;
}) {
  return (
    <Card withBorder radius='md' p='md' data-testid={testid}>
      <Group gap='sm' wrap='nowrap' mb='xs'>
        <ThemeIcon size={36} radius='md' variant='light'>
          <Icon size={20} />
        </ThemeIcon>
        <div style={{ minWidth: 0 }}>
          <Text fw={700}>{titulo}</Text>
          <Text size='sm' c='dimmed'>
            {texto}
          </Text>
        </div>
      </Group>
      <Stack gap={0}>
        {filas.slice(0, MAX_FILAS).map((f, i) => (
          <div key={f.nombre}>
            {i > 0 && <Divider />}
            <Group justify='space-between' wrap='nowrap' gap='xs' py={6}>
              <Anchor
                component={Link}
                href={vitrinaHref(VITRINA_URLS.biblioteca, idCompany, { [clave]: f.nombre, agrupar: agruparEn })}
                underline='never'
                c='var(--mantine-color-text)'
                style={{ flex: 1, minWidth: 0, minHeight: 36, display: 'flex', alignItems: 'center' }}
                data-testid='vitrina-acceso-rapido'
              >
                <Group justify='space-between' wrap='nowrap' gap='xs' style={{ flex: 1, minWidth: 0 }}>
                  <Text fw={500} truncate>
                    {f.nombre}
                  </Text>
                  <Badge variant='light' color='gray' size='sm' style={{ flexShrink: 0 }}>
                    {f.presentaciones}
                  </Badge>
                </Group>
              </Anchor>
              <ActionIcon variant='subtle' size='lg' onClick={() => onPresentar(f.nombre)} aria-label={`Presentar ${f.nombre}`} title={`Presentar ${f.nombre}`}>
                <IconPresentation size={18} />
              </ActionIcon>
            </Group>
          </div>
        ))}
      </Stack>
      {filas.length > MAX_FILAS && (
        <Anchor component={Link} href={vitrinaHref(VITRINA_URLS.biblioteca, idCompany, { agrupar: clave })} size='sm' mt='xs'>
          Ver los {filas.length}
        </Anchor>
      )}
    </Card>
  );
}
