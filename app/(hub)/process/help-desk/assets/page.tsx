'use client';

import { useState, useEffect, useRef, Suspense, type CSSProperties } from 'react';
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
  Card,
  Text,
  Divider,
  LoadingOverlay,
  ActionIcon,
  Collapse,
  Box,
  Flex,
  Loader,
  ScrollArea,
  SimpleGrid,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
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

/** Grid fluido: se reacomoda por ancho real, no solo por breakpoints CSS. */
const FLUID_FIELD_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
  gap: 'var(--mantine-spacing-md)',
};

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
  // <768: teléfono real. <1100: tablet / “sitio de escritorio” en celular (~980px).
  // initialValue true = mobile-first (evita flash de tabla densa en celular).
  const isMobile = useMediaQuery('(max-width: 768px)', true);
  const useCardList = useMediaQuery('(max-width: 1100px)', true);

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
      <div className='max-w-7xl mx-auto py-4 px-3 sm:py-8 sm:px-6 lg:px-8'>
        <Card shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md' withBorder mb='md'>
          <Breadcrumbs separator={<IconChevronRight size={16} />} className='mb-4'>
            {breadcrumbItems}
          </Breadcrumbs>

          <Flex
            justify='space-between'
            align={{ base: 'stretch', sm: 'center' }}
            direction={{ base: 'column', sm: 'row' }}
            gap='md'
            mb='md'
          >
            <div style={{ minWidth: 0 }}>
              <Title
                order={1}
                className='flex items-center gap-2 sm:gap-3'
                style={{ fontSize: 'clamp(1.25rem, 4vw, 1.875rem)', lineHeight: 1.25 }}
              >
                <IconDeviceLaptop
                  size={isMobile ? 24 : 32}
                  className='text-blue-600'
                  style={{ flexShrink: 0 }}
                />
                Gestión de Activos
              </Title>
              <Text size={isMobile ? 'sm' : 'lg'} c='dimmed' mt={4}>
                Tablero para ver todos los activos
              </Text>
            </div>

            <Button
              onClick={() => setModalOpened(true)}
              size={isMobile ? 'md' : 'lg'}
              fullWidth={!!isMobile}
              leftSection={<IconPlus size={18} />}
              className='bg-blue-600 hover:bg-blue-700'
              style={{ flexShrink: 0, minHeight: 44 }}
            >
              Crear Activo
            </Button>
          </Flex>

          <SimpleGrid cols={{ base: 2, sm: 3, md: 6 }} spacing={{ base: 'xs', sm: 'md' }}>
            {summaryCards.map((card) => {
              const clickable = card.statusId !== undefined;
              const active = clickable && filters.estado === card.statusId;
              return (
                <Card
                  key={card.label}
                  p={{ base: 'sm', sm: 'md' }}
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
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <Group wrap='nowrap' gap='xs' align='flex-start'>
                    <card.Icon
                      size={isMobile ? 18 : 24}
                      color={`var(--mantine-color-${card.color}-light-color)`}
                      style={{ flexShrink: 0, marginTop: 2 }}
                    />
                    <div style={{ minWidth: 0 }}>
                      <Text
                        size='xs'
                        c={`var(--mantine-color-${card.color}-light-color)`}
                        style={{ lineHeight: 1.3 }}
                        lineClamp={2}
                      >
                        {card.label}
                      </Text>
                      <Text size={isMobile ? 'md' : 'lg'} fw={600} style={{ wordBreak: 'break-word' }}>
                        {card.value}
                      </Text>
                    </div>
                  </Group>
                </Card>
              );
            })}

            <Card p={{ base: 'sm', sm: 'md' }} radius='md' withBorder style={{ height: '100%' }}>
              <Button
                onClick={() => exportToExcel()}
                fullWidth
                h='100%'
                mih={44}
                leftSection={<IconDownload size={18} />}
                className='bg-green-500 hover:bg-green-700'
              >
                XLSX
              </Button>
            </Card>
          </SimpleGrid>
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

        <Card shadow='sm' p={{ base: 'md', sm: 'lg' }} radius='md' withBorder mb='md'>
          <Group justify='space-between' mb='md' wrap='nowrap'>
            <Title order={3} className='flex items-center gap-2' style={{ fontSize: 'clamp(1rem, 3vw, 1.25rem)' }}>
              <IconFilter size={20} style={{ flexShrink: 0 }} />
              Filtros de Búsqueda
            </Title>
            <ActionIcon
              variant='subtle'
              size='lg'
              onClick={() => setFiltersExpanded(!filtersExpanded)}
              aria-label={filtersExpanded ? 'Ocultar filtros' : 'Mostrar filtros'}
              data-testid='filter-toggle'
              style={{ minWidth: 44, minHeight: 44 }}
            >
              {filtersExpanded ? <IconX size={16} /> : <IconFilter size={16} />}
            </ActionIcon>
          </Group>

          <Collapse in={filtersExpanded}>
            <Box mt='md'>
              <div style={FLUID_FIELD_GRID}>
                <TextInput
                  label='Serial'
                  placeholder='Ej: C17QK80C6940'
                  value={filters.serial}
                  onChange={(e) => handleFilterChange('serial', e.target.value)}
                  leftSection={<IconBarcode size={16} />}
                  data-testid='serial-filter'
                  size='md'
                />
                <TextInput
                  label='Etiqueta'
                  placeholder='Ej: POR001'
                  value={filters.etiqueta}
                  onChange={(e) => handleFilterChange('etiqueta', e.target.value)}
                  leftSection={<IconTag size={16} />}
                  data-testid='etiqueta-filter'
                  size='md'
                />
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
                  size='md'
                  comboboxProps={{ withinPortal: true }}
                />
                <TextInput
                  label='Modelo'
                  placeholder='Ej: MACBOOK'
                  value={filters.modelo}
                  onChange={(e) => handleFilterChange('modelo', e.target.value)}
                  leftSection={<IconDeviceLaptop size={16} />}
                  data-testid='modelo-filter'
                  size='md'
                />
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
                  size='md'
                  comboboxProps={{ withinPortal: true }}
                />
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
                  size='md'
                  comboboxProps={{ withinPortal: true }}
                />
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
                  size='md'
                  comboboxProps={{ withinPortal: true }}
                />
                <Select
                  label='Procesador'
                  placeholder='Todos los procesadores'
                  clearable
                  data={PROCESADORES}
                  value={filters.procesador || null}
                  onChange={(value) => handleFilterChange('procesador', value || '')}
                  leftSection={<IconCpu size={16} />}
                  data-testid='procesador-filter'
                  size='md'
                  comboboxProps={{ withinPortal: true }}
                />
                <Select
                  label='Memoria RAM'
                  placeholder='Todas'
                  clearable
                  data={RAM_OPTIONS}
                  value={filters.ram || null}
                  onChange={(value) => handleFilterChange('ram', value || '')}
                  leftSection={<IconDeviceSdCard size={16} />}
                  data-testid='ram-filter'
                  size='md'
                  comboboxProps={{ withinPortal: true }}
                />
                <Select
                  label='Almacenamiento'
                  placeholder='Todos'
                  clearable
                  data={ALMACENAMIENTO_OPTIONS}
                  value={filters.almacenamiento || null}
                  onChange={(value) => handleFilterChange('almacenamiento', value || '')}
                  leftSection={<IconDatabase size={16} />}
                  data-testid='almacenamiento-filter'
                  size='md'
                  comboboxProps={{ withinPortal: true }}
                />
                <Select
                  label='Estado'
                  placeholder='Todos los estados'
                  clearable
                  data={statusSelectData}
                  value={filters.estado || null}
                  onChange={(value) => handleFilterChange('estado', value || '')}
                  leftSection={<IconFlag size={16} />}
                  data-testid='estado-filter'
                  size='md'
                  comboboxProps={{ withinPortal: true }}
                />
                <Select
                  label='Activo'
                  placeholder='Todos'
                  clearable
                  data={ACTIVO_OPTIONS}
                  value={filters.activo || null}
                  onChange={(value) => handleFilterChange('activo', value || '')}
                  leftSection={<IconCircleDot size={16} />}
                  data-testid='activo-filter'
                  size='md'
                  comboboxProps={{ withinPortal: true }}
                />
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
                  size='md'
                  comboboxProps={{ withinPortal: true }}
                />
              </div>

              <Flex
                justify='flex-end'
                direction={{ base: 'column-reverse', sm: 'row' }}
                gap='sm'
                mt='md'
              >
                <Button
                  variant='outline'
                  onClick={handleClearFilters}
                  leftSection={<IconX size={16} />}
                  data-testid='clear-filters'
                  fullWidth={!!isMobile}
                  mih={44}
                >
                  Limpiar Filtros
                </Button>
                <Button
                  onClick={handleApplyFilters}
                  leftSection={<IconRefresh size={16} />}
                  data-testid='apply-filters'
                  fullWidth={!!isMobile}
                  mih={44}
                >
                  Aplicar Filtros
                </Button>
              </Flex>
            </Box>
          </Collapse>
        </Card>

        <Card
          shadow='sm'
          radius='md'
          withBorder
          p={{ base: 'md', sm: 'lg' }}
          className='overflow-hidden'
        >
          <LoadingOverlay visible={loading} />

          <Group justify='space-between' mb='md' wrap='nowrap' gap='sm'>
            <Title
              order={3}
              className='flex items-center gap-2'
              style={{ fontSize: 'clamp(1rem, 3vw, 1.25rem)', minWidth: 0 }}
            >
              <IconDeviceLaptop size={20} style={{ flexShrink: 0 }} />
              Lista de Activos
            </Title>
            <Badge variant='light' size='lg' style={{ flexShrink: 0 }}>
              {assets.length} registros
            </Badge>
          </Group>

          {assets.length === 0 ? (
            <Stack align='center' gap='sm' py='xl'>
              <IconDeviceLaptop size={48} className='text-gray-300' />
              <Text size='lg' fw={500}>
                No se encontraron activos
              </Text>
              <Text size='sm' c='dimmed' ta='center' px='md'>
                Intenta ajustar los filtros o crea un nuevo activo
              </Text>
            </Stack>
          ) : useCardList ? (
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='sm'>
              {assets.map((asset) => {
                const StatusIcon = getAssetStatusIcon(asset.estado);
                return (
                  <Card
                    key={asset.id}
                    withBorder
                    radius='md'
                    padding='md'
                    role='button'
                    tabIndex={0}
                    aria-label={`Ver activo ${asset.modelo || asset.nombre}`}
                    onClick={() => openAssetDetail(asset)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openAssetDetail(asset);
                      }
                    }}
                    style={{
                      cursor: 'pointer',
                      WebkitTapHighlightColor: 'transparent',
                      transition: 'border-color 150ms ease, background-color 150ms ease',
                    }}
                  >
                    <Group justify='space-between' align='flex-start' wrap='nowrap' gap='sm' mb={8}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <Text fw={700} size='sm' lineClamp={1}>
                          {asset.modelo || '-'}
                        </Text>
                        <Text size='xs' c='dimmed' lineClamp={1}>
                          {asset.nombre} · {asset.empresa || '-'}
                        </Text>
                      </div>
                      <Text fw={700} size='sm' style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                        {formatCurrency(asset.costo_equipo)}
                      </Text>
                    </Group>

                    <Stack gap={6}>
                      <Group gap={6} wrap='nowrap'>
                        <IconTag size={14} className='text-gray-400' style={{ flexShrink: 0 }} />
                        <Text size='sm' lineClamp={1}>
                          {asset.tipo_activo}
                          {asset.tipo_equipo ? ` · ${asset.tipo_equipo}` : ''}
                        </Text>
                      </Group>
                      <Group gap={6} wrap='nowrap'>
                        <IconUser size={14} className='text-gray-400' style={{ flexShrink: 0 }} />
                        <Text size='sm' lineClamp={1}>
                          {asset.usuario || 'Sin asignar'}
                          {asset.departamento ? ` · ${asset.departamento}` : ''}
                        </Text>
                      </Group>
                      <Group gap={6} wrap='nowrap'>
                        <IconBarcode size={14} className='text-gray-400' style={{ flexShrink: 0 }} />
                        <Text size='xs' c='dimmed' lineClamp={1}>
                          {asset.serial || '-'}
                          {asset.etiqueta ? ` · ${asset.etiqueta}` : ''}
                        </Text>
                      </Group>
                      <Group gap={6} mt={4}>
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
                      </Group>
                    </Stack>
                  </Card>
                );
              })}
            </SimpleGrid>
          ) : (
            <Box style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <Table striped highlightOnHover style={{ minWidth: 720 }}>
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
                  {assets.map((asset) => {
                    const StatusIcon = getAssetStatusIcon(asset.estado);
                    return (
                      <Table.Tr
                        key={asset.id}
                        className='cursor-pointer transition-colors'
                        onClick={() => openAssetDetail(asset)}
                      >
                        <Table.Td style={{ minWidth: 180 }}>
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
                        <Table.Td>
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
                        <Table.Td>
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
                  })}
                </Table.Tbody>
              </Table>
            </Box>
          )}
        </Card>

        <Modal
          opened={modalOpened}
          onClose={closeModal}
          title={
            <Group gap='xs' wrap='nowrap'>
              <IconPlus size={20} style={{ flexShrink: 0 }} />
              <Text size={isMobile ? 'md' : 'lg'} fw={600}>
                Crear Activo
              </Text>
            </Group>
          }
          fullScreen={!!isMobile}
          size='xl'
          centered={!isMobile}
          radius={isMobile ? 0 : 'md'}
          padding={isMobile ? 'md' : 'lg'}
          overlayProps={{ blur: 4 }}
          styles={{
            content: isMobile
              ? {
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                  maxHeight: '100dvh',
                }
              : { maxWidth: 920, width: 'min(920px, calc(100vw - 2rem))' },
            header: {
              flexShrink: 0,
              paddingBottom: 8,
              borderBottom: '1px solid var(--mantine-color-default-border)',
            },
            body: {
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              paddingTop: 12,
              paddingBottom: isMobile
                ? 'calc(12px + env(safe-area-inset-bottom, 0px))'
                : undefined,
            },
          }}
        >
          <LoadingOverlay visible={createLoading || listsLoading} />

          <ScrollArea
            type='auto'
            offsetScrollbars
            style={{ flex: 1, minHeight: 0 }}
            mah={isMobile ? undefined : 'min(70vh, 640px)'}
          >
            <Stack gap='md' pb='sm'>
              <Text fw={600} c='blue.7' tt='uppercase' size='xs'>
                1. Identificación
              </Text>
              <div style={FLUID_FIELD_GRID}>
                <TextInput
                  label='Serial del equipo'
                  placeholder='Ej: C17QK80C6940'
                  value={formData.serial}
                  onChange={(e) => handleFormChange('serial', e.target.value)}
                  error={formErrors.serial}
                  required
                  maxLength={100}
                  size='md'
                  leftSection={<IconBarcode size={16} />}
                />
                <TextInput
                  label='Nombre del activo'
                  placeholder='Ej: PORMACEDW'
                  value={formData.nombre}
                  onChange={(e) => handleFormChange('nombre', e.target.value)}
                  error={formErrors.nombre}
                  required
                  maxLength={254}
                  size='md'
                  leftSection={<IconDeviceLaptop size={16} />}
                />
                <TextInput
                  label='Etiqueta'
                  placeholder='Ej: POR0013'
                  value={formData.etiqueta}
                  onChange={(e) => handleFormChange('etiqueta', e.target.value)}
                  maxLength={100}
                  size='md'
                  leftSection={<IconTag size={16} />}
                />
                <TextInput
                  label='Modelo'
                  placeholder='Ej: MACBOOK AIR'
                  value={formData.modelo}
                  onChange={(e) => handleFormChange('modelo', e.target.value)}
                  error={formErrors.modelo}
                  required
                  maxLength={254}
                  size='md'
                  leftSection={<IconDeviceLaptop size={16} />}
                />
              </div>

              <Divider />

              <Text fw={600} c='blue.7' tt='uppercase' size='xs'>
                2. Categorización
              </Text>
              <div style={FLUID_FIELD_GRID}>
                <Select
                  label='Tipo de activo'
                  placeholder='Seleccione el tipo'
                  data={typeSelectData}
                  searchable
                  value={formData.tipo_activo || null}
                  onChange={(value) => handleFormChange('tipo_activo', value || '')}
                  error={formErrors.tipo_activo}
                  required
                  size='md'
                  leftSection={<IconDeviceLaptop size={16} />}
                  comboboxProps={{ withinPortal: true }}
                />
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
                  size='md'
                  leftSection={<IconTag size={16} />}
                  comboboxProps={{ withinPortal: true }}
                />
                <Select
                  label='Estado'
                  placeholder='Seleccione el estado'
                  data={statusSelectData}
                  value={formData.estado || null}
                  onChange={(value) => handleFormChange('estado', value || '')}
                  error={formErrors.estado}
                  required
                  size='md'
                  leftSection={<IconFlag size={16} />}
                  comboboxProps={{ withinPortal: true }}
                />
                <Box style={{ display: 'flex', alignItems: 'center', minHeight: 60 }}>
                  <Switch
                    label='¿Activo?'
                    description='Vigente en el inventario'
                    checked={formData.activo}
                    onChange={(e) => handleFormChange('activo', e.currentTarget.checked)}
                    size='md'
                  />
                </Box>
              </div>

              <Divider />

              <Text fw={600} c='blue.7' tt='uppercase' size='xs'>
                3. Especificaciones Técnicas
              </Text>
              <div style={FLUID_FIELD_GRID}>
                <Select
                  label='Procesador'
                  placeholder='Seleccione'
                  data={PROCESADORES}
                  searchable
                  clearable
                  value={formData.procesador || null}
                  onChange={(value) => handleFormChange('procesador', value || '')}
                  size='md'
                  leftSection={<IconCpu size={16} />}
                  comboboxProps={{ withinPortal: true }}
                />
                <Select
                  label='Memoria RAM'
                  placeholder='Seleccione'
                  data={RAM_OPTIONS}
                  clearable
                  value={formData.ram || null}
                  onChange={(value) => handleFormChange('ram', value || '')}
                  size='md'
                  leftSection={<IconDeviceSdCard size={16} />}
                  comboboxProps={{ withinPortal: true }}
                />
                <Select
                  label='Almacenamiento'
                  placeholder='Seleccione'
                  data={ALMACENAMIENTO_OPTIONS}
                  clearable
                  value={formData.almacenamiento || null}
                  onChange={(value) => handleFormChange('almacenamiento', value || '')}
                  size='md'
                  leftSection={<IconDatabase size={16} />}
                  comboboxProps={{ withinPortal: true }}
                />
                <Select
                  label='Sistema operativo'
                  placeholder='Seleccione'
                  data={SISTEMAS_OPERATIVOS}
                  clearable
                  value={formData.so || null}
                  onChange={(value) => handleFormChange('so', value || '')}
                  size='md'
                  leftSection={<IconBrandWindows size={16} />}
                  comboboxProps={{ withinPortal: true }}
                />
              </div>

              <Divider />

              <Text fw={600} c='blue.7' tt='uppercase' size='xs'>
                4. Adquisición y Ubicación
              </Text>
              <div style={FLUID_FIELD_GRID}>
                <Select
                  label='Sitio'
                  placeholder='Seleccione el sitio'
                  data={SITIOS}
                  searchable
                  value={formData.sitio || null}
                  onChange={(value) => handleFormChange('sitio', value || '')}
                  error={formErrors.sitio}
                  required
                  size='md'
                  leftSection={<IconMapPin size={16} />}
                  comboboxProps={{ withinPortal: true }}
                />
                <TextInput
                  type='date'
                  label='Fecha de compra'
                  value={formData.fecha_compra}
                  onChange={(e) => handleFormChange('fecha_compra', e.target.value)}
                  error={formErrors.fecha_compra}
                  required
                  size='md'
                  leftSection={<IconCalendarEvent size={16} />}
                />
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
                  size='md'
                  leftSection={<IconCoin size={16} />}
                />
                <Select
                  label='Usuario asignado'
                  placeholder='Sin asignar'
                  description='Opcional. Si no se asigna queda sin usuario.'
                  data={userSelectData}
                  searchable
                  clearable
                  value={formData.usuario || null}
                  onChange={(value) => handleFormChange('usuario', value || '')}
                  size='md'
                  leftSection={<IconUser size={16} />}
                  comboboxProps={{ withinPortal: true }}
                />
                <Select
                  label='Empresa'
                  placeholder='Seleccione la empresa'
                  data={companySelectData}
                  searchable
                  value={formData.empresa || null}
                  onChange={(value) => handleFormChange('empresa', value || '')}
                  error={formErrors.empresa}
                  required
                  size='md'
                  leftSection={<IconBuilding size={16} />}
                  comboboxProps={{ withinPortal: true }}
                />
                {isCellphoneType && (
                  <TextInput
                    label='Simcard'
                    placeholder='1234567890'
                    value={formData.sim}
                    onChange={(e) => handleFormChange('sim', e.target.value)}
                    error={formErrors.sim}
                    required
                    maxLength={100}
                    size='md'
                    leftSection={<IconDeviceMobile size={16} />}
                  />
                )}
              </div>
            </Stack>
          </ScrollArea>

          <Box
            pt='md'
            mt='xs'
            style={{
              flexShrink: 0,
              borderTop: '1px solid var(--mantine-color-default-border)',
              background: 'var(--mantine-color-body)',
            }}
          >
            <Flex
              gap='sm'
              direction={{ base: 'column-reverse', sm: 'row' }}
              justify='flex-end'
            >
              <Button
                variant='outline'
                onClick={closeModal}
                size='md'
                fullWidth={!!isMobile}
                mih={44}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleCreateAsset}
                loading={createLoading}
                disabled={createLoading}
                size='md'
                fullWidth={!!isMobile}
                mih={44}
                leftSection={<IconPlus size={16} />}
                className='bg-blue-600 hover:bg-blue-700'
              >
                Crear Activo
              </Button>
            </Flex>
          </Box>
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
