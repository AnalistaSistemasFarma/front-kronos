'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Card, Group, Loader, Stack, Table, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { VITRINA_URLS, vitrinaHref } from '../../lib/vitrina/constants';
import { facetasCatalogo, filtrarCatalogo } from '../../lib/vitrina/catalogo';
import type { CompanyAccess } from './types';
import VitrinaEnConstruccion from './VitrinaEnConstruccion';
import VitrinaFiltros, { useFiltrosUrl } from './VitrinaFiltros';
import { catalogoUrl, useVitrinaFetch, type CatalogoResp } from './vitrinaClient';

/** Portafolio: lista densa (forma, nombre, concentración y unidades por caja). Cada fila abre la ficha. */
export default function VitrinaPortafolio({ company }: { company: CompanyAccess }) {
  const router = useRouter();
  const { data, error, loading } = useVitrinaFetch<CatalogoResp>(catalogoUrl(company.idCompany));
  const [filtros, setFiltros] = useFiltrosUrl();
  const items = useMemo(() => data?.presentaciones ?? [], [data]);
  const facetas = useMemo(() => facetasCatalogo(items, data?.orden), [items, data]);
  const filtradas = useMemo(() => filtrarCatalogo(items, filtros), [items, filtros]);

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
      <Text size='sm' c='dimmed'>
        {filtradas.length === items.length ? `${items.length} presentaciones` : `${filtradas.length} de ${items.length} presentaciones`}
      </Text>
      <Card withBorder radius='md' p={0}>
        <Table.ScrollContainer minWidth={480}>
          <Table striped highlightOnHover verticalSpacing='xs' horizontalSpacing='sm' fz='sm' data-testid='vitrina-portafolio'>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Forma</Table.Th>
                <Table.Th>Nombre</Table.Th>
                <Table.Th>Concentración</Table.Th>
                <Table.Th ta='right'>Unid./caja</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filtradas.map((p) => {
                const href = vitrinaHref(`${VITRINA_URLS.ficha}/${p.id}`, company.idCompany);
                return (
                  <Table.Tr
                    key={p.id}
                    onClick={() => router.push(href)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') router.push(href);
                    }}
                    tabIndex={0}
                    style={{ cursor: 'pointer' }}
                    aria-label={`Abrir la ficha de ${p.molecula}`}
                  >
                    <Table.Td>{p.formaFarmaceutica ?? '—'}</Table.Td>
                    <Table.Td>
                      <Text size='sm' fw={600}>
                        {p.molecula}
                      </Text>
                      {p.nombreComercial && (
                        <Text size='xs' c='dimmed'>
                          {p.nombreComercial}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>{p.concentracion ?? '—'}</Table.Td>
                    <Table.Td ta='right'>{p.unidadesCaja ?? '—'}</Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {filtradas.length === 0 && (
          <Text c='dimmed' p='md'>
            Ninguna presentación coincide con la búsqueda y los filtros.
          </Text>
        )}
      </Card>
    </Stack>
  );
}
