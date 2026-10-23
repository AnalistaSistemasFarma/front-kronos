'use client';

import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Group, Loader, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconPresentation } from '@tabler/icons-react';
import { agruparPorFamilia, facetasCatalogo, filtrarCatalogo, type CatalogoItem } from '../../lib/vitrina/catalogo';
import type { CompanyAccess } from './types';
import VitrinaEnConstruccion from './VitrinaEnConstruccion';
import VitrinaFiltros, { useFiltrosUrl } from './VitrinaFiltros';
import VitrinaModoPresentacion from './VitrinaModoPresentacion';
import VitrinaTarjeta from './VitrinaTarjeta';
import { catalogoUrl, useVitrinaFetch } from './vitrinaClient';

/**
 * Biblioteca: presentaciones VALIDADAS con al menos un código activado, en estanterías por
 * familia. Buscador y filtros combinables; «Presentar» abre el modo presentación con los
 * mismos filtros.
 */
export default function VitrinaBiblioteca({ company }: { company: CompanyAccess }) {
  const { data, error, loading } = useVitrinaFetch<{ presentaciones: CatalogoItem[] }>(catalogoUrl(company.idCompany));
  const [filtros, setFiltros] = useFiltrosUrl();
  const [presentando, setPresentando] = useState(false);
  const items = useMemo(() => data?.presentaciones ?? [], [data]);
  const facetas = useMemo(() => facetasCatalogo(items), [items]);
  const filtradas = useMemo(() => filtrarCatalogo(items, filtros), [items, filtros]);
  const grupos = useMemo(() => agruparPorFamilia(filtradas), [filtradas]);

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
      <Card withBorder radius='md' p='md'>
        <VitrinaFiltros facetas={facetas} filtros={filtros} onChange={setFiltros} />
      </Card>
      <Group justify='space-between' wrap='wrap' gap='sm'>
        <Text size='sm' c='dimmed' data-testid='vitrina-resultados'>
          {filtradas.length === items.length ? `${items.length} presentaciones` : `${filtradas.length} de ${items.length} presentaciones`}
        </Text>
        <Button size='md' variant='light' leftSection={<IconPresentation size={18} />} onClick={() => setPresentando(true)} data-testid='vitrina-abrir-presentacion'>
          Presentar
        </Button>
      </Group>
      {grupos.length === 0 ? (
        <Card withBorder radius='md' p='lg'>
          <Text c='dimmed'>Ninguna presentación coincide con la búsqueda y los filtros.</Text>
        </Card>
      ) : (
        grupos.map((g) => (
          <Stack key={g.familia} gap='sm' data-testid='vitrina-familia'>
            <Group gap='xs'>
              <Title order={2} size='h4'>
                {g.familia}
              </Title>
              <Badge variant='light' color='gray' size='sm'>
                {g.items.length}
              </Badge>
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing='sm'>
              {g.items.map((p) => (
                <VitrinaTarjeta key={p.id} item={p} idCompany={company.idCompany} />
              ))}
            </SimpleGrid>
          </Stack>
        ))
      )}
      <VitrinaModoPresentacion company={company} opened={presentando} onClose={() => setPresentando(false)} filtros={filtros} />
    </Stack>
  );
}
