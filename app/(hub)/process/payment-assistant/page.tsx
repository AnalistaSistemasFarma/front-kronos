'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import {
  Loader,
  Alert,
  Table,
  Select,
  Badge,
  Group,
  Text,
  Title,
  Card,
  SimpleGrid,
  Stack,
  Button,
  Modal,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconAlertTriangle, IconInfoCircle, IconListDetails } from '@tabler/icons-react';

/**
 * Asistente de Pagos (multiempresa) — SOLO LECTURA.
 *
 * Selecciona una empresa a la que el usuario tenga acceso y muestra la propuesta
 * de pago: facturas de proveedor abiertas agrupadas por proveedor, con el total
 * pendiente y una marca para los proveedores sin datos bancarios. El navegador
 * NUNCA ve credenciales SAP: consume /api/payment-assistant/access y
 * /api/payment-assistant/proposal, que resuelven todo en el servidor.
 *
 * Esta primera version es solo de consulta: la simulacion y la ejecucion de
 * pagos (archivo DISFON, transmision) llegaran despues.
 */

interface CompanyAccess {
  idCompany: number;
  companyName: string;
  ready: boolean;
}

interface SupplierInvoice {
  docEntry: number;
  docNum: number;
  docDate: string;
  docDueDate: string;
  docTotal: number;
  paidToDate: number;
  pendingAmount: number;
  docCurrency: string;
}

interface SupplierGroup {
  cardCode: string;
  cardName: string;
  invoices: SupplierInvoice[];
  invoiceCount: number;
  totalPending: number;
  hasBankData: boolean;
}

interface Proposal {
  groups: SupplierGroup[];
  supplierCount: number;
  invoiceCount: number;
  grandTotalPending: number;
  suppliersMissingBank: string[];
}

const currency = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

/** Formato numérico con separador de miles es-CO (sin símbolo de moneda). */
const amount = new Intl.NumberFormat('es-CO', {
  maximumFractionDigits: 0,
});

/** Recorta un ISO/fecha SAP a YYYY-MM-DD. Devuelve '-' si viene vacío. */
function formatDate(value: string): string {
  if (!value) return '-';
  return value.slice(0, 10);
}

export default function PaymentAssistantPage() {
  const { data: session } = useSession();

  const [companies, setCompanies] = useState<CompanyAccess[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);

  const [loadingAccess, setLoadingAccess] = useState(true);
  const [loadingProposal, setLoadingProposal] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);

  // Proveedor cuyo detalle de facturas está abierto en el modal.
  const [detailGroup, setDetailGroup] = useState<SupplierGroup | null>(null);
  const [detailOpened, { open: openDetail, close: closeDetail }] = useDisclosure(false);

  const showDetail = (group: SupplierGroup) => {
    setDetailGroup(group);
    openDetail();
  };

  useEffect(() => {
    if (session) loadAccess();
  }, [session]);

  const loadAccess = async () => {
    try {
      setLoadingAccess(true);
      setAccessError(null);

      const res = await fetch('/api/payment-assistant/access');
      if (!res.ok) throw new Error('No se pudo verificar el acceso al modulo');
      const data = await res.json();
      const userCompanies: CompanyAccess[] = data.companies ?? [];
      setCompanies(userCompanies);

      if (userCompanies.length === 0) {
        setAccessError('No tiene acceso al Asistente de Pagos en ninguna empresa.');
      }
    } catch (err) {
      setAccessError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoadingAccess(false);
    }
  };

  const loadProposal = async (companyId: string) => {
    try {
      setLoadingProposal(true);
      setProposalError(null);
      setProposal(null);

      const res = await fetch(`/api/payment-assistant/proposal?companyId=${encodeURIComponent(companyId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo cargar la propuesta de pago');

      setProposal(data.proposal ?? null);
    } catch (err) {
      setProposalError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoadingProposal(false);
    }
  };

  const handleCompanyChange = (value: string | null) => {
    setSelectedCompany(value);
    if (value) loadProposal(value);
    else setProposal(null);
  };

  const companyOptions = useMemo(
    () =>
      companies
        .filter((c) => c.ready)
        .map((c) => ({ value: String(c.idCompany), label: c.companyName })),
    [companies]
  );

  if (loadingAccess) {
    return (
      <Group justify="center" mt="xl">
        <Loader />
      </Group>
    );
  }

  if (accessError) {
    return (
      <Alert color="red" title="Asistente de Pagos" mt="md">
        {accessError}
      </Alert>
    );
  }

  return (
    <div style={{ padding: '1rem' }}>
      <Group justify="space-between" align="center" mb="md">
        <Title order={2} style={{ margin: 0 }}>
          Asistente de Pagos
        </Title>
      </Group>

      <Alert color="blue" icon={<IconInfoCircle size={16} />} mb="md">
        Simulacion y ejecucion de pagos: proximamente. Esta vista es solo de consulta.
      </Alert>

      <Group mb="md">
        <Select
          placeholder="Seleccione una empresa"
          data={companyOptions}
          value={selectedCompany}
          onChange={handleCompanyChange}
          style={{ flex: '0 1 320px', minWidth: 220 }}
          nothingFoundMessage="Sin empresas disponibles"
        />
      </Group>

      {!selectedCompany && (
        <Text c="dimmed" mt="lg">
          Seleccione una empresa para ver su propuesta de pago.
        </Text>
      )}

      {loadingProposal && (
        <Group justify="center" mt="xl">
          <Loader />
        </Group>
      )}

      {proposalError && (
        <Alert color="red" icon={<IconAlertTriangle size={16} />} title="No se pudo cargar la propuesta" mt="md">
          {proposalError}
        </Alert>
      )}

      {!loadingProposal && !proposalError && selectedCompany && proposal && (
        <Stack gap="md">
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Card withBorder padding="md" radius="md">
              <Text size="xs" c="dimmed" tt="uppercase">
                Proveedores
              </Text>
              <Text size="xl" fw={700}>
                {proposal.supplierCount}
              </Text>
            </Card>
            <Card withBorder padding="md" radius="md">
              <Text size="xs" c="dimmed" tt="uppercase">
                Facturas abiertas
              </Text>
              <Text size="xl" fw={700}>
                {proposal.invoiceCount}
              </Text>
            </Card>
            <Card withBorder padding="md" radius="md">
              <Text size="xs" c="dimmed" tt="uppercase">
                Total pendiente
              </Text>
              <Text size="xl" fw={700}>
                {currency.format(proposal.grandTotalPending)}
              </Text>
            </Card>
          </SimpleGrid>

          {proposal.suppliersMissingBank.length > 0 && (
            <Alert color="yellow" icon={<IconAlertTriangle size={16} />}>
              {proposal.suppliersMissingBank.length} proveedor(es) sin datos bancarios. No podran
              incluirse en la dispersion de fondos hasta completar su cuenta.
            </Alert>
          )}

          <Table.ScrollContainer minWidth={640}>
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Proveedor</Table.Th>
                  <Table.Th>Codigo</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>N.° facturas</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Total pendiente</Table.Th>
                  <Table.Th>Banco</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Detalle</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {proposal.groups.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={6} style={{ textAlign: 'center' }}>
                      No hay facturas de proveedor abiertas para esta empresa.
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  proposal.groups.map((g) => (
                    <Table.Tr key={g.cardCode}>
                      <Table.Td>{g.cardName || '-'}</Table.Td>
                      <Table.Td>{g.cardCode}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{g.invoiceCount}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        {currency.format(g.totalPending)}
                      </Table.Td>
                      <Table.Td>
                        {g.hasBankData ? (
                          <Badge color="green" variant="light">
                            OK
                          </Badge>
                        ) : (
                          <Badge color="red" variant="light">
                            sin datos bancarios
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        <Button
                          size="xs"
                          variant="light"
                          leftSection={<IconListDetails size={14} />}
                          onClick={() => showDetail(g)}
                          disabled={(g.invoices?.length ?? 0) === 0}
                        >
                          Ver detalle
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))
                )}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Stack>
      )}

      <Modal
        opened={detailOpened}
        onClose={closeDetail}
        title={`Facturas de ${detailGroup?.cardName || detailGroup?.cardCode || ''}`}
        size="xl"
      >
        {detailGroup && (
          <Stack gap="sm">
            <Table.ScrollContainer minWidth={720}>
              <Table striped highlightOnHover withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>N.° factura</Table.Th>
                    <Table.Th>Fecha</Table.Th>
                    <Table.Th>Vencimiento</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>Total</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>Pagado</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>Pendiente</Table.Th>
                    <Table.Th>Moneda</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {detailGroup.invoices.map((inv) => (
                    <Table.Tr key={inv.docEntry}>
                      <Table.Td>{inv.docNum}</Table.Td>
                      <Table.Td>{formatDate(inv.docDate)}</Table.Td>
                      <Table.Td>{formatDate(inv.docDueDate)}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        {amount.format(inv.docTotal)}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        {amount.format(inv.paidToDate)}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        {amount.format(inv.pendingAmount)}
                      </Table.Td>
                      <Table.Td>{inv.docCurrency || '-'}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
                <Table.Tfoot>
                  <Table.Tr>
                    <Table.Td colSpan={5} style={{ textAlign: 'right', fontWeight: 700 }}>
                      Total pendiente
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right', fontWeight: 700 }}>
                      {amount.format(
                        detailGroup.invoices.reduce((sum, inv) => sum + inv.pendingAmount, 0)
                      )}
                    </Table.Td>
                    <Table.Td />
                  </Table.Tr>
                </Table.Tfoot>
              </Table>
            </Table.ScrollContainer>
          </Stack>
        )}
      </Modal>
    </div>
  );
}
