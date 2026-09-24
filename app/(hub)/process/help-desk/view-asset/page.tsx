'use client';

import {
  useState,
  useEffect,
  useRef,
  Suspense,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Title,
  Stack,
  Alert,
  Breadcrumbs,
  Anchor,
  TextInput,
  NumberInput,
  Textarea,
  Select,
  Switch,
  Button,
  Group,
  Badge,
  Grid,
  Card,
  Text,
  LoadingOverlay,
  ActionIcon,
  Flex,
  Loader,
  Tooltip,
  Modal,
  Table,
  Divider,
  Collapse,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconChevronRight,
  IconX,
  IconClock,
  IconBuilding,
  IconCircleCheckFilled,
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
  IconEdit,
  IconArrowLeft,
  IconFlag,
  IconDeviceFloppy,
  IconInfoCircle,
  IconNote,
  IconCheck,
  IconMapPin,
  IconBrandWindows,
  IconCalendarEvent,
  IconFileDescription,
  IconFileInvoice,
  IconFileCertificate,
  IconRefresh,
  IconDeviceMobile,
  IconLink,
  IconCircleDot,
  IconEye,
  IconPlus,
  IconUserPlus,
  IconEraser,
  IconMail,
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
  sitio?: string;
  so?: string;
  factura?: string;
  acta?: string;
  acta_salida?: string;
  renovacion?: 0 | 1 | boolean | null;
  renovacion_fecha?: string | null;
  sim?: string;
  id_company_asset?: number;
  empresa?: string;
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
interface ConsultsResponse {
  types: TypeAssetRow[];
  subtypes: SubtypeAssetRow[];
  departments: DepartmentRow[];
  users: UserAssetRow[];
  statuses?: StatusAssetRow[];
}

interface AssetLog {
  id: number;
  mensaje: string;
  usuario: string;
  fecha: string;
}

interface AssetDocument {
  id_document: number;
  usuario: string;
  cedula: string;
  cargo: string;
  departamento: string;
  sede: string;
  fecha_entrega: string;
  nombre_tecnico_entrego: string;
  firma_recibio: string;
  fecha_devolucion?: string | null;
  nombre_tecnico_recibio?: string | null;
  firma_devolucion?: string | null;
}

interface NewUserAssetForm {
  usuario: string;
  cargo: string;
  cedula: string;
  correo: string;
  id_departamento: string;
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
  factura: string;
  renovacion: string;
  renovacion_fecha: string;
  acta_salida: string;
  sim: string;
}

const ASSET_STORAGE_KEY = 'selectedAsset';

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
]);

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

const SITIOS = toOptions([
  'OFICINA PRINCIPAL FARMALOGICA',
  'FARMALOGICA PLANTA',
  'CELTA',
  'RYAN',
]);

const SISTEMAS_OPERATIVOS = [
  { value: 'Microsoft Windows 10 Pro', label: 'WINDOWS 10 PRO' },
  { value: 'Microsoft Windows 11 Pro', label: 'WINDOWS 11 PRO' },
  { value: 'MacOS', label: 'MACOS' },
  { value: 'NO APLICA', label: 'NO APLICA' },
];

const RENOVACION_OPTIONS = [
  { value: '1', label: 'Si' },
  { value: '0', label: 'No' },
];

const SEDES = toOptions(['Administrativa', 'Planta', 'Ryan']);

const COMPANY_NAME = '';

const EMPTY_NEW_USER: NewUserAssetForm = {
  usuario: '',
  cargo: '',
  cedula: '',
  correo: '',
  id_departamento: '',
};

const todayInput = () => new Date().toISOString().split('T')[0];

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

const isActive = (value: Asset['activo'] | undefined) => value === 1 || value === true;

const isRenewal = (value: Asset['renovacion']) => value === 1 || value === true;

const formatDate = (raw: string | null | undefined) => {
  if (!raw) return '-';
  const date = new Date(raw);
  if (isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
};

const formatDateTime = (raw: string | null | undefined) => {
  if (!raw) return '-';
  const date = new Date(raw);
  if (isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour12: true,
  }).format(new Date(date.getTime() + 5 * 60 * 60 * 1000));
};

const toDateInput = (raw: string | null | undefined) => (raw ? raw.split('T')[0] : '');

const DEFAULT_RELEASE_USER_ID = 86;

const formatLogValue = (value: unknown): string => {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') return value.trim() || '-';
  return String(value);
};

interface AssetLogField {
  key: keyof Asset;
  label: string;
  format?: (value: unknown) => string;
}

const ASSET_LOG_FIELDS: AssetLogField[] = [
  { key: 'nombre', label: 'Nombre' },
  { key: 'modelo', label: 'Modelo' },
  { key: 'serial', label: 'Serial' },
  { key: 'etiqueta', label: 'Etiqueta' },
  { key: 'tipo_activo', label: 'Tipo de activo' },
  { key: 'tipo_equipo', label: 'Tipo de equipo' },
  { key: 'usuario', label: 'Usuario asignado' },
  { key: 'departamento', label: 'Departamento' },
  { key: 'procesador', label: 'Procesador' },
  { key: 'ram', label: 'Memoria RAM' },
  { key: 'almacenamiento', label: 'Almacenamiento' },
  { key: 'estado', label: 'Estado' },
  {
    key: 'costo_equipo',
    label: 'Costo del equipo',
    format: (v) => formatCurrency(v as Asset['costo_equipo']),
  },
  {
    key: 'activo',
    label: 'Activo',
    format: (v) => (isActive(v as Asset['activo']) ? 'Si' : 'No'),
  },
  { key: 'sitio', label: 'Sitio' },
  { key: 'so', label: 'Sistema operativo' },
  { key: 'factura', label: 'Factura' },
  {
    key: 'renovacion',
    label: 'Renovación',
    format: (v) => (v == null ? 'No aplica' : isRenewal(v as Asset['renovacion']) ? 'Si' : 'No'),
  },
  {
    key: 'renovacion_fecha',
    label: 'Fecha de renovación',
    format: (v) => formatDate(v as string | null),
  },
  { key: 'acta_salida', label: 'Acta de salida' },
  { key: 'sim', label: 'Simcard' },
];

const buildAssetChangeLines = (before: Asset, after: Asset): string[] =>
  ASSET_LOG_FIELDS.reduce<string[]>((lines, field) => {
    const format = field.format ?? formatLogValue;
    const beforeText = format(before[field.key]);
    const afterText = format(after[field.key]);
    if (beforeText === afterText) return lines;
    lines.push(`${field.label}: ${beforeText} → ${afterText}`);
    return lines;
  }, []);

const MAX_LOG_MESSAGE_LENGTH = 950;
const truncateLogMessage = (message: string): string =>
  message.length <= MAX_LOG_MESSAGE_LENGTH
    ? message
    : `${message.slice(0, MAX_LOG_MESSAGE_LENGTH)}…`;

const assetToForm = (asset: Asset): AssetFormData => ({
  nombre: asset.nombre ?? '',
  modelo: asset.modelo ?? '',
  serial: asset.serial ?? '',
  etiqueta: asset.etiqueta ?? '',
  tipo_activo: asset.id_tipo_activo != null ? String(asset.id_tipo_activo) : '',
  tipo_equipo: asset.id_tipo_equipo != null ? String(asset.id_tipo_equipo) : '',
  usuario: asset.id_usuario != null ? String(asset.id_usuario) : '',
  procesador: asset.procesador ?? '',
  ram: asset.ram ?? '',
  almacenamiento: asset.almacenamiento ?? '',
  estado: asset.id_estado_activo != null ? String(asset.id_estado_activo) : '',
  costo_equipo: asset.costo_equipo ?? '',
  activo: isActive(asset.activo),
  sitio: asset.sitio ?? '',
  so: asset.so ?? '',
  factura: asset.factura ?? '',
  renovacion:
    asset.renovacion === null || asset.renovacion === undefined
      ? ''
      : isRenewal(asset.renovacion)
        ? '1'
        : '0',
  renovacion_fecha: toDateInput(asset.renovacion_fecha),
  acta_salida: asset.acta_salida ?? '',
  sim: asset.sim ?? '',
});

const isValidUrl = (value: string | undefined) => !!value && /^https?:\/\//i.test(value);

interface SignaturePadHandle {
  clear: () => void;
  isEmpty: () => boolean;
  toDataURL: () => string;
}

interface SignaturePadCanvasProps {
  height?: number;
  readOnly?: boolean;
  imageSrc?: string | null;
}

const SignaturePadCanvas = forwardRef<SignaturePadHandle, SignaturePadCanvasProps>(
  function SignaturePadCanvas({ height = 180, readOnly = false, imageSrc = null }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawingRef = useRef(false);
    const emptyRef = useRef(true);
    const lastPointRef = useRef<{ x: number; y: number } | null>(null);

    const paintBackground = (ctx: CanvasRenderingContext2D, width: number, h: number) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, h);
    };

    const getContext = () => canvasRef.current?.getContext('2d') ?? null;

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const resize = () => {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        const cssWidth = canvas.offsetWidth;
        const cssHeight = canvas.offsetHeight;
        if (cssWidth === 0 || cssHeight === 0) return;

        const previous =
          canvas.width > 0 && canvas.height > 0
            ? ctx.getImageData(0, 0, canvas.width, canvas.height)
            : null;

        canvas.width = cssWidth * ratio;
        canvas.height = cssHeight * ratio;
        ctx.scale(ratio, ratio);
        paintBackground(ctx, cssWidth, cssHeight);

        if (previous) ctx.putImageData(previous, 0, 0);

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#000000';
      };

      resize();
      const observer = new ResizeObserver(resize);
      observer.observe(canvas);
      return () => observer.disconnect();
    }, []);

    useEffect(() => {
      const canvas = canvasRef.current;
      const ctx = getContext();
      if (!canvas || !ctx || !imageSrc) return;

      const image = new Image();
      image.onload = () => {
        const cssWidth = canvas.offsetWidth;
        const cssHeight = canvas.offsetHeight;
        paintBackground(ctx, cssWidth, cssHeight);
        ctx.drawImage(image, 0, 0, cssWidth, cssHeight);
        emptyRef.current = false;
      };
      image.src = imageSrc;
    }, [imageSrc]);

    const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (readOnly) return;
      const ctx = getContext();
      if (!ctx) return;

      event.currentTarget.setPointerCapture(event.pointerId);
      drawingRef.current = true;
      emptyRef.current = false;

      const point = pointFromEvent(event);
      lastPointRef.current = point;
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (readOnly || !drawingRef.current) return;
      const ctx = getContext();
      const last = lastPointRef.current;
      if (!ctx || !last) return;

      const point = pointFromEvent(event);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      lastPointRef.current = point;
    };

    const stopDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      lastPointRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    };

    useImperativeHandle(ref, () => ({
      clear: () => {
        const canvas = canvasRef.current;
        const ctx = getContext();
        if (!canvas || !ctx) return;
        paintBackground(ctx, canvas.offsetWidth, canvas.offsetHeight);
        emptyRef.current = true;
      },
      isEmpty: () => emptyRef.current,
      toDataURL: () => canvasRef.current?.toDataURL('image/png') ?? '',
    }));

    return (
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDrawing}
        onPointerLeave={stopDrawing}
        onPointerCancel={stopDrawing}
        style={{
          width: '100%',
          height,
          border: '2px solid var(--mantine-color-gray-4)',
          borderRadius: 8,
          backgroundColor: '#ffffff',
          touchAction: 'none',
          cursor: readOnly ? 'default' : 'crosshair',
        }}
      />
    );
  }
);

function InfoItem({
  label,
  value,
  Icon,
  href,
}: {
  label: string;
  value: string | number | null | undefined;
  Icon: typeof IconTag;
  href?: string;
}) {
  const empty = value === null || value === undefined || value === '';
  return (
    <Group gap='sm' wrap='nowrap' align='flex-start'>
      <Icon size={18} className='text-gray-400 mt-1 shrink-0' />
      <div style={{ minWidth: 0 }}>
        <Text size='xs' c='dimmed' tt='uppercase' fw={600}>
          {label}
        </Text>
        {!empty && href ? (
          <Anchor href={href} target='_blank' rel='noopener noreferrer' size='sm' fw={500}>
            Abrir enlace
          </Anchor>
        ) : (
          <Text size='sm' fw={500} style={{ wordBreak: 'break-word' }}>
            {empty ? '-' : value}
          </Text>
        )}
      </div>
    </Group>
  );
}

function ViewAsset() {
  const { data: session, status } = useSession();
  const userName = session?.user?.name || '';
  const router = useRouter();
  const searchParams = useSearchParams();
  const assetId = searchParams.get('id');

  const [asset, setAsset] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [typeOptions, setTypeOptions] = useState<TypeAssetRow[]>([]);
  const [subtypeOptions, setSubtypeOptions] = useState<SubtypeAssetRow[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<DepartmentRow[]>([]);
  const [userOptions, setUserOptions] = useState<UserAssetRow[]>([]);
  const [statusOptions, setStatusOptions] = useState<StatusAssetRow[]>([]);
  const [listsLoading, setListsLoading] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<AssetFormData | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saveLoading, setSaveLoading] = useState(false);
  const isSubmittingRef = useRef(false);

  const [logs, setLogs] = useState<AssetLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [newLog, setNewLog] = useState('');
  const [addingLog, setAddingLog] = useState(false);

  const [hasActa, setHasActa] = useState(false);
  const [actaModalOpened, setActaModalOpened] = useState(false);
  const [viewActaModalOpened, setViewActaModalOpened] = useState(false);
  const [createUserModalOpened, setCreateUserModalOpened] = useState(false);
  const [acta, setActa] = useState<AssetDocument | null>(null);
  const [actaLoading, setActaLoading] = useState(false);
  const [actaError, setActaError] = useState<string | null>(null);
  const [savingActa, setSavingActa] = useState(false);
  const [savingDevolucion, setSavingDevolucion] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [sede, setSede] = useState('');
  const [showDevolutionFields, setShowDevolutionFields] = useState(false);
  const [newUser, setNewUser] = useState<NewUserAssetForm>(EMPTY_NEW_USER);
  const [creatingUser, setCreatingUser] = useState(false);
  const createSignRef = useRef<SignaturePadHandle>(null);
  const devolutionSignRef = useRef<SignaturePadHandle>(null);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/login');
      return;
    }

    fetchLists();

    if (!assetId) {
      setError('No se indicó el activo a consultar.');
      setLoading(false);
      return;
    }

    try {
      const stored = sessionStorage.getItem(ASSET_STORAGE_KEY);
      if (stored) {
        const parsed: Asset = JSON.parse(stored);
        if (String(parsed.id) === assetId) {
          setAsset(parsed);
          setLoading(false);
          return;
        }
      }
    } catch (err) {
      console.error('Error leyendo el activo desde sessionStorage:', err);
    }

    fetchAsset(assetId);
  }, [session, status, router, assetId]);

  useEffect(() => {
    if (asset?.id) {
      fetchLogs(asset);
      checkActa(asset.id);
    }
  }, [asset?.id]);

  useEffect(() => {
    if (!asset || asset.id_estado_activo == null || !asset.estado) return;
    setStatusOptions((prev) =>
      prev.some((s) => s.id === asset.id_estado_activo)
        ? prev
        : [...prev, { id: asset.id_estado_activo, estado: asset.estado }]
    );
  }, [asset?.id_estado_activo, asset?.estado]);

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
      if (Array.isArray(data.statuses) && data.statuses.length > 0) {
        setStatusOptions(data.statuses);
      }
    } catch (err) {
      console.error('Error fetching asset lists:', err);
      toast.error('No se pudieron cargar las listas de activos.');
    } finally {
      setListsLoading(false);
    }
  };

  const fetchAsset = async (id: string) => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/assets/${id}`);
      if (!response.ok) throw new Error('Failed to fetch asset');

      const data: Asset = await response.json();
      setAsset(data);
      sessionStorage.setItem(ASSET_STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      console.error('Error fetching asset:', err);
      setError('No se pudo cargar el activo. Intente de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const fetchLogs = async (current: Asset) => {
    try {
      setLogsLoading(true);
      const params = new URLSearchParams({
        idAsset: String(current.id),
        serial: current.serial ?? '',
      });
      const response = await fetch(`/api/assets/logs?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch asset logs');

      const data = await response.json();
      setLogs(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching asset logs:', err);
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  };

  const checkActa = async (id: number) => {
    try {
      const response = await fetch(`/api/assets/documents/exists?idAsset=${id}`);
      if (!response.ok) return;
      const data = await response.json();
      setHasActa(Array.isArray(data) && data.length > 0);
    } catch (err) {
      console.error('Error checking acta:', err);
    }
  };

  const typeSelectData = typeOptions.map((t) => ({ value: String(t.id), label: t.tipo_activo }));

  const subtypeSelectDataFor = (typeId: string) =>
    subtypeOptions
      .filter((s) => !typeId || String(s.id_tipo_activo) === typeId)
      .map((s) => ({ value: String(s.id), label: s.subtipo_activo }));

  const userSelectData = userOptions.map((u) => ({
    value: String(u.id),
    label: u.cargo ? `${u.nombre_usuario} - ${u.cargo}` : u.nombre_usuario,
  }));

  const statusSelectData = statusOptions.map((s) => ({ value: String(s.id), label: s.estado }));

  const departmentNameForUser = (userId: string) => {
    const user = userOptions.find((u) => String(u.id) === userId);
    if (!user) return '';
    return departmentOptions.find((d) => d.id === user.id_departamento)?.departamento ?? '';
  };

  const typeNameById = (id: string) => typeOptions.find((t) => String(t.id) === id)?.tipo_activo;

  const currentTypeName = (isEditing && formData ? typeNameById(formData.tipo_activo) : asset?.tipo_activo) ?? '';
  const currentStatusName =
    (isEditing && formData
      ? statusOptions.find((s) => String(s.id) === formData.estado)?.estado
      : asset?.estado) ?? '';
  const currentActive = isEditing && formData ? formData.activo : isActive(asset?.activo);

  const showActaSalida = !currentActive && currentStatusName.toLowerCase() === 'baja';
  const showSim = currentTypeName.toUpperCase() === 'CELULARES';

  const startEditing = () => {
    if (!asset) return;
    setFormData(assetToForm(asset));
    setFormErrors({});
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setFormData(null);
    setFormErrors({});
  };

  const handleFormChange = <K extends keyof AssetFormData>(field: K, value: AssetFormData[K]) => {
    setFormData((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [field]: value };
      if (field === 'tipo_activo') next.tipo_equipo = '';
      return next;
    });
    if (formErrors[field]) {
      setFormErrors((prev) => ({ ...prev, [field]: '' }));
    }
  };

  const validateForm = () => {
    if (!formData) return false;
    const errors: Record<string, string> = {};

    if (!formData.nombre.trim()) errors.nombre = 'El nombre es obligatorio';
    if (!formData.serial.trim()) errors.serial = 'El serial es obligatorio';
    if (!formData.tipo_activo) errors.tipo_activo = 'El tipo de activo es obligatorio';
    if (!formData.tipo_equipo) errors.tipo_equipo = 'El tipo de equipo es obligatorio';
    if (!formData.usuario) errors.usuario = 'El usuario asignado es obligatorio';
    if (!formData.estado) errors.estado = 'El estado es obligatorio';
    if (formData.factura && !isValidUrl(formData.factura)) {
      errors.factura = 'Debe ser una URL válida (http/https)';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (isSubmittingRef.current || !asset || !formData) return;
    if (!validateForm()) return;
    isSubmittingRef.current = true;

    const payload = {
      name: formData.nombre.trim(),
      model: formData.modelo.trim(),
      serial: formData.serial.trim(),
      label: formData.etiqueta.trim(),
      id_subtype_asset: Number(formData.tipo_equipo),
      id_user_asset: Number(formData.usuario),
      id_status_asset: Number(formData.estado),
      processor: formData.procesador,
      ram: formData.ram,
      storage: formData.almacenamiento,
      equipment_cost: Number(formData.costo_equipo) || 0,
      active: formData.activo ? 1 : 0,
      site: formData.sitio,
      os: formData.so,
      invoice: formData.factura.trim(),
      renewal: formData.renovacion === '' ? null : Number(formData.renovacion),
      renewal_date: formData.renovacion_fecha || null,
      exit_record: showActaSalida ? formData.acta_salida.trim() : '',
      sim: showSim ? formData.sim.trim() : '',
      id: asset.id,
    };

    try {
      setSaveLoading(true);

      const response = await fetch(`/api/assets/update_asset`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        let detail = '';
        try {
          const errorData = await response.json();
          detail = errorData.error || '';
        } catch {}
        console.error('Fallo al actualizar el activo:', detail);
        toast.error(detail || 'No se pudo actualizar el activo. Intente de nuevo.');
        return;
      }

      const subtype = subtypeOptions.find((s) => String(s.id) === formData.tipo_equipo);
      const user = userOptions.find((u) => String(u.id) === formData.usuario);
      const updated: Asset = {
        ...asset,
        nombre: payload.name,
        modelo: payload.model,
        serial: payload.serial,
        etiqueta: payload.label,
        id_tipo_equipo: payload.id_subtype_asset,
        tipo_equipo: subtype?.subtipo_activo ?? asset.tipo_equipo,
        id_tipo_activo: Number(formData.tipo_activo),
        tipo_activo: typeNameById(formData.tipo_activo) ?? asset.tipo_activo,
        id_usuario: payload.id_user_asset,
        usuario: user?.nombre_usuario ?? asset.usuario,
        departamento: departmentNameForUser(formData.usuario) || asset.departamento,
        id_estado_activo: payload.id_status_asset,
        estado: currentStatusName || asset.estado,
        procesador: payload.processor,
        ram: payload.ram,
        almacenamiento: payload.storage,
        costo_equipo: payload.equipment_cost,
        activo: payload.active as 0 | 1,
        sitio: payload.site,
        so: payload.os,
        factura: payload.invoice,
        renovacion: payload.renewal as 0 | 1 | null,
        renovacion_fecha: payload.renewal_date,
        acta_salida: payload.exit_record,
        sim: payload.sim,
      };
      setAsset(updated);
      sessionStorage.setItem(ASSET_STORAGE_KEY, JSON.stringify(updated));
      toast.success('Activo actualizado correctamente.');

      const changeLines = buildAssetChangeLines(asset, updated);
      if (changeLines.length > 0) {
        createLog(
          truncateLogMessage(
            `Cambios realizados por ${userName || 'Sistema'}:\n${changeLines
              .map((line) => `• ${line}`)
              .join('\n')}`
          )
        );
      }
      cancelEditing();
    } catch (err) {
      console.error('Error de red al actualizar el activo:', err);
      toast.error('No se pudo actualizar el activo. Intente de nuevo.');
    } finally {
      setSaveLoading(false);
      isSubmittingRef.current = false;
    }
  };

  const createLog = async (mensaje: string) => {
    if (!asset) return;
    try {
      const response = await fetch('/api/assets/logs/create_log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensaje,
          usuario: userName || 'Sistema',
          idAsset: asset.id,
        }),
      });
      if (!response.ok) {
        console.error('No se pudo registrar el log del activo.');
        return;
      }
      await fetchLogs(asset);
    } catch (err) {
      console.error('Error registrando el log del activo:', err);
    }
  };

  const handleAddLog = async () => {
    if (!asset) return;
    const mensaje = newLog.trim();
    if (!mensaje) {
      toast.error('Escriba el texto de la nota antes de agregarla.');
      return;
    }

    try {
      setAddingLog(true);
      const response = await fetch('/api/assets/logs/create_log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensaje,
          usuario: userName,
          idAsset: asset.id,
          serial: asset.serial,
        }),
      });

      if (!response.ok) {
        let detail = '';
        try {
          const errorData = await response.json();
          detail = errorData.error || '';
        } catch {}
        toast.error(detail || 'No se pudo agregar la nota.');
        return;
      }

      setNewLog('');
      await fetchLogs(asset);
      toast.success('Nota agregada correctamente.');
    } catch (err) {
      console.error('Error adding asset log:', err);
      toast.error('Ocurrió un error al agregar la nota.');
    } finally {
      setAddingLog(false);
    }
  };

  const selectedUserRow = userOptions.find((u) => String(u.id) === selectedUserId);
  const selectedUserDepartment = selectedUserRow
    ? (departmentOptions.find((d) => d.id === selectedUserRow.id_departamento)?.departamento ?? '')
    : '';

  const openCreateActa = () => {
    setSelectedUserId(asset?.id_usuario != null ? String(asset.id_usuario) : '');
    setSede('');
    setActaModalOpened(true);
  };

  const closeCreateActa = () => {
    setActaModalOpened(false);
    setSelectedUserId('');
    setSede('');
  };

  const openViewActa = () => {
    setViewActaModalOpened(true);
    setShowDevolutionFields(false);
    if (asset) fetchActa(asset.id);
  };

  const fetchActa = async (id: number) => {
    try {
      setActaLoading(true);
      setActaError(null);
      const response = await fetch(`/api/assets/documents/consult-document?idAsset=${id}`);
      if (!response.ok) throw new Error('Failed to fetch acta');

      const data = await response.json();
      const record = Array.isArray(data) ? data[0] : data;
      if (!record) {
        setActa(null);
        setActaError('No se encontró un acta registrada para este activo.');
        return;
      }
      setActa(record as AssetDocument);
    } catch (err) {
      console.error('Error fetching acta:', err);
      setActa(null);
      setActaError('No se pudo cargar el acta. Intente de nuevo.');
    } finally {
      setActaLoading(false);
    }
  };

  const notifyAssetAssigned = async (usuario: string) => {
    const emails = process.env.SENDEMAILASIGNEDASSET;
    if (!emails) {
      console.warn(
        'SENDEMAILASIGNEDASSET no está configurada; se omite la notificación de activo asignado.'
      );
      return;
    }
    if (!asset) return;

    try {
      const table: Array<Record<string, string | number | undefined>> = [
        {
          'Tipo de Equipo': asset.tipo_equipo,
          Serial: asset.serial,
          Etiqueta: asset.etiqueta,
          'Usuario Asignado': usuario,
          'Entregado por': userName,
        },
      ];

      await sendMessage(
        `Se ha asignado un nuevo activo: ${asset.serial}`,
        emails,
        table,
        'Este es un mensaje automático del módulo de Activos. Si tiene alguna pregunta, contacte al administrador del sistema.',
        'https://farmalogica.com.co/imagenes/logos/logo20.png',
        []
      );
    } catch (err) {
      console.error('Error al enviar la notificación de activo asignado:', err);
    }
  };

  const handleSaveActa = async () => {
    if (!asset) return;

    if (!selectedUserId) {
      toast.error('Seleccione el colaborador que recibe el activo.');
      return;
    }
    if (!sede) {
      toast.error('Seleccione la sede.');
      return;
    }
    if (createSignRef.current?.isEmpty() !== false) {
      toast.error('La firma del colaborador es obligatoria.');
      return;
    }

    try {
      setSavingActa(true);
      const signature = createSignRef.current?.toDataURL() ?? '';

      const response = await fetch('/api/assets/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signature,
          nombre_tecnico_entrego: userName,
          fecha_entrega: todayInput(),
          id_user_asset: Number(selectedUserId),
          sede,
          id_assets: asset.id,
          usuario: selectedUserRow?.nombre_usuario ?? '',
        }),
      });

      if (!response.ok) {
        let detail = '';
        try {
          const errorData = await response.json();
          detail = errorData.error || '';
        } catch {}
        console.error('Fallo al guardar el acta:', detail);
        toast.error(detail || 'No se pudo guardar el acta. Intente de nuevo.');
        return;
      }

      toast.success('Acta guardada correctamente.');
      notifyAssetAssigned(selectedUserRow?.nombre_usuario ?? '');
      setHasActa(true);
      closeCreateActa();

      fetchAsset(String(asset.id));
      const previousUserName = asset.usuario || 'Sin asignar';
      createLog(
        `Acta de entrega firmada por ${userName || 'Sistema'}. Usuario asignado: ${previousUserName} → ${
          selectedUserRow?.nombre_usuario ?? 'sin usuario'
        } (Sede: ${sede}).`
      );
    } catch (err) {
      console.error('Error de red al guardar el acta:', err);
      toast.error('No se pudo guardar el acta. Intente de nuevo.');
    } finally {
      setSavingActa(false);
    }
  };

  const handleUpdateDevolucion = async () => {
    if (!asset || !acta) return;

    if (devolutionSignRef.current?.isEmpty() !== false) {
      toast.error('La firma de devolución es obligatoria.');
      return;
    }

    try {
      setSavingDevolucion(true);
      const firma = devolutionSignRef.current?.toDataURL() ?? '';

      const response = await fetch(`/api/assets/documents/update-document?idDocument=${acta.id_document}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fecha_devolucion: todayInput(),
          nombre_tecnico_recibio: userName,
          firma_devolucion: firma,
          id_assets: asset.id,
          id: acta.id_document,
        }),
      });

      if (!response.ok) {
        let detail = '';
        try {
          const errorData = await response.json();
          detail = errorData.error || '';
        } catch {}
        console.error('Fallo al actualizar la devolución:', detail);
        toast.error(detail || 'No se pudo actualizar la devolución. Intente de nuevo.');
        return;
      }

      toast.success('Devolución registrada correctamente.');
      setActa({
        ...acta,
        fecha_devolucion: todayInput(),
        nombre_tecnico_recibio: userName,
        firma_devolucion: firma,
      });
      fetchAsset(String(asset.id));
      const previousUserName = asset.usuario || 'Sin asignar';
      const releasedUserName =
        userOptions.find((u) => u.id === DEFAULT_RELEASE_USER_ID)?.nombre_usuario ??
        'usuario por defecto';
      createLog(
        `Devolución registrada por ${userName || 'Sistema'}. Usuario asignado: ${previousUserName} → ${releasedUserName}.`
      );
    } catch (err) {
      console.error('Error de red al actualizar la devolución:', err);
      toast.error('No se pudo actualizar la devolución. Intente de nuevo.');
    } finally {
      setSavingDevolucion(false);
    }
  };

  const handleCreateUser = async () => {
    if (!newUser.usuario.trim() || !newUser.cargo.trim() || !newUser.cedula.trim()) {
      toast.error('Nombre, cargo y cédula son obligatorios.');
      return;
    }
    if (!newUser.id_departamento) {
      toast.error('Seleccione el departamento.');
      return;
    }

    try {
      setCreatingUser(true);
      const response = await fetch('/api/assets/documents/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usuario: newUser.usuario.trim(),
          cargo: newUser.cargo.trim(),
          cedula: newUser.cedula.trim(),
          correo: newUser.correo.trim(),
          id_department: Number(newUser.id_departamento),
        }),
      });

      if (!response.ok) {
        let detail = '';
        try {
          const errorData = await response.json();
          detail = errorData.error || '';
        } catch {}
        toast.error(detail || 'No se pudo crear el usuario.');
        return;
      }

      toast.success('Usuario creado correctamente.');
      setNewUser(EMPTY_NEW_USER);
      setCreateUserModalOpened(false);
      fetchLists();
    } catch (err) {
      console.error('Error creating user asset:', err);
      toast.error('No se pudo crear el usuario.');
    } finally {
      setCreatingUser(false);
    }
  };

  const openExternal = (url: string | undefined) => {
    if (isValidUrl(url)) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const breadcrumbItems = [
    { title: 'Procesos', href: '/process' },
    { title: 'Activos', href: '/process/help-desk/assets' },
    { title: 'Detalle del Activo', href: '#' },
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

  const StatusIcon = asset ? getAssetStatusIcon(asset.estado) : IconClock;
  const form = formData;
  const editing = isEditing && form !== null;

  return (
    <div className='min-h-screen bg-gray-50'>
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
        <Card shadow='sm' p='xl' radius='md' withBorder mb='6' className='bg-white'>
          <Breadcrumbs separator={<IconChevronRight size={16} />} className='mb-4'>
            {breadcrumbItems}
          </Breadcrumbs>

          <Flex justify='space-between' align='flex-start' gap='md' wrap='wrap'>
            <div>
              <Title order={1} className='text-3xl font-bold mb-2 flex items-center gap-3'>
                <IconDeviceLaptop size={32} className='text-blue-600' />
                Detalle del Activo {asset?.etiqueta ? asset.etiqueta : ''}
              </Title>
              {asset && (
                <Group gap='sm'>
                  <Text size='lg' c='dimmed'>
                    {[asset.modelo, asset.nombre].filter(Boolean).join(' · ')}
                  </Text>
                  <Badge
                    color={getAssetStatusColor(asset.estado)}
                    variant='light'
                    leftSection={<StatusIcon size={12} />}
                    styles={{ label: { overflow: 'visible' } }}
                  >
                    {asset.estado}
                  </Badge>
                  <Badge color={isActive(asset.activo) ? 'green' : 'red'} variant='outline'>
                    {isActive(asset.activo) ? 'Activo' : 'Inactivo'}
                  </Badge>
                </Group>
              )}
            </div>

            <Button
              variant='outline'
              leftSection={<IconArrowLeft size={16} />}
              onClick={() => router.push('/process/help-desk/assets')}
            >
              Volver
            </Button>
          </Flex>
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

        {asset && (
          <>
            <div className='flex flex-col lg:flex-row gap-6'>
              <div className='flex-1 min-w-0'>
                <Stack gap='md'>
                  <Card shadow='sm' p='lg' radius='md' withBorder className='bg-white' pos='relative'>
                    <LoadingOverlay visible={saveLoading || (editing && listsLoading)} />
                    <Title order={3} mb='md' className='flex items-center gap-2'>
                      <IconInfoCircle size={20} />
                      Información del Activo
                    </Title>

                    <Grid gutter='lg'>
                      <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                        {editing ? (
                          <TextInput
                            label='Serial'
                            value={form.serial}
                            onChange={(e) => handleFormChange('serial', e.target.value)}
                            error={formErrors.serial}
                            required
                            maxLength={100}
                            leftSection={<IconBarcode size={16} />}
                          />
                        ) : (
                          <InfoItem label='Serial' value={asset.serial} Icon={IconBarcode} />
                        )}
                      </Grid.Col>
                      <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                        {editing ? (
                          <TextInput
                            label='Nombre'
                            value={form.nombre}
                            onChange={(e) => handleFormChange('nombre', e.target.value)}
                            error={formErrors.nombre}
                            required
                            maxLength={254}
                            leftSection={<IconDeviceLaptop size={16} />}
                          />
                        ) : (
                          <InfoItem label='Nombre' value={asset.nombre} Icon={IconDeviceLaptop} />
                        )}
                      </Grid.Col>
                      <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                        {editing ? (
                          <TextInput
                            label='Etiqueta'
                            value={form.etiqueta}
                            onChange={(e) => handleFormChange('etiqueta', e.target.value)}
                            maxLength={100}
                            leftSection={<IconTag size={16} />}
                          />
                        ) : (
                          <InfoItem label='Etiqueta' value={asset.etiqueta} Icon={IconTag} />
                        )}
                      </Grid.Col>
                      <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                        {editing ? (
                          <TextInput
                            label='Modelo'
                            value={form.modelo}
                            onChange={(e) => handleFormChange('modelo', e.target.value)}
                            maxLength={254}
                            leftSection={<IconDeviceLaptop size={16} />}
                          />
                        ) : (
                          <InfoItem label='Modelo' value={asset.modelo} Icon={IconDeviceLaptop} />
                        )}
                      </Grid.Col>
                      <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                        {editing ? (
                          <Select
                            label='Tipo Activo'
                            placeholder='Seleccione el tipo'
                            data={typeSelectData}
                            searchable
                            value={form.tipo_activo || null}
                            onChange={(value) => handleFormChange('tipo_activo', value || '')}
                            error={formErrors.tipo_activo}
                            required
                            leftSection={<IconDeviceLaptop size={16} />}
                          />
                        ) : (
                          <InfoItem label='Tipo Activo' value={asset.tipo_activo} Icon={IconDeviceLaptop} />
                        )}
                      </Grid.Col>
                      <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                        {editing ? (
                          <Select
                            label='Tipo Equipo'
                            placeholder={
                              form.tipo_activo ? 'Seleccione el equipo' : 'Primero seleccione el tipo'
                            }
                            data={subtypeSelectDataFor(form.tipo_activo)}
                            searchable
                            value={form.tipo_equipo || null}
                            onChange={(value) => handleFormChange('tipo_equipo', value || '')}
                            error={formErrors.tipo_equipo}
                            required
                            disabled={!form.tipo_activo}
                            leftSection={<IconTag size={16} />}
                          />
                        ) : (
                          <InfoItem label='Tipo Equipo' value={asset.tipo_equipo} Icon={IconTag} />
                        )}
                      </Grid.Col>
                      <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                        {editing ? (
                          <Select
                            label='Procesador'
                            placeholder='Seleccione'
                            data={PROCESADORES}
                            searchable
                            clearable
                            value={form.procesador || null}
                            onChange={(value) => handleFormChange('procesador', value || '')}
                            leftSection={<IconCpu size={16} />}
                          />
                        ) : (
                          <InfoItem label='Procesador' value={asset.procesador} Icon={IconCpu} />
                        )}
                      </Grid.Col>
                      <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                        {editing ? (
                          <Select
                            label='Memoria RAM'
                            placeholder='Seleccione'
                            data={RAM_OPTIONS}
                            clearable
                            value={form.ram || null}
                            onChange={(value) => handleFormChange('ram', value || '')}
                            leftSection={<IconDeviceSdCard size={16} />}
                          />
                        ) : (
                          <InfoItem label='Memoria RAM' value={asset.ram} Icon={IconDeviceSdCard} />
                        )}
                      </Grid.Col>
                      <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                        {editing ? (
                          <Select
                            label='Almacenamiento'
                            placeholder='Seleccione'
                            data={ALMACENAMIENTO_OPTIONS}
                            clearable
                            value={form.almacenamiento || null}
                            onChange={(value) => handleFormChange('almacenamiento', value || '')}
                            leftSection={<IconDatabase size={16} />}
                          />
                        ) : (
                          <InfoItem
                            label='Almacenamiento'
                            value={asset.almacenamiento}
                            Icon={IconDatabase}
                          />
                        )}
                      </Grid.Col>
                      <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                        {editing ? (
                          <Select
                            label='Sitio'
                            placeholder='Seleccione'
                            data={SITIOS}
                            clearable
                            value={form.sitio || null}
                            onChange={(value) => handleFormChange('sitio', value || '')}
                            leftSection={<IconMapPin size={16} />}
                          />
                        ) : (
                          <InfoItem label='Sitio' value={asset.sitio} Icon={IconMapPin} />
                        )}
                      </Grid.Col>
                      <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                        {editing ? (
                          <Select
                            label='Sistema Operativo'
                            placeholder='Seleccione'
                            data={SISTEMAS_OPERATIVOS}
                            clearable
                            value={form.so || null}
                            onChange={(value) => handleFormChange('so', value || '')}
                            leftSection={<IconBrandWindows size={16} />}
                          />
                        ) : (
                          <InfoItem
                            label='Sistema Operativo'
                            value={asset.so}
                            Icon={IconBrandWindows}
                          />
                        )}
                      </Grid.Col>
                      <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                        {editing ? (
                          <Select
                            label='Estado'
                            placeholder='Seleccione el estado'
                            data={statusSelectData}
                            value={form.estado || null}
                            onChange={(value) => handleFormChange('estado', value || '')}
                            error={formErrors.estado}
                            required
                            leftSection={<IconFlag size={16} />}
                          />
                        ) : (
                          <InfoItem label='Estado' value={asset.estado} Icon={IconFlag} />
                        )}
                      </Grid.Col>
                      <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                        {editing ? (
                          <NumberInput
                            label='Costo del equipo'
                            placeholder='0'
                            value={form.costo_equipo}
                            onChange={(value) => handleFormChange('costo_equipo', value)}
                            thousandSeparator='.'
                            decimalSeparator=','
                            decimalScale={0}
                            allowNegative={false}
                            hideControls
                            min={0}
                            leftSection={<IconCoin size={16} />}
                          />
                        ) : (
                          <InfoItem
                            label='Costo del equipo'
                            value={formatCurrency(asset.costo_equipo)}
                            Icon={IconCoin}
                          />
                        )}
                      </Grid.Col>
                      <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                        <InfoItem
                          label='Fecha de compra'
                          value={formatDate(asset.created_at)}
                          Icon={IconCalendarEvent}
                        />
                      </Grid.Col>
                      <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                        {editing ? (
                          <Switch
                            label='Activo'
                            description='Vigente en el inventario'
                            mt='md'
                            checked={form.activo}
                            onChange={(e) => handleFormChange('activo', e.currentTarget.checked)}
                          />
                        ) : (
                          <InfoItem
                            label='Activo'
                            value={isActive(asset.activo) ? 'Si' : 'No'}
                            Icon={IconCircleDot}
                          />
                        )}
                      </Grid.Col>
                    </Grid>
                  </Card>

                  <Card shadow='sm' p='lg' radius='md' withBorder className='bg-white'>
                    <Title order={3} mb='md' className='flex items-center gap-2'>
                      <IconUser size={20} />
                      Asignación
                    </Title>
                    <Grid gutter='lg'>
                      <Grid.Col span={{ base: 12, sm: 6 }}>
                        {editing ? (
                          <Select
                            label='Usuario asignado'
                            placeholder='Seleccione el usuario'
                            data={userSelectData}
                            searchable
                            value={form.usuario || null}
                            onChange={(value) => handleFormChange('usuario', value || '')}
                            error={formErrors.usuario}
                            required
                            leftSection={<IconUser size={16} />}
                          />
                        ) : (
                          <InfoItem label='Usuario asignado' value={asset.usuario} Icon={IconUser} />
                        )}
                      </Grid.Col>
                      <Grid.Col span={{ base: 12, sm: 6 }}>
                        <InfoItem
                          label='Departamento'
                          value={
                            editing
                              ? departmentNameForUser(form.usuario) || asset.departamento
                              : asset.departamento
                          }
                          Icon={IconBuilding}
                        />
                        {editing && (
                          <Text size='xs' c='dimmed' mt={4}>
                            Se toma del usuario asignado
                          </Text>
                        )}
                      </Grid.Col>
                      <Grid.Col span={{ base: 12, sm: 6 }}>
                        <InfoItem label='Empresa' value={asset.empresa} Icon={IconBuilding} />
                      </Grid.Col>
                    </Grid>
                  </Card>

                  <Card shadow='sm' p='lg' radius='md' withBorder className='bg-white'>
                    <Title order={3} mb='md' className='flex items-center gap-2'>
                      <IconFileDescription size={20} />
                      Documentos y Renovación
                    </Title>
                    <Grid gutter='lg'>
                      <Grid.Col span={{ base: 12, sm: 6 }}>
                        {editing ? (
                          <TextInput
                            label='Factura (enlace)'
                            placeholder='https://...'
                            value={form.factura}
                            onChange={(e) => handleFormChange('factura', e.target.value)}
                            error={formErrors.factura}
                            maxLength={1000}
                            leftSection={<IconLink size={16} />}
                          />
                        ) : (
                          <InfoItem
                            label='Factura'
                            value={asset.factura}
                            href={isValidUrl(asset.factura) ? asset.factura : undefined}
                            Icon={IconFileInvoice}
                          />
                        )}
                      </Grid.Col>
                      <Grid.Col span={{ base: 12, sm: 6 }}>
                        <InfoItem
                          label='Acta'
                          value={asset.acta}
                          href={isValidUrl(asset.acta) ? asset.acta : undefined}
                          Icon={IconFileCertificate}
                        />
                      </Grid.Col>
                      <Grid.Col span={{ base: 12, sm: 6 }}>
                        {editing ? (
                          <Select
                            label='Renovación'
                            placeholder='No aplica'
                            data={RENOVACION_OPTIONS}
                            clearable
                            value={form.renovacion || null}
                            onChange={(value) => handleFormChange('renovacion', value || '')}
                            leftSection={<IconRefresh size={16} />}
                          />
                        ) : (
                          <InfoItem
                            label='Renovación'
                            value={
                              asset.renovacion === null || asset.renovacion === undefined
                                ? 'No aplica'
                                : isRenewal(asset.renovacion)
                                  ? 'Si'
                                  : 'No'
                            }
                            Icon={IconRefresh}
                          />
                        )}
                      </Grid.Col>
                      <Grid.Col span={{ base: 12, sm: 6 }}>
                        {editing ? (
                          <TextInput
                            type='date'
                            label='Fecha de renovación'
                            value={form.renovacion_fecha}
                            onChange={(e) => handleFormChange('renovacion_fecha', e.target.value)}
                            leftSection={<IconCalendarEvent size={16} />}
                          />
                        ) : (
                          <InfoItem
                            label='Fecha de renovación'
                            value={asset.renovacion_fecha ? formatDate(asset.renovacion_fecha) : '-'}
                            Icon={IconCalendarEvent}
                          />
                        )}
                      </Grid.Col>

                      {showActaSalida && (
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                          {editing ? (
                            <TextInput
                              label='Acta de salida'
                              placeholder='Referencia o enlace del acta de salida'
                              value={form.acta_salida}
                              onChange={(e) => handleFormChange('acta_salida', e.target.value)}
                              maxLength={1000}
                              leftSection={<IconFileCertificate size={16} />}
                            />
                          ) : (
                            <InfoItem
                              label='Acta de salida'
                              value={asset.acta_salida}
                              href={isValidUrl(asset.acta_salida) ? asset.acta_salida : undefined}
                              Icon={IconFileCertificate}
                            />
                          )}
                        </Grid.Col>
                      )}

                      {showSim && (
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                          {editing ? (
                            <TextInput
                              label='Simcard'
                              placeholder='Número de la SIM'
                              value={form.sim}
                              onChange={(e) => handleFormChange('sim', e.target.value)}
                              maxLength={100}
                              leftSection={<IconDeviceMobile size={16} />}
                            />
                          ) : (
                            <InfoItem label='Simcard' value={asset.sim} Icon={IconDeviceMobile} />
                          )}
                        </Grid.Col>
                      )}
                    </Grid>
                  </Card>
                </Stack>
              </div>

              <div className='w-full lg:w-96 lg:sticky lg:top-6 self-start'>
                <Card shadow='sm' p='lg' radius='md' withBorder className='bg-white'>
                  <Title order={4} mb='md' className='flex items-center gap-2'>
                    <IconNote size={18} className='text-blue-600' />
                    Historial del Activo
                  </Title>

                  {logs.length > 0 ? (
                    <div className='max-h-96 overflow-y-auto border border-gray-200 rounded-md p-3 mb-3 bg-gray-50'>
                      <Stack gap='xs'>
                        {logs.map((log) => (
                          <div key={log.id} className='border-b border-gray-200 pb-2 last:border-b-0'>
                            <Text size='sm' className='text-gray-700 mb-1 whitespace-pre-line'>
                              {log.mensaje}
                            </Text>
                            <div className='flex justify-between items-center gap-2'>
                              <Text size='xs' c='gray.6' lineClamp={1}>
                                {log.usuario}
                              </Text>
                              <Text size='xs' c='gray.6' style={{ whiteSpace: 'nowrap' }}>
                                {formatDateTime(log.fecha)}
                              </Text>
                            </div>
                          </div>
                        ))}
                      </Stack>
                    </div>
                  ) : (
                    <Text size='sm' c='dimmed' mb='sm'>
                      {logsLoading ? 'Cargando historial...' : 'No hay registros en el historial.'}
                    </Text>
                  )}

                  <Stack gap='sm'>
                    <Textarea
                      placeholder='Escriba una nota para el historial del activo...'
                      value={newLog}
                      onChange={(e) => setNewLog(e.target.value)}
                      minRows={3}
                      autosize
                      maxLength={1000}
                      disabled={addingLog}
                    />
                    <Group justify='flex-end'>
                      <Tooltip label='Agregar nota' withArrow>
                        <ActionIcon
                          variant='filled'
                          color='blue'
                          size='lg'
                          onClick={handleAddLog}
                          loading={addingLog}
                          disabled={!newLog.trim()}
                          aria-label='Agregar nota'
                        >
                          <IconCheck size={18} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Stack>
                </Card>
              </div>
            </div>

            <Card shadow='sm' p='lg' radius='md' withBorder mt='6' className='bg-white'>
              <Group justify='space-between' wrap='wrap'>
                <Group>
                  {!isEditing ? (
                    <Button
                      leftSection={<IconEdit size={16} />}
                      onClick={startEditing}
                      className='bg-blue-600 hover:bg-blue-700'
                    >
                      Editar Activo
                    </Button>
                  ) : (
                    <>
                      <Button
                        color='green'
                        leftSection={<IconDeviceFloppy size={16} />}
                        loading={saveLoading}
                        onClick={handleSave}
                      >
                        Guardar Cambios
                      </Button>
                      <Button
                        variant='outline'
                        color='gray'
                        leftSection={<IconX size={16} />}
                        onClick={cancelEditing}
                        disabled={saveLoading}
                      >
                        Cancelar
                      </Button>
                    </>
                  )}
                </Group>

                <Group>
                  {hasActa ? (
                    <Button
                      variant='light'
                      leftSection={<IconEye size={16} />}
                      onClick={openViewActa}
                    >
                      Ver Acta
                    </Button>
                  ) : (
                    <Button
                      variant='light'
                      leftSection={<IconPlus size={16} />}
                      onClick={openCreateActa}
                    >
                      Crear Acta
                    </Button>
                  )}
                  <Tooltip
                    label={isValidUrl(asset.acta) ? 'Abrir acta' : 'El activo no tiene acta'}
                    withArrow
                  >
                    <Button
                      variant='outline'
                      leftSection={<IconFileCertificate size={16} />}
                      onClick={() => openExternal(asset.acta)}
                      disabled={!isValidUrl(asset.acta)}
                    >
                      Acta
                    </Button>
                  </Tooltip>
                  <Tooltip
                    label={isValidUrl(asset.factura) ? 'Abrir factura' : 'El activo no tiene factura'}
                    withArrow
                  >
                    <Button
                      variant='outline'
                      leftSection={<IconFileInvoice size={16} />}
                      onClick={() => openExternal(asset.factura)}
                      disabled={!isValidUrl(asset.factura)}
                    >
                      Factura
                    </Button>
                  </Tooltip>
                  <Button
                    variant='outline'
                    leftSection={<IconArrowLeft size={16} />}
                    onClick={() => router.push('/process/help-desk/assets')}
                  >
                    Volver al Panel
                  </Button>
                </Group>
              </Group>
            </Card>

            <Modal
              opened={actaModalOpened}
              onClose={closeCreateActa}
              title={
                <Group>
                  <IconFileCertificate size={20} />
                  <Text size='lg' fw={600}>
                    Acta de Entrega
                  </Text>
                </Group>
              }
              size='80%'
              radius='md'
              overlayProps={{ blur: 4 }}
            >
              <LoadingOverlay visible={savingActa || listsLoading} />

              <Stack>
                <Group>
                  <Text size='sm' fw={700}>
                    Fecha de entrega:
                  </Text>
                  <Text size='sm'>{formatDate(todayInput())}</Text>
                </Group>

                <Text size='sm'>
                  {asset.empresa} hace entrega oficial de los equipos detallados, sobre los cuales se
                  capacitó para su uso al colaborador:
                </Text>

                <Grid>
                  <Grid.Col span={{ base: 12, md: 4 }}>
                    <Select
                      label='Apellidos y nombres'
                      placeholder='Seleccione el colaborador'
                      data={userSelectData}
                      searchable
                      value={selectedUserId || null}
                      onChange={(value) => setSelectedUserId(value || '')}
                      required
                      leftSection={<IconUser size={16} />}
                    />
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, md: 4 }}>
                    <TextInput
                      label='Documento'
                      value={selectedUserRow?.cedula ?? ''}
                      readOnly
                      leftSection={<IconBarcode size={16} />}
                    />
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, md: 4 }}>
                    <TextInput
                      label='Departamento'
                      value={selectedUserDepartment}
                      readOnly
                      leftSection={<IconBuilding size={16} />}
                    />
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, md: 4 }}>
                    <TextInput
                      label='Cargo'
                      value={selectedUserRow?.cargo ?? ''}
                      readOnly
                      leftSection={<IconUser size={16} />}
                    />
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, md: 4 }}>
                    <Select
                      label='Sede'
                      placeholder='Escoger sede'
                      data={SEDES}
                      value={sede || null}
                      onChange={(value) => setSede(value || '')}
                      required
                      leftSection={<IconMapPin size={16} />}
                    />
                  </Grid.Col>
                </Grid>

                <Card withBorder radius='md' p='md' bg='gray.0'>
                  <Text size='sm' fw={600} mb='xs'>
                    Datos del equipo
                  </Text>
                  <div className='overflow-x-auto'>
                    <Table withTableBorder withColumnBorders>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Tipo Equipo</Table.Th>
                          <Table.Th>Serial</Table.Th>
                          <Table.Th>Etiqueta</Table.Th>
                          <Table.Th>Procesador</Table.Th>
                          <Table.Th>Modelo</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        <Table.Tr>
                          <Table.Td>{asset.tipo_equipo || '-'}</Table.Td>
                          <Table.Td>{asset.serial || '-'}</Table.Td>
                          <Table.Td>{asset.etiqueta || '-'}</Table.Td>
                          <Table.Td>{asset.procesador || '-'}</Table.Td>
                          <Table.Td>{asset.modelo || '-'}</Table.Td>
                        </Table.Tr>
                      </Table.Tbody>
                    </Table>
                  </div>
                </Card>

                <Text size='sm'>
                    {'El colaborador ha sido informado y acepta que la titularidad de los equipos entregados y de la ' +
                    'información en ellos contenida o que se llegue a procesar por parte del Colaborador(a), son de ' +
                    `${asset.empresa} por lo que se compromete a cumplir con las políticas establecidas por la empresa en ` +
                    'cuanto al hardware, software e información y a restituir los equipos en las condiciones originales ' +
                    'en que se recibe, en caso de que el equipo no sea devuelto en las mismas condiciones y el daño sea ' +
                    'ocasionado por el colaborador el costo de la reparación deberá ser asumido por él, la información y ' +
                    'demás elementos conexos deberán ser restituidos en las mismas condiciones recibidas, en caso de ' +
                    'terminación del contrato de trabajo, reemplazo del equipo, u otra situación que aboque a su retiro.'}
                </Text>

                <div>
                  <Text size='sm' fw={600} mb='xs'>
                    Firma del colaborador
                  </Text>
                  <SignaturePadCanvas ref={createSignRef} height={180} />
                  <Text size='sm' ta='center' mt='xs'>
                    Entregado a: {selectedUserRow?.nombre_usuario ?? '-'}
                  </Text>
                </div>

                <Group>
                  <Text size='sm' fw={700}>
                    Entregado por:
                  </Text>
                  <Text size='sm'>{userName || '-'}</Text>
                </Group>

                <Divider />

                <Group justify='space-between' wrap='wrap'>
                  <Button
                    variant='light'
                    color='green'
                    leftSection={<IconUserPlus size={16} />}
                    onClick={() => setCreateUserModalOpened(true)}
                  >
                    Crear Usuario
                  </Button>
                  <Group>
                    <Button variant='outline' onClick={closeCreateActa} disabled={savingActa}>
                      Cancelar
                    </Button>
                    <Button
                      variant='outline'
                      color='gray'
                      leftSection={<IconEraser size={16} />}
                      onClick={() => createSignRef.current?.clear()}
                    >
                      Limpiar Firma
                    </Button>
                    <Button
                      leftSection={<IconDeviceFloppy size={16} />}
                      loading={savingActa}
                      onClick={handleSaveActa}
                      className='bg-blue-600 hover:bg-blue-700'
                    >
                      Guardar Acta
                    </Button>
                  </Group>
                </Group>
              </Stack>
            </Modal>

            <Modal
              opened={viewActaModalOpened}
              onClose={() => setViewActaModalOpened(false)}
              title={
                <Group>
                  <IconFileCertificate size={20} />
                  <Text size='lg' fw={600}>
                    Vista Acta de Entrega
                  </Text>
                </Group>
              }
              size='80%'
              radius='md'
              overlayProps={{ blur: 4 }}
            >
              <LoadingOverlay visible={actaLoading || savingDevolucion} />

              {actaError && (
                <Alert icon={<IconAlertCircle size={20} />} title='Acta' color='orange' mb='md'>
                  {actaError}
                </Alert>
              )}

              {acta && (
                <Stack>
                  <Group>
                    <Text size='sm' fw={700}>
                      Fecha de entrega:
                    </Text>
                    <Text size='sm'>{formatDate(acta.fecha_entrega)}</Text>
                  </Group>

                  <Text size='sm'>
                    {asset.empresa} hace entrega oficial de los equipos detallados, sobre los cuales se
                    capacitó para su uso al colaborador:
                  </Text>

                  <Grid gutter='lg'>
                    <Grid.Col span={{ base: 12, md: 4 }}>
                      <InfoItem label='Apellidos y nombres' value={acta.usuario} Icon={IconUser} />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, md: 4 }}>
                      <InfoItem label='Documento' value={acta.cedula} Icon={IconBarcode} />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, md: 4 }}>
                      <InfoItem label='Departamento' value={acta.departamento} Icon={IconBuilding} />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, md: 4 }}>
                      <InfoItem label='Cargo' value={acta.cargo} Icon={IconUser} />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, md: 4 }}>
                      <InfoItem label='Sede' value={acta.sede} Icon={IconMapPin} />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, md: 4 }}>
                      <InfoItem
                        label='Entregado por'
                        value={acta.nombre_tecnico_entrego}
                        Icon={IconUser}
                      />
                    </Grid.Col>
                  </Grid>

                  <Card withBorder radius='md' p='md' bg='gray.0'>
                    <Text size='sm' fw={600} mb='xs'>
                      Datos del equipo
                    </Text>
                    <div className='overflow-x-auto'>
                      <Table withTableBorder withColumnBorders>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Tipo Equipo</Table.Th>
                            <Table.Th>Serial</Table.Th>
                            <Table.Th>Etiqueta</Table.Th>
                            <Table.Th>Procesador</Table.Th>
                            <Table.Th>Modelo</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          <Table.Tr>
                            <Table.Td>{asset.tipo_equipo || '-'}</Table.Td>
                            <Table.Td>{asset.serial || '-'}</Table.Td>
                            <Table.Td>{asset.etiqueta || '-'}</Table.Td>
                            <Table.Td>{asset.procesador || '-'}</Table.Td>
                            <Table.Td>{asset.modelo || '-'}</Table.Td>
                          </Table.Tr>
                        </Table.Tbody>
                      </Table>
                    </div>
                  </Card>

                    <Text size='sm'>
                        {'El colaborador ha sido informado y acepta que la titularidad de los equipos entregados y de la ' +
                        'información en ellos contenida o que se llegue a procesar por parte del Colaborador(a), son de ' +
                        `${asset.empresa} por lo que se compromete a cumplir con las políticas establecidas por la empresa en ` +
                        'cuanto al hardware, software e información y a restituir los equipos en las condiciones originales ' +
                        'en que se recibe, en caso de que el equipo no sea devuelto en las mismas condiciones y el daño sea ' +
                        'ocasionado por el colaborador el costo de la reparación deberá ser asumido por él, la información y ' +
                        'demás elementos conexos deberán ser restituidos en las mismas condiciones recibidas, en caso de ' +
                        'terminación del contrato de trabajo, reemplazo del equipo, u otra situación que aboque a su retiro.'}
                    </Text>

                  <Grid gutter='lg'>
                    <Grid.Col span={{ base: 12, md: 6 }}>
                      <Text size='sm' fw={600} mb='xs'>
                        Firma de entrega
                      </Text>
                      <SignaturePadCanvas
                        height={160}
                        readOnly
                        imageSrc={acta.firma_recibio}
                      />
                      <Text size='sm' ta='center' mt='xs'>
                        Entregado a: {acta.usuario}
                      </Text>
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, md: 6 }}>
                      <Text size='sm' fw={600} mb='xs'>
                        Firma de devolución
                      </Text>
                      <SignaturePadCanvas
                        ref={devolutionSignRef}
                        height={160}
                        readOnly={Boolean(acta.firma_devolucion)}
                        imageSrc={acta.firma_devolucion}
                      />
                      <Text size='sm' ta='center' mt='xs'>
                        Devuelto por: {acta.usuario}
                      </Text>
                    </Grid.Col>
                  </Grid>

                  <Divider />

                  <Group
                    gap='xs'
                    style={{ cursor: 'pointer' }}
                    onClick={() => setShowDevolutionFields(!showDevolutionFields)}
                  >
                    <IconCheck size={16} />
                    <Text size='sm' fw={700}>
                      Devolución
                    </Text>
                  </Group>

                  <Collapse in={showDevolutionFields}>
                    <Grid gutter='lg'>
                      <Grid.Col span={{ base: 12, md: 6 }}>
                        <InfoItem
                          label='Fecha de devolución'
                          value={formatDate(acta.fecha_devolucion ?? todayInput())}
                          Icon={IconCalendarEvent}
                        />
                      </Grid.Col>
                      <Grid.Col span={{ base: 12, md: 6 }}>
                        <InfoItem
                          label='Recibido por'
                          value={acta.nombre_tecnico_recibio ?? userName}
                          Icon={IconUser}
                        />
                      </Grid.Col>
                    </Grid>
                  </Collapse>

                  <Divider />

                  <Group justify='flex-end'>
                    <Button variant='outline' onClick={() => setViewActaModalOpened(false)}>
                      Cerrar
                    </Button>
                    <Button
                      variant='outline'
                      color='gray'
                      leftSection={<IconEraser size={16} />}
                      onClick={() => devolutionSignRef.current?.clear()}
                      disabled={Boolean(acta.firma_devolucion)}
                    >
                      Limpiar Firma
                    </Button>
                    <Button
                      color='green'
                      leftSection={<IconDeviceFloppy size={16} />}
                      loading={savingDevolucion}
                      onClick={handleUpdateDevolucion}
                      disabled={Boolean(acta.firma_devolucion)}
                    >
                      Actualizar Devolución
                    </Button>
                  </Group>
                </Stack>
              )}
            </Modal>

            <Modal
              opened={createUserModalOpened}
              onClose={() => setCreateUserModalOpened(false)}
              title={
                <Group>
                  <IconUserPlus size={20} />
                  <Text size='lg' fw={600}>
                    Crear Usuario
                  </Text>
                </Group>
              }
              size='md'
              radius='md'
              zIndex={300}
              overlayProps={{ blur: 4 }}
            >
              <LoadingOverlay visible={creatingUser} />

              <Stack>
                <TextInput
                  label='Nombre'
                  placeholder='Nombre completo'
                  value={newUser.usuario}
                  onChange={(e) => setNewUser({ ...newUser, usuario: e.target.value })}
                  required
                  maxLength={254}
                  leftSection={<IconUser size={16} />}
                />
                <TextInput
                  label='Cargo'
                  placeholder='Cargo'
                  value={newUser.cargo}
                  onChange={(e) => setNewUser({ ...newUser, cargo: e.target.value })}
                  required
                  maxLength={254}
                  leftSection={<IconTag size={16} />}
                />
                <TextInput
                  label='Correo'
                  placeholder='correo@ejemplo.com'
                  value={newUser.correo}
                  onChange={(e) => setNewUser({ ...newUser, correo: e.target.value })}
                  maxLength={254}
                  leftSection={<IconMail size={16} />}
                />
                <TextInput
                  label='Cédula'
                  placeholder='Número de cédula'
                  value={newUser.cedula}
                  onChange={(e) => setNewUser({ ...newUser, cedula: e.target.value })}
                  required
                  maxLength={50}
                  leftSection={<IconBarcode size={16} />}
                />
                <Select
                  label='Departamento'
                  placeholder='Seleccionar departamento'
                  data={departmentOptions.map((d) => ({
                    value: String(d.id),
                    label: d.departamento,
                  }))}
                  searchable
                  value={newUser.id_departamento || null}
                  onChange={(value) => setNewUser({ ...newUser, id_departamento: value || '' })}
                  required
                  leftSection={<IconBuilding size={16} />}
                />

                <Divider />

                <Group justify='flex-end'>
                  <Button
                    variant='outline'
                    onClick={() => setCreateUserModalOpened(false)}
                    disabled={creatingUser}
                  >
                    Cancelar
                  </Button>
                  <Button color='green' loading={creatingUser} onClick={handleCreateUser}>
                    Crear
                  </Button>
                </Group>
              </Stack>
            </Modal>
          </>
        )}
      </div>
    </div>
  );
}

export default function ViewAssetPage() {
  return (
    <Suspense fallback={<div>Cargando...</div>}>
      <ViewAsset />
    </Suspense>
  );
}
