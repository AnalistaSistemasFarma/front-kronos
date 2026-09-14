'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import Link from 'next/link';
import {
  Title,
  Stack,
  Alert,
  Breadcrumbs,
  Anchor,
  Table,
  TextInput,
  NumberInput,
  Select,
  Switch,
  Button,
  Group,
  Badge,
  Modal,
  Grid,
  Card,
  Text,
  Divider,
  LoadingOverlay,
  ActionIcon,
  Collapse,
  Box,
  Flex,
  Loader,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconChevronRight,
  IconPlus,
  IconFilter,
  IconX,
  IconCheck,
  IconRefresh,
  IconFlag,
  IconClock,
  IconBuilding,
  IconCircleCheckFilled,
  IconCircleDot,
  IconDownload,
  IconDeviceLaptop,
  IconTag,
  IconUser,
  IconBarcode,
  IconPackage,
  IconArrowsExchange,
  IconCoin,
  IconCpu,
  IconDatabase,
  IconDeviceSdCard,
  IconCalendarEvent,
  IconMapPin,
  IconBrandWindows,
  IconDeviceMobile,
} from '@tabler/icons-react';
import toast from 'react-hot-toast';
import { sendMessage } from '../../../../../components/email/utils/sendMessage';

interface Asset {
  id: number;
  nombre: string;
  modelo: string;
  id_tipo_equipo: number;
  tipo_equipo: string;
  id_tipo_activo: number;
  tipo_activo: string;
  id_usuario: number;
  usuario: string;
  departamento: string;
  serial: string;
  etiqueta: string;
  procesador: string;
  ram: string;
  almacenamiento: string;
  id_estado_activo: number;
  estado: string;
  activo: 0 | 1 | boolean;
  costo_equipo: number | string;
  created_at?: string;
  empresa: string;
}

interface TypeAssetRow {
  id: number;
  tipo_activo: string;
}
interface SubtypeAssetRow {
  id: number;
  subtipo_activo: string;
  id_tipo_activo: number;
}
interface DepartmentRow {
  id: number;
  departamento: string;
}
interface UserAssetRow {
  id: number;
  nombre_usuario: string;
  cargo: string;
  cedula: string;
  correo: string;
  id_departamento: number;
}
interface StatusAssetRow {
  id: number;
  estado: string;
}
interface CompanyRow {
  id: number;
  empresa: string;
}
interface ConsultsResponse {
  types: TypeAssetRow[];
  subtypes: SubtypeAssetRow[];
  departments: DepartmentRow[];
  users: UserAssetRow[];
  companies: CompanyRow[];
  statuses?: StatusAssetRow[];
}

interface AssetFilters {
  serial: string;
  etiqueta: string;
  usuario: string;
  modelo: string;
  departamento: string;
  tipo_activo: string;
  tipo_equipo: string;
  procesador: string;
  ram: string;
  almacenamiento: string;
  estado: string;
  activo: string;
  empresa: string;
}

interface AssetFormData {
  nombre: string;
  modelo: string;
  serial: string;
  etiqueta: string;
  tipo_activo: string;
  tipo_equipo: string;
  usuario: string;
  procesador: string;
  ram: string;
  almacenamiento: string;
  estado: string;
  costo_equipo: number | string;
  activo: boolean;
  sitio: string;
  so: string;
  sim: string;
  fecha_compra: string;
  empresa: string;
}

const ASSET_STORAGE_KEY = 'selectedAsset';

const EMPTY_FILTERS: AssetFilters = {
  serial: '',
  etiqueta: '',
  usuario: '',
  modelo: '',
  departamento: '',
  tipo_activo: '',
  tipo_equipo: '',
  procesador: '',
  ram: '',
  almacenamiento: '',
  estado: '',
  activo: '',
  empresa: '',
};

const EMPTY_FORM: AssetFormData = {
  nombre: '',
  modelo: '',
  serial: '',
  etiqueta: '',
  tipo_activo: '',
  tipo_equipo: '',
  usuario: '',
  procesador: '',
  ram: '',
  almacenamiento: '',
  estado: '',
  costo_equipo: '',
  activo: true,
  sitio: '',
  so: '',
  sim: '',
  fecha_compra: '',
  empresa: '',
};

const DEFAULT_USER_ASSET_ID = 86;

const toOptions = (values: string[]) => values.map((v) => ({ value: v, label: v }));

const PROCESADORES = toOptions([
  'INTEL CORE I3',
  'INTEL CORE I5',
  'INTEL I5 5TA (MENOR)',
  'INTEL I5 6TA',
  'INTEL I5 7MA',
  'INTEL I5 8VA',
  'INTEL I5 10MA',
  'INTEL I5 11VA',
  'INTEL I5 12VA',
  'INTEL ULTRA I5',
  'INTEL ULTRA I5 2DA',
  'INTEL CORE I7',
  'INTEL I7 5TA (MENOR)',
  'INTEL I7 6TA',
  'INTEL I7 7MA',
  'INTEL I7 8VA',
  'INTEL I7 10MA',
  'INTEL I7 11VA',
  'INTEL I7 12VA',
  'INTEL ULTRA I7',
  'INTEL ULTRA I7 2DA',
  'AMD RYZEN 3',
  'AMD RYZEN 5',
  'AMD RYZEN 7',
  'APPLE MAC OS',
  'INTEL XEON SILVER',
  'NO APLICA',
]);

const RAM_OPTIONS = toOptions([
  '4 GB',
  '8 GB',
  '10 GB',
  '12 GB',
  '16 GB',
  '24 GB',
  '32 GB',
  '64 GB',
  '96 GB',
  'NO APLICA',
]);

const SITIOS = [
  { value: 'OFICINA PRINCIPAL FARMALOGICA', label: 'OFICINA PRINCIPAL FARMALOGICA' },
  { value: 'FARMALOGICA PLANTA', label: 'FARMALOGICA PLANTA' },
  { value: 'CELTA', label: 'CELTA' },
  { value: 'RYAN', label: 'OFICINA PRINCIPAL RYAN' },
  { value: 'GSS', label: 'OFICINA PRINCIPAL GSS' },
  { value: 'OLP', label: 'OFICINA PRINCIPAL OLP' },
  { value: 'ABAMIA', label: 'OFICINA PRINCIPAL ABAMIA' },
  { value: 'MEDITRACK', label: 'OFICINA PRINCIPAL MEDITRACK' },
];

const SISTEMAS_OPERATIVOS = [
  { value: 'Microsoft Windows 10 Pro', label: 'WINDOWS 10 PRO' },
  { value: 'Microsoft Windows 11 Pro', label: 'WINDOWS 11 PRO' },
  { value: 'MacOS', label: 'MACOS' },
  { value: 'NO APLICA', label: 'NO APLICA' },
];

const ALMACENAMIENTO_OPTIONS = toOptions([
  '32 GB',
  '64 GB',
  '128 GB',
  'SSD 256 GB',
  'SSD 500 GB',
  'SSD 1 TB',
  'HDD 500 GB',
  'HDD 1 TB',
  'NO APLICA',
]);

const ACTIVO_OPTIONS = [
  { value: '1', label: 'SI' },
  { value: '0', label: 'NO' },
];

const getAssetStatusColor = (estado: string) => {
  switch (estado?.toLowerCase()) {
    case 'en uso':
      return 'green';
    case 'stock':
      return 'blue';
    case 'en prestamo':
    case 'en préstamo':
      return 'orange';
    case 'baja':
      return 'gray';
    default:
      return 'gray';
  }
};

const getAssetStatusIcon = (estado: string) => {
  switch (estado?.toLowerCase()) {
    case 'en uso':
      return IconCircleCheckFilled;
    case 'stock':
      return IconPackage;
    case 'en prestamo':
    case 'en préstamo':
      return IconArrowsExchange;
    case 'baja':
      return IconX;
    default:
      return IconClock;
  }
};

const formatCurrency = (value: number | string | null | undefined) => {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  if (isNaN(n)) return '-';
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);
};

const isActive = (value: Asset['activo']) => value === 1 || value === true;

function AssetsBoard() {
  const { data: session, status } = useSession();
  const userName = session?.user?.name || '';
  const router = useRouter();

  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [typeOptions, setTypeOptions] = useState<TypeAssetRow[]>([]);
  const [subtypeOptions, setSubtypeOptions] = useState<SubtypeAssetRow[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<DepartmentRow[]>([]);
  const [userOptions, setUserOptions] = useState<UserAssetRow[]>([]);
  const [statusOptions, setStatusOptions] = useState<StatusAssetRow[]>([]);
  const [companyOptions, setCompanyOptions] = useState<CompanyRow[]>([]);
  const statusesFromApiRef = useRef(false);
  const [listsLoading, setListsLoading] = useState(false);

  const [filters, setFilters] = useState<AssetFilters>(EMPTY_FILTERS);
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const [modalOpened, setModalOpened] = useState(false);
  const [formData, setFormData] = useState<AssetFormData>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [createLoading, setCreateLoading] = useState(false);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/login');
      return;
    }
    fetchLists();
    fetchAssets();
  }, [session, status, router]);

  const fetchLists = async () => {
    try {
      setListsLoading(true);
      const response = await fetch('/api/assets/consults-assets');
      if (!response.ok) throw new Error('Failed to fetch asset lists');

      const data: ConsultsResponse = await response.json();
      setTypeOptions(Array.isArray(data.types) ? data.types : []);
      setSubtypeOptions(Array.isArray(data.subtypes) ? data.subtypes : []);
      setDepartmentOptions(Array.isArray(data.departments) ? data.departments : []);
      setUserOptions(Array.isArray(data.users) ? data.users : []);
      setCompanyOptions(Array.isArray(data.companies) ? data.companies : []);
      if (Array.isArray(data.statuses) && data.statuses.length > 0) {
        statusesFromApiRef.current = true;
        setStatusOptions(data.statuses);
      }
    } catch (err) {
      console.error('Error fetching asset lists:', err);
      toast.error('No se pudieron cargar las listas de activos.');
    } finally {
      setListsLoading(false);
    }
  };

  const fetchAssets = async (filtersToUse: AssetFilters = filters) => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      (Object.keys(filtersToUse) as (keyof AssetFilters)[]).forEach((key) => {
        const value = filtersToUse[key];
        if (!value) return;
        params.append(key, value);
      });

      const response = await fetch(`/api/assets?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch assets');

      const data = await response.json();
      const list: Asset[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.value)
          ? data.value
          : [];
      setAssets(list);

      if (!statusesFromApiRef.current) {
        setStatusOptions((prev) => {
          const map = new Map(prev.map((s) => [s.id, s]));
          list.forEach((a) => {
            if (a.id_estado_activo != null && a.estado && !map.has(a.id_estado_activo)) {
              map.set(a.id_estado_activo, { id: a.id_estado_activo, estado: a.estado });
            }
          });
          return Array.from(map.values()).sort((a, b) => a.estado.localeCompare(b.estado));
        });
      }
    } catch (err) {
      console.error('Error fetching assets:', err);
      setError('No se pudieron cargar los activos. Intente de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const typeSelectData = typeOptions.map((t) => ({ value: String(t.id), label: t.tipo_activo }));

  const subtypeSelectDataFor = (typeId: string) =>
    subtypeOptions
      .filter((s) => !typeId || String(s.id_tipo_activo) === typeId)
      .map((s) => ({ value: String(s.id), label: s.subtipo_activo }));

  const departmentSelectData = departmentOptions.map((d) => ({
    value: d.departamento,
    label: d.departamento,
  }));

  const userSelectData = userOptions.map((u) => ({
    value: String(u.id),
    label: u.cargo ? `${u.nombre_usuario} - ${u.cargo}` : u.nombre_usuario,
  }));

  const statusSelectData = statusOptions.map((s) => ({ value: String(s.id), label: s.estado }));

  const companySelectData = companyOptions.map((c) => ({
    value: String(c.id),
    label: c.empresa,
  }));

  const typeNameById = (id: string) => typeOptions.find((t) => String(t.id) === id)?.tipo_activo;

  const isCellphoneType =
    (typeNameById(formData.tipo_activo) ?? '').toUpperCase() === 'CELULARES';

  const findStatusId = (name: string) =>
    statusOptions.find((s) => s.estado?.toLowerCase() === name.toLowerCase())?.id;

  const handleFilterChange = (field: keyof AssetFilters, value: string) => {
    setFilters((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'tipo_activo') next.tipo_equipo = '';
      return next;
    });
  };

  const handleApplyFilters = async () => {
    await fetchAssets();
  };

  const handleClearFilters = async () => {
    setFilters(EMPTY_FILTERS);
    setError(null);
    await fetchAssets(EMPTY_FILTERS);
  };

  const filterByStatus = (statusId: string) => {
    const nf = { ...filters, estado: statusId };
    setFilters(nf);
    fetchAssets(nf);
  };

  const handleFormChange = <K extends keyof AssetFormData>(field: K, value: AssetFormData[K]) => {
    setFormData((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'tipo_activo') next.tipo_equipo = '';
      return next;
    });
    if (formErrors[field]) {
      setFormErrors((prev) => ({ ...prev, [field]: '' }));
    }
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};

    if (!formData.nombre.trim()) errors.nombre = 'El nombre es obligatorio';
    if (!formData.serial.trim()) errors.serial = 'El serial es obligatorio';
    if (!formData.modelo.trim()) errors.modelo = 'El modelo es obligatorio';
    if (!formData.tipo_activo) errors.tipo_activo = 'El tipo de activo es obligatorio';
    if (!formData.tipo_equipo) errors.tipo_equipo = 'El tipo de equipo es obligatorio';
    if (!formData.estado) errors.estado = 'El estado es obligatorio';
    if (!formData.empresa) errors.empresa = 'La empresa es obligatoria';
    if (!formData.sitio) errors.sitio = 'El sitio es obligatorio';
    if (!formData.fecha_compra) errors.fecha_compra = 'La fecha de compra es obligatoria';
    if (!(Number(formData.costo_equipo) > 0)) {
      errors.costo_equipo = 'El costo debe ser mayor a 0';
    }
    // La simcard solo aplica (y es obligatoria) para el tipo de activo CELULARES.
    if (isCellphoneType && !formData.sim.trim()) {
      errors.sim = 'La simcard es obligatoria para celulares';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const closeModal = () => {
    setModalOpened(false);
    setError(null);
    setFormData(EMPTY_FORM);
    setFormErrors({});
  };

  // Aviso por correo de activo creado. Nunca bloquea ni revierte la creación.
  const notifyAssetCreated = async (created: AssetFormData) => {
    const emails = process.env.SENDEMAILCREATEASSET;
    if (!emails) {
      console.warn(
        'SENDEMAILCREATEASSET no está configurada; se omite la notificación de activo creado.'
      );
      return;
    }

    try {
      const tipoActivo = typeNameById(created.tipo_activo) ?? '';
      const tipoEquipo =
        subtypeOptions.find((s) => String(s.id) === created.tipo_equipo)?.subtipo_activo ?? '';

      const table: Array<Record<string, string | number | undefined>> = [
        {
          'Tipo de Activo': tipoActivo,
          'Tipo de Equipo': tipoEquipo,
          Serial: created.serial.trim(),
          Modelo: created.modelo.trim(),
          'Creado por': userName,
        },
      ];

      await sendMessage(
        `Se ha creado un nuevo activo: ${created.serial.trim()}`,
        emails,
        table,
        'Este es un mensaje automático del módulo de Activos. Si tiene alguna pregunta, contacte al administrador del sistema.',
        'https://farmalogica.com.co/imagenes/logos/logo20.png',
        []
      );
    } catch (err) {
      console.error('Error al enviar la notificación de activo creado:', err);
    }
  };

  const handleCreateAsset = async () => {
    if (isSubmittingRef.current) return;
    if (!validateForm()) return;
    isSubmittingRef.current = true;

    try {
      setCreateLoading(true);
      setError(null);

      // TODO backend: POST /api/assets (columnas de la tabla assets).
      // nombretecnico y fechaLog los usa el backend para registrar el primer log.
      const response = await fetch('/api/assets/create_asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.nombre.trim(),
          model: formData.modelo.trim(),
          serial: formData.serial.trim(),
          label: formData.etiqueta.trim(),
          id_subtype_asset: Number(formData.tipo_equipo),
          id_user_asset: Number(formData.usuario) || DEFAULT_USER_ASSET_ID,
          id_status_asset: Number(formData.estado),
          id_company_asset: Number(formData.empresa),
          processor: formData.procesador,
          ram: formData.ram,
          storage: formData.almacenamiento,
          os: formData.so,
          site: formData.sitio,
          equipment_cost: Number(formData.costo_equipo) || 0,
          active: formData.activo ? 1 : 0,
          purchaseDate: formData.fecha_compra || null,
          sim: isCellphoneType ? formData.sim.trim() : '',
          nombretecnico: userName,
          fechaLog: new Date().toISOString().split('T')[0],
        }),
      });

      if (!response.ok) {
        let detail = '';
        try {
          const errorData = await response.json();
          detail = errorData.error || '';
        } catch {}
        console.error('Fallo al crear el activo:', detail);
        setError(detail || 'No se pudo crear el activo. Intente de nuevo.');
        toast.error(detail || 'No se pudo crear el activo. Intente de nuevo.');
        return;
      }

      toast.success('Activo creado correctamente.');
      // La notificación no bloquea la creación: si falla, el activo ya quedó creado.
      notifyAssetCreated(formData);
      closeModal();
      fetchAssets();
    } catch (err) {
      console.error('Error de red al crear el activo:', err);
      setError('No se pudo crear el activo. Intente de nuevo.');
      toast.error('No se pudo crear el activo. Intente de nuevo.');
    } finally {
      setCreateLoading(false);
      isSubmittingRef.current = false;
    }
  };

  // -------------------------------------------------------------------------
  // Exportar
  // -------------------------------------------------------------------------
  async function exportToExcel() {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Activos');

    const columns: { key: keyof Asset; header: string }[] = [
      { key: 'id', header: 'ID' },
      { key: 'nombre', header: 'Nombre' },
      { key: 'modelo', header: 'Modelo' },
      { key: 'tipo_activo', header: 'Tipo Activo' },
      { key: 'tipo_equipo', header: 'Tipo Equipo' },
      { key: 'serial', header: 'Serial' },
      { key: 'etiqueta', header: 'Etiqueta' },
      { key: 'usuario', header: 'Usuario' },
      { key: 'departamento', header: 'Departamento' },
      { key: 'empresa', header: 'Empresa' },
      { key: 'procesador', header: 'Procesador' },
      { key: 'ram', header: 'RAM' },
      { key: 'almacenamiento', header: 'Almacenamiento' },
      { key: 'estado', header: 'Estado' },
      { key: 'activo', header: 'Activo' },
      { key: 'costo_equipo', header: 'Costo' },
      { key: 'created_at', header: 'Fecha de compra' },
    ];

    worksheet.columns = columns;
    assets.forEach((asset) =>
      worksheet.addRow({ ...asset, activo: isActive(asset.activo) ? 'SI' : 'NO' })
    );

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    saveAs(blob, 'InformeActivos.xlsx');
  }

  // -------------------------------------------------------------------------
  // Derivados
  // -------------------------------------------------------------------------
  const totalCost = assets.reduce((sum, a) => {
    const n = parseFloat(String(a.costo_equipo));
    return sum + (isNaN(n) ? 0 : n);
  }, 0);

  const countByEstado = (estado: string) =>
    assets.filter((a) => a.estado?.toLowerCase() === estado.toLowerCase()).length;

  const openAssetDetail = (asset: Asset) => {
    sessionStorage.setItem(ASSET_STORAGE_KEY, JSON.stringify(asset));
    router.push(`/process/help-desk/view-asset?id=${asset.id}`);
  };

  const breadcrumbItems = [
    { title: 'Procesos', href: '/process' },
    { title: 'Mesa de Ayuda', href: '#' },
    { title: 'Activos', href: '#' },
  ].map((item, index) =>
    item.href !== '#' ? (
      <Link key={index} href={item.href} passHref>
        <Anchor component='span' className='hover:text-blue-600 transition-colors'>
          {item.title}
        </Anchor>
      </Link>
    ) : (
      <Text key={index} component='span' c='dimmed'>
        {item.title}
      </Text>
    )
  );

  // Las tarjetas por estado filtran por ID de estado (contrato del API).
  const statusCard = (label: string, estadoName: string, color: string, Icon: typeof IconCheck) => {
    const id = findStatusId(estadoName);
    return {
      label,
      value: countByEstado(estadoName),
      color,
      Icon,
      statusId: id !== undefined ? String(id) : undefined,
    };
  };

  const summaryCards: {
    label: string;
    value: string | number;
    color: string;
    Icon: typeof IconDeviceLaptop;
    statusId?: string;
  }[] = [
    { label: 'Total de Activos', value: assets.length, color: 'blue', Icon: IconDeviceLaptop, statusId: '' },
    statusCard('En Uso', 'En uso', 'green', IconCheck),
    statusCard('Stock', 'Stock', 'cyan', IconPackage),
    statusCard('En Prestamo', 'En prestamo', 'orange', IconArrowsExchange),
    { label: 'Costo Equipos', value: formatCurrency(totalCost), color: 'violet', Icon: IconCoin },
  ];

  if (status === 'loading' || loading) {
    return (
      <div
        style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}
        className='flex items-center justify-center'
      >
        <Group gap='sm'>
          <Loader size='sm' />
          <Text c='dimmed'>Cargando...</Text>
        </Group>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
        <Card shadow='sm' p='xl' radius='md' withBorder mb='6'>
          <Breadcrumbs separator={<IconChevronRight size={16} />} className='mb-4'>
            {breadcrumbItems}
          </Breadcrumbs>

          <Flex justify='space-between' align='center' mb='4'>
            <div>
              <Title order={1} className='text-3xl font-bold mb-2 flex items-center gap-3'>
                <IconDeviceLaptop size={32} className='text-blue-600' />
                Gestión de Activos
              </Title>
              <Text size='lg' c='dimmed'>
                Tablero para ver todos los activos
              </Text>
            </div>

            <Button
              onClick={() => setModalOpened(true)}
              size='lg'
              leftSection={<IconPlus size={18} />}
              className='bg-blue-600 hover:bg-blue-700'
            >
              Crear Activo
            </Button>
          </Flex>

          <Grid>
            {summaryCards.map((card) => {
              const clickable = card.statusId !== undefined;
              const active = clickable && filters.estado === card.statusId;
              return (
                <Grid.Col key={card.label} span={{ base: 12, sm: 6, md: 2 }}>
                  <Card
                    p='md'
                    radius='md'
                    withBorder
                    role={clickable ? 'button' : undefined}
                    aria-label={clickable ? `Filtrar por ${card.label}` : undefined}
                    onClick={clickable ? () => filterByStatus(card.statusId as string) : undefined}
                    style={{
                      cursor: clickable ? 'pointer' : 'default',
                      height: '100%',
                      backgroundColor: `var(--mantine-color-${card.color}-light)`,
                      borderColor: active
                        ? `var(--mantine-color-${card.color}-filled)`
                        : 'transparent',
                      borderWidth: 2,
                      transition: 'border-color 150ms ease',
                    }}
                  >
                    <Group wrap='nowrap'>
                      <card.Icon size={24} color={`var(--mantine-color-${card.color}-light-color)`} />
                      <div>
                        <Text size='xs' c={`var(--mantine-color-${card.color}-light-color)`}>
                          {card.label}
                        </Text>
                        <Text size='lg' fw={600}>
                          {card.value}
                        </Text>
                      </div>
                    </Group>
                  </Card>
                </Grid.Col>
              );
            })}

            <Grid.Col span={{ base: 12, sm: 6, md: 2 }}>
              <Card p='md' radius='md' withBorder style={{ height: '100%' }}>
                <Button
                  onClick={() => exportToExcel()}
                  fullWidth
                  h='100%'
                  leftSection={<IconDownload size={18} />}
                  className='bg-green-500 hover:bg-green-700'
                >
                  XLSX
                </Button>
              </Card>
            </Grid.Col>
          </Grid>
        </Card>

        {error && (
          <Alert
            icon={<IconAlertCircle size={20} />}
            title='Error'
            color='red'
            mb='md'
            className='border-red-200 bg-red-50'
          >
            {error}
          </Alert>
        )}

        <Card shadow='sm' p='lg' radius='md' withBorder mb='6'>
          <Group justify='space-between' mb='md'>
            <Title order={3} className='flex items-center gap-2'>
              <IconFilter size={20} />
              Filtros de Búsqueda
            </Title>
            <ActionIcon
              variant='subtle'
              onClick={() => setFiltersExpanded(!filtersExpanded)}
              aria-label={filtersExpanded ? 'Ocultar filtros' : 'Mostrar filtros'}
              data-testid='filter-toggle'
            >
              {filtersExpanded ? <IconX size={16} /> : <IconFilter size={16} />}
            </ActionIcon>
          </Group>

          <Collapse in={filtersExpanded}>
            <Box mt='md'>
              <Grid>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <TextInput
                    label='Serial'
                    placeholder='Ej: C17QK80C6940'
                    value={filters.serial}
                    onChange={(e) => handleFilterChange('serial', e.target.value)}
                    leftSection={<IconBarcode size={16} />}
                    data-testid='serial-filter'
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <TextInput
                    label='Etiqueta'
                    placeholder='Ej: POR001'
                    value={filters.etiqueta}
                    onChange={(e) => handleFilterChange('etiqueta', e.target.value)}
                    leftSection={<IconTag size={16} />}
                    data-testid='etiqueta-filter'
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Usuario'
                    placeholder='Todos los usuarios'
                    clearable
                    searchable
                    data={userSelectData}
                    value={filters.usuario || null}
                    onChange={(value) => handleFilterChange('usuario', value || '')}
                    disabled={listsLoading}
                    leftSection={<IconUser size={16} />}
                    data-testid='usuario-filter'
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <TextInput
                    label='Modelo'
                    placeholder='Ej: MACBOOK'
                    value={filters.modelo}
                    onChange={(e) => handleFilterChange('modelo', e.target.value)}
                    leftSection={<IconDeviceLaptop size={16} />}
                    data-testid='modelo-filter'
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Departamento'
                    placeholder='Todos los departamentos'
                    clearable
                    searchable
                    data={departmentSelectData}
                    value={filters.departamento || null}
                    onChange={(value) => handleFilterChange('departamento', value || '')}
                    disabled={listsLoading}
                    leftSection={<IconBuilding size={16} />}
                    data-testid='departamento-filter'
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Tipo Activo'
                    placeholder='Todos los tipos'
                    clearable
                    searchable
                    data={typeSelectData}
                    value={filters.tipo_activo || null}
                    onChange={(value) => handleFilterChange('tipo_activo', value || '')}
                    disabled={listsLoading}
                    leftSection={<IconDeviceLaptop size={16} />}
                    data-testid='tipo_activo-filter'
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Tipo Equipo'
                    placeholder={
                      filters.tipo_activo ? 'Todos los equipos' : 'Seleccione un tipo de activo'
                    }
                    clearable
                    searchable
                    data={subtypeSelectDataFor(filters.tipo_activo)}
                    value={filters.tipo_equipo || null}
                    onChange={(value) => handleFilterChange('tipo_equipo', value || '')}
                    disabled={!filters.tipo_activo || listsLoading}
                    leftSection={<IconTag size={16} />}
                    data-testid='tipo_equipo-filter'
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Procesador'
                    placeholder='Todos los procesadores'
                    clearable
                    data={PROCESADORES}
                    value={filters.procesador || null}
                    onChange={(value) => handleFilterChange('procesador', value || '')}
                    leftSection={<IconCpu size={16} />}
                    data-testid='procesador-filter'
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Memoria RAM'
                    placeholder='Todas'
                    clearable
                    data={RAM_OPTIONS}
                    value={filters.ram || null}
                    onChange={(value) => handleFilterChange('ram', value || '')}
                    leftSection={<IconDeviceSdCard size={16} />}
                    data-testid='ram-filter'
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Almacenamiento'
                    placeholder='Todos'
                    clearable
                    data={ALMACENAMIENTO_OPTIONS}
                    value={filters.almacenamiento || null}
                    onChange={(value) => handleFilterChange('almacenamiento', value || '')}
                    leftSection={<IconDatabase size={16} />}
                    data-testid='almacenamiento-filter'
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Estado'
                    placeholder='Todos los estados'
                    clearable
                    data={statusSelectData}
                    value={filters.estado || null}
                    onChange={(value) => handleFilterChange('estado', value || '')}
                    leftSection={<IconFlag size={16} />}
                    data-testid='estado-filter'
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Activo'
                    placeholder='Todos'
                    clearable
                    data={ACTIVO_OPTIONS}
                    value={filters.activo || null}
                    onChange={(value) => handleFilterChange('activo', value || '')}
                    leftSection={<IconCircleDot size={16} />}
                    data-testid='activo-filter'
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                  <Select
                    label='Empresa'
                    placeholder='Todas las empresas'
                    clearable
                    searchable
                    data={companySelectData}
                    value={filters.empresa || null}
                    onChange={(value) => handleFilterChange('empresa', value || '')}
                    disabled={listsLoading}
                    leftSection={<IconBuilding size={16} />}
                    data-testid='empresa-filter'
                  />
                </Grid.Col>
              </Grid>

              <Group justify='flex-end' mt='md'>
                <Button
                  variant='outline'
                  onClick={handleClearFilters}
                  leftSection={<IconX size={16} />}
                  data-testid='clear-filters'
                >
                  Limpiar Filtros
                </Button>
                <Button
                  onClick={handleApplyFilters}
                  leftSection={<IconRefresh size={16} />}
                  data-testid='apply-filters'
                >
                  Aplicar Filtros
                </Button>
              </Group>
            </Box>
          </Collapse>
        </Card>

        <Card shadow='sm' radius='md' withBorder className='overflow-hidden'>
          <LoadingOverlay visible={loading} />

          <Group justify='space-between' mb='md'>
            <Title order={3} className='flex items-center gap-2'>
              <IconDeviceLaptop size={20} />
              Lista de Activos
            </Title>
            <Badge variant='light' size='lg'>
              {assets.length} registros
            </Badge>
          </Group>

          <div className='overflow-x-auto'>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Activo</Table.Th>
                  <Table.Th>Tipo</Table.Th>
                  <Table.Th>Usuario Asignado</Table.Th>
                  <Table.Th>Identificación</Table.Th>
                  <Table.Th>Estado</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Costo</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {assets.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={6} className='text-center py-12 text-gray-500'>
                      <div className='flex flex-col items-center gap-3'>
                        <IconDeviceLaptop size={48} className='text-gray-300' />
                        <Text size='lg' fw={500}>
                          No se encontraron activos
                        </Text>
                        <Text size='sm' c='gray.5'>
                          Intenta ajustar los filtros o crea un nuevo activo
                        </Text>
                      </div>
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  assets.map((asset) => {
                    const StatusIcon = getAssetStatusIcon(asset.estado);
                    return (
                      <Table.Tr
                        key={asset.id}
                        className='cursor-pointer transition-colors'
                        onClick={() => openAssetDetail(asset)}
                      >
                        <Table.Td style={{ minWidth: 200 }}>
                          <Text size='sm' fw={700}>
                            {asset.modelo || '-'}
                          </Text>
                          <Text size='xs' c='dimmed'>
                            {asset.nombre} - {asset.empresa || '-'}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={4} wrap='nowrap'>
                            <IconTag size={14} className='text-gray-400' />
                            <Text size='sm' fw={500}>
                              {asset.tipo_activo}
                            </Text>
                          </Group>
                          <Text size='xs' c='dimmed'>
                            {asset.tipo_equipo}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Stack gap={2}>
                            <Group gap={4} wrap='nowrap'>
                              <IconUser size={14} className='text-gray-400' />
                              <Text size='sm' fw={500}>
                                {asset.usuario || '-'}
                              </Text>
                            </Group>
                            <Group gap={4} wrap='nowrap'>
                              <IconBuilding size={14} className='text-gray-400' />
                              <Text size='xs' c='dimmed'>
                                {asset.departamento || '-'}
                              </Text>
                            </Group>
                          </Stack>
                        </Table.Td>
                        <Table.Td style={{ whiteSpace: 'nowrap' }}>
                          <Text size='xs'>
                            <Text span fw={600}>
                              Serial:{' '}
                            </Text>
                            {asset.serial || '-'}
                          </Text>
                          <Text size='xs'>
                            <Text span fw={600}>
                              Etiqueta:{' '}
                            </Text>
                            {asset.etiqueta || '-'}
                          </Text>
                        </Table.Td>
                        <Table.Td style={{ whiteSpace: 'nowrap' }}>
                          <Stack gap={4} align='flex-start'>
                            <Badge
                              color={getAssetStatusColor(asset.estado)}
                              variant='light'
                              size='sm'
                              leftSection={<StatusIcon size={12} />}
                              styles={{ label: { overflow: 'visible' } }}
                            >
                              {asset.estado}
                            </Badge>
                            {!isActive(asset.activo) && (
                              <Badge color='red' variant='outline' size='xs'>
                                Inactivo
                              </Badge>
                            )}
                          </Stack>
                        </Table.Td>
                        <Table.Td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <Text size='sm' fw={700}>
                            {formatCurrency(asset.costo_equipo)}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })
                )}
              </Table.Tbody>
            </Table>
          </div>
        </Card>

        <Modal
          opened={modalOpened}
          onClose={closeModal}
          title={
            <Group>
              <IconPlus size={20} />
              <Text size='lg' fw={600}>
                Crear Activo
              </Text>
            </Group>
          }
          size='70%'
          radius='md'
          overlayProps={{ blur: 4 }}
        >
          <LoadingOverlay visible={createLoading || listsLoading} />

          <Stack>
            <Text fw={600} c='blue.7' tt='uppercase' size='sm'>
              1. Identificación
            </Text>
            <Grid>
              <Grid.Col span={{ base: 12, md: 3 }}>
                <TextInput
                  label='Serial del equipo'
                  placeholder='Ej: C17QK80C6940'
                  value={formData.serial}
                  onChange={(e) => handleFormChange('serial', e.target.value)}
                  error={formErrors.serial}
                  required
                  maxLength={100}
                  leftSection={<IconBarcode size={16} />}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 3 }}>
                <TextInput
                  label='Nombre del activo'
                  placeholder='Ej: PORMACEDW'
                  value={formData.nombre}
                  onChange={(e) => handleFormChange('nombre', e.target.value)}
                  error={formErrors.nombre}
                  required
                  maxLength={254}
                  leftSection={<IconDeviceLaptop size={16} />}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 3 }}>
                <TextInput
                  label='Etiqueta'
                  placeholder='Ej: POR0013'
                  value={formData.etiqueta}
                  onChange={(e) => handleFormChange('etiqueta', e.target.value)}
                  maxLength={100}
                  leftSection={<IconTag size={16} />}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 3 }}>
                <TextInput
                  label='Modelo'
                  placeholder='Ej: MACBOOK AIR'
                  value={formData.modelo}
                  onChange={(e) => handleFormChange('modelo', e.target.value)}
                  error={formErrors.modelo}
                  required
                  maxLength={254}
                  leftSection={<IconDeviceLaptop size={16} />}
                />
              </Grid.Col>
            </Grid>

            <Divider />

            {/* 2. Categorización */}
            <Text fw={600} c='blue.7' tt='uppercase' size='sm'>
              2. Categorización
            </Text>
            <Grid>
              <Grid.Col span={{ base: 12, md: 3 }}>
                <Select
                  label='Tipo de activo'
                  placeholder='Seleccione el tipo'
                  data={typeSelectData}
                  searchable
                  value={formData.tipo_activo || null}
                  onChange={(value) => handleFormChange('tipo_activo', value || '')}
                  error={formErrors.tipo_activo}
                  required
                  leftSection={<IconDeviceLaptop size={16} />}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 3 }}>
                <Select
                  label='Tipo de equipo'
                  placeholder={
                    formData.tipo_activo ? 'Seleccione el equipo' : 'Primero seleccione el tipo'
                  }
                  data={subtypeSelectDataFor(formData.tipo_activo)}
                  searchable
                  value={formData.tipo_equipo || null}
                  onChange={(value) => handleFormChange('tipo_equipo', value || '')}
                  error={formErrors.tipo_equipo}
                  required
                  disabled={!formData.tipo_activo}
                  leftSection={<IconTag size={16} />}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 3 }}>
                <Select
                  label='Estado'
                  placeholder='Seleccione el estado'
                  data={statusSelectData}
                  value={formData.estado || null}
                  onChange={(value) => handleFormChange('estado', value || '')}
                  error={formErrors.estado}
                  required
                  leftSection={<IconFlag size={16} />}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 3 }}>
                <Switch
                  label='¿Activo?'
                  description='Vigente en el inventario'
                  mt='md'
                  checked={formData.activo}
                  onChange={(e) => handleFormChange('activo', e.currentTarget.checked)}
                />
              </Grid.Col>
            </Grid>

            <Divider />

            {/* 3. Especificaciones técnicas */}
            <Text fw={600} c='blue.7' tt='uppercase' size='sm'>
              3. Especificaciones Técnicas
            </Text>
            <Grid>
              <Grid.Col span={{ base: 12, md: 3 }}>
                <Select
                  label='Procesador'
                  placeholder='Seleccione'
                  data={PROCESADORES}
                  searchable
                  clearable
                  value={formData.procesador || null}
                  onChange={(value) => handleFormChange('procesador', value || '')}
                  leftSection={<IconCpu size={16} />}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 3 }}>
                <Select
                  label='Memoria RAM'
                  placeholder='Seleccione'
                  data={RAM_OPTIONS}
                  clearable
                  value={formData.ram || null}
                  onChange={(value) => handleFormChange('ram', value || '')}
                  leftSection={<IconDeviceSdCard size={16} />}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 3 }}>
                <Select
                  label='Almacenamiento'
                  placeholder='Seleccione'
                  data={ALMACENAMIENTO_OPTIONS}
                  clearable
                  value={formData.almacenamiento || null}
                  onChange={(value) => handleFormChange('almacenamiento', value || '')}
                  leftSection={<IconDatabase size={16} />}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 3 }}>
                <Select
                  label='Sistema operativo'
                  placeholder='Seleccione'
                  data={SISTEMAS_OPERATIVOS}
                  clearable
                  value={formData.so || null}
                  onChange={(value) => handleFormChange('so', value || '')}
                  leftSection={<IconBrandWindows size={16} />}
                />
              </Grid.Col>
            </Grid>

            <Divider />

            {/* 4. Adquisición y ubicación */}
            <Text fw={600} c='blue.7' tt='uppercase' size='sm'>
              4. Adquisición y Ubicación
            </Text>
            <Grid>
              <Grid.Col span={{ base: 12, md: 4 }}>
                <Select
                  label='Sitio'
                  placeholder='Seleccione el sitio'
                  data={SITIOS}
                  searchable
                  value={formData.sitio || null}
                  onChange={(value) => handleFormChange('sitio', value || '')}
                  error={formErrors.sitio}
                  required
                  leftSection={<IconMapPin size={16} />}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 4 }}>
                <TextInput
                  type='date'
                  label='Fecha de compra'
                  value={formData.fecha_compra}
                  onChange={(e) => handleFormChange('fecha_compra', e.target.value)}
                  error={formErrors.fecha_compra}
                  required
                  leftSection={<IconCalendarEvent size={16} />}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 4 }}>
                <NumberInput
                  label='Costo del equipo'
                  placeholder='1500000'
                  value={formData.costo_equipo}
                  onChange={(value) => handleFormChange('costo_equipo', value)}
                  error={formErrors.costo_equipo}
                  required
                  thousandSeparator='.'
                  decimalSeparator=','
                  decimalScale={0}
                  allowNegative={false}
                  hideControls
                  min={0}
                  leftSection={<IconCoin size={16} />}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 4 }}>
                <Select
                  label='Usuario asignado'
                  placeholder='Sin asignar'
                  description='Opcional. Si no se asigna queda sin usuario.'
                  data={userSelectData}
                  searchable
                  clearable
                  value={formData.usuario || null}
                  onChange={(value) => handleFormChange('usuario', value || '')}
                  leftSection={<IconUser size={16} />}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 4 }}>
                <Select
                  label='Empresa'
                  placeholder='Seleccione la empresa'
                  data={companySelectData}
                  searchable
                  value={formData.empresa || null}
                  onChange={(value) => handleFormChange('empresa', value || '')}
                  error={formErrors.empresa}
                  required
                  leftSection={<IconBuilding size={16} />}
                />
              </Grid.Col>
              {isCellphoneType && (
                <Grid.Col span={{ base: 12, md: 4 }}>
                  <TextInput
                    label='Simcard'
                    placeholder='1234567890'
                    value={formData.sim}
                    onChange={(e) => handleFormChange('sim', e.target.value)}
                    error={formErrors.sim}
                    required
                    maxLength={100}
                    leftSection={<IconDeviceMobile size={16} />}
                  />
                </Grid.Col>
              )}
            </Grid>

            <Divider />

            <Group justify='flex-end' gap='md'>
              <Button variant='outline' onClick={closeModal} size='md'>
                Cancelar
              </Button>
              <Button
                onClick={handleCreateAsset}
                loading={createLoading}
                disabled={createLoading}
                size='md'
                leftSection={<IconPlus size={16} />}
                className='bg-blue-600 hover:bg-blue-700'
              >
                Crear Activo
              </Button>
            </Group>
          </Stack>
        </Modal>
      </div>
    </div>
  );
}

export default function AssetsBoardPage() {
  return (
    <Suspense fallback={<div>Cargando...</div>}>
      <AssetsBoard />
    </Suspense>
  );
}
