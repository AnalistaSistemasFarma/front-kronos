'use client';

import { Alert, Badge, Card, Loader, Table, Text } from '@mantine/core';
import { fmtFechaHora, useNabucoFetch, type NabucoCompany } from './client';

interface Corrida {
  id: number;
  config_nombre: string;
  status: string;
  detail: string | null;
  run_at: string;
}

/** Historial de corridas del programador central (scheduled_job_run) de las configs de la empresa. */
export default function NabucoCorridas({ company }: { company: NabucoCompany }) {
  const { data, error, loading } = useNabucoFetch<{ corridas: Corrida[] }>(`/api/transferencias-nabuco/corridas?company=${company.idCompany}`);
  if (loading) return <Loader />;
  if (error) return <Alert color='red'>{error}</Alert>;
  const corridas = data?.corridas ?? [];
  return (
    <Card shadow='sm' radius='md' withBorder p='md'>
      {corridas.length === 0 ? (
        <Text c='dimmed'>Aún no hay corridas registradas.</Text>
      ) : (
        <Table.ScrollContainer minWidth={700}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Fecha</Table.Th>
                <Table.Th>Configuración</Table.Th>
                <Table.Th>Estado</Table.Th>
                <Table.Th>Resumen</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {corridas.map((c) => (
                <Table.Tr key={c.id}>
                  <Table.Td>{fmtFechaHora(c.run_at)}</Table.Td>
                  <Table.Td>{c.config_nombre}</Table.Td>
                  <Table.Td>
                    <Badge color={c.status === 'ok' ? 'green' : 'red'} variant='light'>
                      {c.status === 'ok' ? 'Correcta' : 'Error'}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size='sm'>{c.detail ?? '—'}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Card>
  );
}
