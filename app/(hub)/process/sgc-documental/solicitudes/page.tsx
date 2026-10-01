'use client';

import Link from 'next/link';
import { Alert, Badge, Button, Card, Table, Text, Title } from '@mantine/core';
import { IconAlertCircle, IconFilePlus, IconFileText } from '@tabler/icons-react';
import SgcShell from '../../../../../components/sgc/SgcShell';
import { formatDateCO } from '../../../../../components/sgc/tareas/format';
import { sgcHref } from '../../../../../components/sgc/useSgcCompany';
import { useSgcFetch } from '../../../../../components/sgc/useSgcFetch';
import { useSgcRowLink } from '../../../../../components/sgc/useSgcRowLink';
import type { SgcMyRequestRow } from '../../../../../lib/sgc/db/requests';
import { sgcStatusColor } from '../../../../../lib/sgc/flows/engine';
import type { SgcCompanyAccess } from '../../../../../lib/sgc/permissions';

/** Solicitudes documentales que la persona creó o elabora (Calidad: todas las de la empresa). */
function RequestList({ company }: { company: SgcCompanyAccess }) {
  const { data, error, loading } = useSgcFetch<{ requests: SgcMyRequestRow[] }>(`/api/sgc/requests?company=${company.idCompany}`);
  const rows = data?.requests ?? [];
  const rowLink = useSgcRowLink();
  return (
    <Card shadow='sm' radius='md' withBorder p='lg'>
      <Title order={3} mb='md' className='flex items-center gap-2'>
        <IconFileText size={20} />
        {company.canQuality ? 'Solicitudes documentales de la empresa' : 'Mis solicitudes documentales'}
      </Title>
      {error && (
        <Alert color='red' icon={<IconAlertCircle size={16} />} mb='md'>
          {error}
        </Alert>
      )}
      <div className='overflow-x-auto'>
        <Table striped highlightOnHover data-testid='sgc-solicitudes'>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>ID</Table.Th>
              <Table.Th>Asunto</Table.Th>
              <Table.Th>Tipo</Table.Th>
              <Table.Th>Paso actual</Table.Th>
              <Table.Th>Elaborador</Table.Th>
              <Table.Th>Estado</Table.Th>
              <Table.Th>Fecha</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={7}>
                  <Text c='dimmed' ta='center' py='lg'>
                    {loading ? 'Cargando…' : 'No hay solicitudes documentales.'}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              rows.map((r) => (
                <Table.Tr key={r.id} data-testid='sgc-solicitud-fila' {...rowLink(sgcHref(`/process/sgc-documental/solicitudes/${r.id}`, company.idCompany))}>
                  <Table.Td>
                    <Link href={sgcHref(`/process/sgc-documental/solicitudes/${r.id}`, company.idCompany)} className='font-bold text-blue-600'>
                      {r.id}
                    </Link>
                  </Table.Td>
                  <Table.Td>{r.subject}</Table.Td>
                  <Table.Td>{r.requestTypeLabel}</Table.Td>
                  <Table.Td>{r.currentTask ?? '—'}</Table.Td>
                  <Table.Td>{r.elaborator}</Table.Td>
                  <Table.Td>
                    <Badge variant='light' color={sgcStatusColor(r.statusLabel)} size='sm'>
                      {r.statusLabel}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{formatDateCO(r.createdAt, { month: 'short' })}</Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
      </div>
    </Card>
  );
}

export default function SgcRequestsPage() {
  return (
    <SgcShell
      section='Solicitudes documentales'
      subtitle='Nuevo documento, nueva versión o modificación, con su flujo de elaboración, revisión y aprobación.'
      actions={(company) =>
        company.canManage || company.canQuality ? (
          <Button component={Link} href={sgcHref('/process/sgc-documental/solicitudes/nueva', company.idCompany)} leftSection={<IconFilePlus size={16} />} data-testid='sgc-nueva-solicitud'>
            Nueva solicitud
          </Button>
        ) : null
      }
    >
      {(company) => <RequestList company={company} />}
    </SgcShell>
  );
}
