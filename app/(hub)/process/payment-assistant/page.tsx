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
  Code,
  ScrollArea,
  CopyButton,
  TextInput,
  Divider,
  Tabs,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconAlertTriangle,
  IconInfoCircle,
  IconListDetails,
  IconFileText,
  IconSettings,
  IconCopy,
  IconCheck,
  IconDeviceFloppy,
  IconBuildingBank,
  IconWorld,
} from '@tabler/icons-react';

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
  country: string;
  isForeign: boolean;
}

interface Proposal {
  groups: SupplierGroup[];
  nationalGroups: SupplierGroup[];
  foreignGroups: SupplierGroup[];
  supplierCount: number;
  invoiceCount: number;
  grandTotalPending: number;
  suppliersMissingBank: string[];
}

interface SimulateSummary {
  supplierCount: number;
  invoiceCount: number;
  grandTotalPending: number;
  detailCount: number;
  suppliersMissingBank: number;
}

interface SimulateResult {
  companyId: number;
  companyName: string;
  preview: string;
  warnings: string[];
  summary: SimulateSummary;
}

/** Configuración de dispersión (cabecera DISFON) editable desde el formulario. */
interface DispersionConfig {
  idCompany: number;
  cuentaDispersora: string;
  tipoCuenta: string;
  nit: string;
  tipoMovimiento: string;
  codigoCiudad: string;
  codigoOficina: string;
  tipoId: string;
  nombreEmpresa: string | null;
}

/** Estado del formulario de configuración (todos los campos como texto). */
interface ConfigForm {
  cuentaDispersora: string;
  tipoCuenta: string;
  nit: string;
  tipoMovimiento: string;
  codigoCiudad: string;
  codigoOficina: string;
  tipoId: string;
  nombreEmpresa: string;
}

const EMPTY_CONFIG_FORM: ConfigForm = {
  cuentaDispersora: '',
  tipoCuenta: '1',
  nit: '',
  tipoMovimiento: '002',
  codigoCiudad: '0000',
  codigoOficina: '000',
  tipoId: 'N',
  nombreEmpresa: '',
};

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

/** Monedas distintas presentes en las facturas de un proveedor. '-' si no hay. */
function groupCurrencies(group: SupplierGroup): string {
  const set = [...new Set(group.invoices.map((i) => i.docCurrency).filter(Boolean))];
  return set.length > 0 ? set.join(', ') : '-';
}

/** Resumen agregado de una colección de grupos (para el encabezado de cada pestaña). */
function summarize(groups: SupplierGroup[]) {
  return {
    supplierCount: groups.length,
    invoiceCount: groups.reduce((sum, g) => sum + g.invoiceCount, 0),
    totalPending: groups.reduce((sum, g) => sum + g.totalPending, 0),
    missingBank: groups.filter((g) => !g.hasBankData).map((g) => g.cardCode),
  };
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

  // --- Simulación DISFON --------------------------------------------------
  const [simOpened, { open: openSim, close: closeSim }] = useDisclosure(false);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [simResult, setSimResult] = useState<SimulateResult | null>(null);

  const runSimulation = async () => {
    if (!selectedCompany) return;
    try {
      openSim();
      setSimLoading(true);
      setSimError(null);
      setSimResult(null);

      const res = await fetch(
        `/api/payment-assistant/simulate?companyId=${encodeURIComponent(selectedCompany)}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo generar la simulacion');
      setSimResult(data as SimulateResult);
    } catch (err) {
      setSimError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setSimLoading(false);
    }
  };

  // --- Configuración de dispersión ---------------------------------------
  const [cfgOpened, { open: openCfg, close: closeCfg }] = useDisclosure(false);
  const [cfgLoading, setCfgLoading] = useState(false);
  const [cfgSaving, setCfgSaving] = useState(false);
  const [cfgForm, setCfgForm] = useState<ConfigForm>(EMPTY_CONFIG_FORM);
  const [cfgFeedback, setCfgFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(
    null
  );

  const setCfgField = (field: keyof ConfigForm, value: string) =>
    setCfgForm((prev) => ({ ...prev, [field]: value }));

  const openConfig = async () => {
    if (!selectedCompany) return;
    openCfg();
    setCfgFeedback(null);
    setCfgForm(EMPTY_CONFIG_FORM);
    try {
      setCfgLoading(true);
      const res = await fetch(
        `/api/payment-assistant/dispersion-config?companyId=${encodeURIComponent(selectedCompany)}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo cargar la configuracion');
      const cfg: DispersionConfig | null = data.config ?? null;
      if (cfg) {
        setCfgForm({
          cuentaDispersora: cfg.cuentaDispersora ?? '',
          tipoCuenta: cfg.tipoCuenta || '1',
          nit: cfg.nit ?? '',
          tipoMovimiento: cfg.tipoMovimiento || '002',
          codigoCiudad: cfg.codigoCiudad || '0000',
          codigoOficina: cfg.codigoOficina || '000',
          tipoId: cfg.tipoId || 'N',
          nombreEmpresa: cfg.nombreEmpresa ?? '',
        });
      }
    } catch (err) {
      setCfgFeedback({
        type: 'error',
        msg: err instanceof Error ? err.message : 'Error inesperado',
      });
    } finally {
      setCfgLoading(false);
    }
  };

  const saveConfig = async (): Promise<boolean> => {
    if (!selectedCompany) return false;
    try {
      setCfgSaving(true);
      setCfgFeedback(null);
      const res = await fetch('/api/payment-assistant/dispersion-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: Number(selectedCompany), ...cfgForm }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo guardar la configuracion');
      setCfgFeedback({ type: 'success', msg: 'Configuracion guardada correctamente.' });
      return true;
    } catch (err) {
      setCfgFeedback({
        type: 'error',
        msg: err instanceof Error ? err.message : 'Error inesperado',
      });
      return false;
    } finally {
      setCfgSaving(false);
    }
  };

  const saveConfigAndSimulate = async () => {
    const ok = await saveConfig();
    if (!ok) return;
    closeCfg();
    runSimulation();
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

  // Grupos nacionales vs exterior (el backend ya los clasifica; con fallback por
  // si un endpoint viejo aún no envía las colecciones separadas).
  const nationalGroups = useMemo<SupplierGroup[]>(
    () => proposal?.nationalGroups ?? proposal?.groups?.filter((g) => !g.isForeign) ?? [],
    [proposal]
  );
  const foreignGroups = useMemo<SupplierGroup[]>(
    () => proposal?.foreignGroups ?? proposal?.groups?.filter((g) => g.isForeign) ?? [],
    [proposal]
  );
  const nationalSummary = useMemo(() => summarize(nationalGroups), [nationalGroups]);
  const foreignSummary = useMemo(() => summarize(foreignGroups), [foreignGroups]);

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
        Los pagos se separan en <b>nacionales (a terceros)</b> —con simulacion DISFON y
        configuracion de dispersion— y <b>al exterior</b>, que van por otro medio (mecanismo en
        definicion). La simulacion es solo una previsualizacion: no ejecuta pagos ni escribe en SAP.
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
        <Tabs defaultValue="nacionales" keepMounted={false}>
          <Tabs.List mb="md">
            <Tabs.Tab value="nacionales" leftSection={<IconBuildingBank size={16} />}>
              Pagos nacionales (a terceros)
            </Tabs.Tab>
            <Tabs.Tab value="exterior" leftSection={<IconWorld size={16} />}>
              Pagos al exterior
            </Tabs.Tab>
          </Tabs.List>

          {/* --- Pestaña NACIONALES: flujo completo (propuesta + simular + config) --- */}
          <Tabs.Panel value="nacionales">
            <Stack gap="md">
              <Group>
                <Button
                  leftSection={<IconFileText size={16} />}
                  onClick={runSimulation}
                  disabled={nationalGroups.length === 0}
                >
                  Simular
                </Button>
                <Button
                  variant="default"
                  leftSection={<IconSettings size={16} />}
                  onClick={openConfig}
                >
                  Configuracion de dispersion
                </Button>
              </Group>

              <SimpleGrid cols={{ base: 1, sm: 3 }}>
                <Card withBorder padding="md" radius="md">
                  <Text size="xs" c="dimmed" tt="uppercase">
                    Proveedores
                  </Text>
                  <Text size="xl" fw={700}>
                    {nationalSummary.supplierCount}
                  </Text>
                </Card>
                <Card withBorder padding="md" radius="md">
                  <Text size="xs" c="dimmed" tt="uppercase">
                    Facturas abiertas
                  </Text>
                  <Text size="xl" fw={700}>
                    {nationalSummary.invoiceCount}
                  </Text>
                </Card>
                <Card withBorder padding="md" radius="md">
                  <Text size="xs" c="dimmed" tt="uppercase">
                    Total pendiente
                  </Text>
                  <Text size="xl" fw={700}>
                    {currency.format(nationalSummary.totalPending)}
                  </Text>
                </Card>
              </SimpleGrid>

              {nationalSummary.missingBank.length > 0 && (
                <Alert color="yellow" icon={<IconAlertTriangle size={16} />}>
                  {nationalSummary.missingBank.length} proveedor(es) sin datos bancarios. No podran
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
                    {nationalGroups.length === 0 ? (
                      <Table.Tr>
                        <Table.Td colSpan={6} style={{ textAlign: 'center' }}>
                          No hay pagos nacionales para esta empresa.
                        </Table.Td>
                      </Table.Tr>
                    ) : (
                      nationalGroups.map((g) => (
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
          </Tabs.Panel>

          {/* --- Pestaña EXTERIOR: listado read-only (sin DISFON) --- */}
          <Tabs.Panel value="exterior">
            <Stack gap="md">
              <Alert color="blue" icon={<IconInfoCircle size={16} />}>
                Los pagos al exterior van por otro medio (no DISFON). Mecanismo en definicion.
              </Alert>

              <SimpleGrid cols={{ base: 1, sm: 3 }}>
                <Card withBorder padding="md" radius="md">
                  <Text size="xs" c="dimmed" tt="uppercase">
                    Proveedores
                  </Text>
                  <Text size="xl" fw={700}>
                    {foreignSummary.supplierCount}
                  </Text>
                </Card>
                <Card withBorder padding="md" radius="md">
                  <Text size="xs" c="dimmed" tt="uppercase">
                    Facturas abiertas
                  </Text>
                  <Text size="xl" fw={700}>
                    {foreignSummary.invoiceCount}
                  </Text>
                </Card>
                <Card withBorder padding="md" radius="md">
                  <Text size="xs" c="dimmed" tt="uppercase">
                    Total pendiente
                  </Text>
                  <Text size="xl" fw={700}>
                    {currency.format(foreignSummary.totalPending)}
                  </Text>
                </Card>
              </SimpleGrid>

              <Table.ScrollContainer minWidth={640}>
                <Table striped highlightOnHover withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Proveedor</Table.Th>
                      <Table.Th>Codigo</Table.Th>
                      <Table.Th>Pais</Table.Th>
                      <Table.Th>Moneda</Table.Th>
                      <Table.Th style={{ textAlign: 'right' }}>N.° facturas</Table.Th>
                      <Table.Th style={{ textAlign: 'right' }}>Total pendiente</Table.Th>
                      <Table.Th style={{ textAlign: 'right' }}>Detalle</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {foreignGroups.length === 0 ? (
                      <Table.Tr>
                        <Table.Td colSpan={7} style={{ textAlign: 'center' }}>
                          No hay pagos al exterior para esta empresa.
                        </Table.Td>
                      </Table.Tr>
                    ) : (
                      foreignGroups.map((g) => (
                        <Table.Tr key={g.cardCode}>
                          <Table.Td>{g.cardName || '-'}</Table.Td>
                          <Table.Td>{g.cardCode}</Table.Td>
                          <Table.Td>{g.country || '-'}</Table.Td>
                          <Table.Td>{groupCurrencies(g)}</Table.Td>
                          <Table.Td style={{ textAlign: 'right' }}>{g.invoiceCount}</Table.Td>
                          <Table.Td style={{ textAlign: 'right' }}>
                            {currency.format(g.totalPending)}
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
          </Tabs.Panel>
        </Tabs>
      )}

      {/* Modal de SIMULACIÓN DISFON */}
      <Modal opened={simOpened} onClose={closeSim} title="Simulacion del archivo DISFON" size="xl">
        <Stack gap="md">
          <Alert color="blue" icon={<IconInfoCircle size={16} />}>
            Esta es una <b>simulacion</b>: se genera el archivo DISFON para previsualizarlo, pero{' '}
            <b>no se paga, no se guarda y no se envia nada al banco</b>.
          </Alert>

          {simLoading && (
            <Group justify="center" my="md">
              <Loader />
            </Group>
          )}

          {simError && (
            <Alert color="red" icon={<IconAlertTriangle size={16} />} title="No se pudo simular">
              {simError}
            </Alert>
          )}

          {!simLoading && !simError && simResult && (
            <>
              <SimpleGrid cols={{ base: 2, sm: 4 }}>
                <div>
                  <Text size="xs" c="dimmed" tt="uppercase">
                    Renglones
                  </Text>
                  <Text fw={700}>{simResult.summary.detailCount}</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed" tt="uppercase">
                    Proveedores
                  </Text>
                  <Text fw={700}>{simResult.summary.supplierCount}</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed" tt="uppercase">
                    Facturas
                  </Text>
                  <Text fw={700}>{simResult.summary.invoiceCount}</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed" tt="uppercase">
                    Total
                  </Text>
                  <Text fw={700}>{currency.format(simResult.summary.grandTotalPending)}</Text>
                </div>
              </SimpleGrid>

              {simResult.warnings.length > 0 && (
                <Alert
                  color="yellow"
                  icon={<IconAlertTriangle size={16} />}
                  title={`Validaciones (${simResult.warnings.length})`}
                >
                  <Stack gap={4}>
                    {simResult.warnings.map((w, i) => (
                      <Text key={i} size="sm">
                        • {w}
                      </Text>
                    ))}
                  </Stack>
                </Alert>
              )}

              <div>
                <Group justify="space-between" align="center" mb="xs">
                  <Text fw={600}>Vista previa del archivo DISFON</Text>
                  {simResult.preview && (
                    <CopyButton value={simResult.preview}>
                      {({ copied, copy }) => (
                        <Button
                          size="xs"
                          variant="light"
                          color={copied ? 'teal' : 'blue'}
                          leftSection={
                            copied ? <IconCheck size={14} /> : <IconCopy size={14} />
                          }
                          onClick={copy}
                        >
                          {copied ? 'Copiado' : 'Copiar'}
                        </Button>
                      )}
                    </CopyButton>
                  )}
                </Group>
                {simResult.preview ? (
                  <ScrollArea.Autosize mah={360} type="auto">
                    <Code block style={{ whiteSpace: 'pre', fontSize: 12 }}>
                      {simResult.preview}
                    </Code>
                  </ScrollArea.Autosize>
                ) : (
                  <Text c="dimmed" size="sm">
                    Sin contenido para previsualizar (revise las validaciones y la configuracion de
                    dispersion).
                  </Text>
                )}
              </div>
            </>
          )}
        </Stack>
      </Modal>

      {/* Modal de CONFIGURACIÓN DE DISPERSIÓN */}
      <Modal
        opened={cfgOpened}
        onClose={closeCfg}
        title="Configuracion de dispersion"
        size="lg"
      >
        <Stack gap="md">
          {cfgFeedback && (
            <Alert
              color={cfgFeedback.type === 'success' ? 'green' : 'red'}
              icon={
                cfgFeedback.type === 'success' ? (
                  <IconCheck size={16} />
                ) : (
                  <IconAlertTriangle size={16} />
                )
              }
            >
              {cfgFeedback.msg}
            </Alert>
          )}

          <Text size="sm" c="dimmed">
            Datos de la empresa dispersora para la cabecera del archivo DISFON. Se guardan en la
            base propia del Asistente (no en SAP).
          </Text>

          {cfgLoading ? (
            <Group justify="center" my="md">
              <Loader />
            </Group>
          ) : (
            <>
              <TextInput
                label="Cuenta dispersora"
                placeholder="Numero de cuenta"
                value={cfgForm.cuentaDispersora}
                onChange={(e) => setCfgField('cuentaDispersora', e.currentTarget.value)}
                required
              />
              <Group grow>
                <Select
                  label="Tipo de cuenta"
                  data={[
                    { value: '1', label: '1 - Corriente' },
                    { value: '2', label: '2 - Ahorros' },
                    { value: '5', label: '5 - Rotativo' },
                  ]}
                  value={cfgForm.tipoCuenta}
                  onChange={(v) => setCfgField('tipoCuenta', v || '1')}
                  allowDeselect={false}
                />
                <Select
                  label="Tipo de identificacion"
                  data={[
                    { value: 'N', label: 'N - NIT' },
                    { value: 'L', label: 'L - Cedula' },
                    { value: 'I', label: 'I - Extranjero' },
                  ]}
                  value={cfgForm.tipoId}
                  onChange={(v) => setCfgField('tipoId', v || 'N')}
                  allowDeselect={false}
                />
              </Group>
              <Group grow>
                <TextInput
                  label="NIT"
                  placeholder="NIT con digito de verificacion"
                  value={cfgForm.nit}
                  onChange={(e) => setCfgField('nit', e.currentTarget.value)}
                  required
                />
                <TextInput
                  label="Tipo de movimiento"
                  placeholder="002"
                  value={cfgForm.tipoMovimiento}
                  onChange={(e) => setCfgField('tipoMovimiento', e.currentTarget.value)}
                />
              </Group>
              <Group grow>
                <TextInput
                  label="Codigo de ciudad"
                  placeholder="0000"
                  value={cfgForm.codigoCiudad}
                  onChange={(e) => setCfgField('codigoCiudad', e.currentTarget.value)}
                />
                <TextInput
                  label="Codigo de oficina"
                  placeholder="000"
                  value={cfgForm.codigoOficina}
                  onChange={(e) => setCfgField('codigoOficina', e.currentTarget.value)}
                />
              </Group>
              <TextInput
                label="Nombre de la empresa"
                placeholder="Nombre de la empresa dispersora"
                value={cfgForm.nombreEmpresa}
                onChange={(e) => setCfgField('nombreEmpresa', e.currentTarget.value)}
              />

              <Divider />

              <Group justify="flex-end">
                <Button variant="default" onClick={closeCfg} disabled={cfgSaving}>
                  Cerrar
                </Button>
                <Button
                  leftSection={<IconDeviceFloppy size={16} />}
                  onClick={saveConfig}
                  loading={cfgSaving}
                >
                  Guardar
                </Button>
                <Button
                  variant="light"
                  leftSection={<IconFileText size={16} />}
                  onClick={saveConfigAndSimulate}
                  disabled={cfgSaving}
                >
                  Guardar y simular
                </Button>
              </Group>
            </>
          )}
        </Stack>
      </Modal>

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
