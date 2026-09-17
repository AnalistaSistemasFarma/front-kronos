'use client';

import { Suspense, useMemo, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import {
  Title,
  Text,
  Badge,
  Button,
  Group,
  Card,
  TextInput,
  Textarea,
  Select,
  Grid,
  Alert,
  LoadingOverlay,
  Breadcrumbs,
  Anchor,
  Flex,
  ActionIcon,
  Box,
  Collapse,
  Table,
  Stack,
  Loader,
  Checkbox,
  Modal,
  Tooltip,
  ThemeIcon,
  UnstyledButton,
  useComputedColorScheme,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconBuilding,
  IconChevronRight,
  IconAlertCircle,
  IconCheck,
  IconX,
  IconFilter,
  IconRefresh,
  IconCalendarEvent,
  IconUser,
  IconShieldCheck,
  IconClock,
  IconThumbUp,
  IconThumbDown,
  IconFileText,
  IconEye,
  IconNotes,
} from '@tabler/icons-react';
import toast from 'react-hot-toast';
import PaymentDetailModal from './PaymentDetailModal';
import axios from 'axios';
import { saveAs } from 'file-saver';
import { PDFDocument } from 'pdf-lib';
import ExcelJS from 'exceljs';
import { addDataSheet, downloadWorkbook } from '../../../../../lib/dashboard/excel/excelHelpers';
import { useGetMicrosoftToken as getMicrosoftToken } from '../../../../../components/microsoft-365/useGetMicrosoftToken';

function parseOrionFileIdFromAuthResolution(resolution?: string | null): string | null {
  const match = /\[orionFile:([^\]]+)\]/i.exec(String(resolution || ''));
  return match?.[1]?.trim() || null;
}

interface PaymentSchedulingTask {
  id_tarea: number;
  tarea: string;
  id_solicitud: number;
  id_estado_solicitud: number;
  estado_tarea: string;
  id_asignado_tarea: number;
  usuario_asignado: string;
  fecha_inicio_tarea?: string | null;
  fecha_fin_tarea?: string | null;
  activo?: number | null;
  resolución_tarea?: string | null;
  fecha_resolucion_tarea?: string | null;
  proceso_solicitud?: string | null;
  asunto_solicitud?: string | null;
  creador_solicitud?: string | null;
  descripción_solicitud?: string | null;
  id_empresa?: number | null;
  empresa?: string | null;
  fecha_creación_solicitud: string;
  id_creador_solicitud?: string | null;
  tipo_solicitud?: string | null;
  subtipo_solicitud?: string | null;
  valor_pagar?: number | null;
  fecha_solicitada_pago: string;
  acreedor?: string | null;
}

interface CompanyRow {
  id: number;
  empresa: string;
}

interface ConsultsResponse {
  companies: CompanyRow[];
}

const STATUS_OPTIONS = [
  { value: '0', label: 'Todos' },
  { value: '4', label: 'Pendiente' },
  { value: '2', label: 'Programado' },
  { value: '3', label: 'Rechazado' },
];

const TYPE_REQUEST_OPTIONS = [
  { value: '0', label: 'Todos' },
  { value: 'Giro a Empleados', label: 'Giro a Empleados' },
  { value: 'Anticipo a Terceros', label: 'Anticipo a Terceros' },
  { value: 'Pagos Exterior', label: 'Pagos Exterior' },
  { value: 'Pagos PSE', label: 'Pagos PSE' },
  { value: 'Pagos (Nomina)', label: 'Pagos (Nomina)' },
];

const SUBTYPE_REQUEST_OPTIONS = [
  { value: '0', label: 'Todos' },
  { value: 'AFC', label: 'AFC' },
  { value: 'Anticipo', label: 'Anticipo' },
  { value: 'Anticipos Viajes', label: 'Anticipos Viajes' },
  { value: 'Apostilla', label: 'Apostilla' },
  { value: 'Cámara y Comercio', label: 'Cámara y Comercio' },
  { value: 'Cesantias', label: 'Cesantias' },
  { value: 'Comercio', label: 'Comercio' },
  { value: 'Cuota-Sena', label: 'Cuota-Sena' },
  { value: 'Estampillas', label: 'Estampillas' },
  { value: 'Factura', label: 'Factura' },
  { value: 'Impuestos Distritales o Nacionales', label: 'Impuestos Distritales o Nacionales' },
  { value: 'Invima', label: 'Invima' },
  { value: 'Legalización - Reembolsos', label: 'Legalización - Reembolsos' },
  { value: 'Legalización de Tarjeta de Crédito', label: 'Legalización de Tarjeta de Crédito' },
  { value: 'Libranzas', label: 'Libranzas' },
  { value: 'Liquidación', label: 'Liquidación' },
  { value: 'Pago Nomina', label: 'Pago Nomina' },
  { value: 'Pago Prima', label: 'Pago Prima' },
  { value: 'Pagos Proveedores', label: 'Pagos Proveedores' },
  { value: 'Pila - Seguridad Social', label: 'Pila - Seguridad Social' },
  { value: 'Prestamos', label: 'Prestamos' },
  { value: 'Reembolsos Caja Menor', label: 'Reembolsos Caja Menor' },
  { value: 'Solicitud Caja Menor', label: 'Solicitud Caja Menor' },
  { value: 'Tributos Aduaneros', label: 'Tributos Aduaneros' },
  { value: 'Vacaciones', label: 'Vacaciones' },
];

const getStatusColor = (status: string) => {
  switch (status) {
    case 'Sin Empezar':
      return 'yellow';
    case 'Resuelto':
      return 'green';
    case 'Cancelado':
      return 'red';
    default:
      return 'gray';
  }
};

const getStatusLabel = (status: string) => {
  switch (status) {
    case 'Sin Empezar':
      return 'Pendiente';
    case 'Resuelto':
      return 'Programado';
    case 'Devuelta':
      return 'Rechazado';
    case 'Cancelado':
      return 'Cancelado';
    default:
      return status;
  }
};

const formatShortDate = (value?: string | null) => {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('es-CO', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(new Date(value).getTime() + 5 * 60 * 60 * 1000));
  } catch {
    return String(value);
  }
};

const formatCurrency = (value?: number | string | null) => {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(String(value).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  });
};

const splitAcreedor = (value?: string | null): { doc: string; name: string } => {
  const raw = String(value || '').trim();
  if (!raw) return { doc: '', name: '' };
  const idx = raw.indexOf(' - ');
  if (idx === -1) return { doc: '', name: raw };
  return { doc: raw.slice(0, idx).trim(), name: raw.slice(idx + 3).trim() };
};

function PaymentSchedulingBoard() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const isMobile = useMediaQuery('(max-width: 768px)');
    const computedColorScheme = useComputedColorScheme('light', { getInitialValueInEffect: true });
    const dateInputStyles = { input: { colorScheme: computedColorScheme } };

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const userName = session?.user?.name || '';
    const [userIdInitialized, setUserIdInitialized] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);

    const [payments, setPayments] = useState<PaymentSchedulingTask[]>([]);
    const [listsLoading, setListsLoading] = useState(false);
    const [companyOptions, setCompanyOptions] = useState<CompanyRow[]>([]);

    const [filters, setFilters] = useState({
        id_tarea: '',
        id_solicitud: '',
        tipo_solicitud: '0',
        subtipo_solicitud: '0',
        status: '0',
        company: '0',
        date_from: '',
        date_to: '',
    });
    const [filtersExpanded, setFiltersExpanded] = useState(false);

    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

    const [rejectModalOpened, setRejectModalOpened] = useState(false);
    const [authorizeModalOpened, setAuthorizeModalOpened] = useState(false);
    const [rejectReason, setRejectReason] = useState('');
    const [rejectReasonError, setRejectReasonError] = useState(false);
    const [actionTarget, setActionTarget] = useState<number | null>(null);

    const [detailModalOpened, setDetailModalOpened] = useState(false);
    const [detailRequest, setDetailRequest] = useState<PaymentSchedulingTask | null>(null);
    const openDetailModal = (req: PaymentSchedulingTask) => {
        setDetailRequest(req);
        setDetailModalOpened(true);
    };

    const [departmentUser, setDepartmentUser] = useState<{
    departments: Array<{
        departments: number;
    }>;
    
    }>({ departments: []});

    useEffect(() => {
        if (status === 'loading') return;
        if (!session) {
          router.push('/login');
          return;
        }
    
        if (!userIdInitialized) {
          if (userName && !userId) {
            getUserIdByName(userName).then((id) => {
              if (id) {
                setUserId(id);
                setUserIdInitialized(true);
                fetchDepartments(id);
                fetchPayments(id, filters);
                fetchLists();
              } else {
                setUserIdInitialized(true);
              }
            });
          } else if (!userName) {
            setUserIdInitialized(true);
          }
        }
    }, [status, session, userName, userId, userIdInitialized, router]);

    const filteredRequests = payments;

    const selectableRequests = useMemo(
        () => filteredRequests.filter((r) => r.estado_tarea === 'Sin Empezar'),
        [filteredRequests]
    );

    const stats = useMemo(
        () => ({
        total: payments.length,
        pendientes: payments.filter((r) => r.estado_tarea === 'Sin Empezar').length,
        autorizadas: payments.filter((r) => r.estado_tarea === 'Resuelto').length,
        rechazadas: payments.filter((r) => r.estado_tarea === 'Cancelado').length,
        }),
        [payments]
    );

    const allSelectableSelected =
        selectableRequests.length > 0 && selectableRequests.every((r) => selectedIds.has(r.id_tarea));
    const someSelectableSelected = selectableRequests.some((r) => selectedIds.has(r.id_tarea));

    const getUserIdByName = async (userName: string): Promise<string | null> => {
        if (!session || status !== 'authenticated') {
            console.error('No hay sesión activa para realizar esta operación');
            return null;
        }

        if (!userName || userName.trim() === '') {
            console.error('El nombre de usuario es requerido');
            return null;
        }

        try {

        const params = new URLSearchParams({
            userName: userName.trim(),
        });

        const response = await fetch(`/api/requests-general/get-user-id?${params}`, {
            method: 'GET',
            headers: {
            'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('Error al obtener ID de usuario:', errorData.error);
            return null;
        }

        const data = await response.json();
        return data.success ? data.userId : null;
        } catch (error) {
            console.error('Error en la llamada al endpoint:', error);
            return null;
        }
    };

    const fetchLists = async () => {
        try {
        setListsLoading(true);
        const response = await fetch('/api/assets/consults-assets');
        if (!response.ok) throw new Error('Failed to fetch asset lists');

        const data: ConsultsResponse = await response.json();

        setCompanyOptions(Array.isArray(data.companies) ? data.companies : []);

        } catch (err) {
        console.error('Error fetching companies lists:', err);
        toast.error('No se pudieron cargar las listas de empresas.');
        } finally {
        setListsLoading(false);
        }
    };

    const fetchPayments = async (id: string, f = filters) => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ idUser: id });
            params.set('id_tarea', f.id_tarea || '');
            params.set('id_solicitud', f.id_solicitud || '');
            params.set('tipo_solicitud', f.tipo_solicitud || '0');
            params.set('subtipo_solicitud', f.subtipo_solicitud || '0');
            params.set('status', f.status || '0');
            params.set('company', f.company || '0');
            params.set('date_from', f.date_from || '');
            params.set('date_to', f.date_to || '');

            const response = await fetch(
                `/api/payment-scheduling?${params.toString()}`,
                { cache: 'no-store' }
            );

            if (!response.ok) {
                const err = await response.json().catch(() => null);
                throw new Error(err?.error || 'No se pudieron cargar los pagos');
            }

            const data: PaymentSchedulingTask[] = await response.json();

            setPayments(data);

        } catch (e) {
            console.error('Error fetching payment scheduling tasks:', e);
            setError(e instanceof Error ? e.message : 'Error al cargar pagos');
            setPayments([]);
        } finally {
            setLoading(false);
        }
    };

    const fetchDepartments = async (userIdParam?: string) => {
        try {
        const idUser = userIdParam || '';
        const url = `/api/authorization/authorization-departments?userId=${idUser}`;

        const response = await fetch(url);
        const data = await response.json();

        setDepartmentUser(data);

        } catch (error) {
        console.error('Error fetching workflow data:', error);
        } 
    };

    const handleFilterChange = (field: string, value: string) => {
        setFilters((prev) => ({ ...prev, [field]: value }));
    };

    const applyFilters = () => {
        setSelectedIds(new Set());
        if (userId) fetchPayments(userId, filters);
    };

    const clearFilters = () => {
        const empty = { id_tarea: '', id_solicitud: '', status: '0', company: '', date_from: '', date_to: '', tipo_solicitud: '0', subtipo_solicitud: '0' };
        setFilters(empty);
        setSelectedIds(new Set());
        if (userId) fetchPayments(userId, empty);
    };

    const toggleSelect = (id: number) => {
        setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
        });
    };

    const toggleSelectAll = () => {
        setSelectedIds((prev) => {
        if (selectableRequests.length > 0 && selectableRequests.every((r) => prev.has(r.id_tarea))) {
            return new Set();
        }
        return new Set(selectableRequests.map((r) => r.id_tarea));
        });
    };

    const openAuthorizeModal = (target: number | null) => {
        setActionTarget(target);
        setAuthorizeModalOpened(true);
    };

    const openRejectModal = (target: number | null) => {
        setActionTarget(target);
        setRejectReason('');
        setRejectReasonError(false);
        setRejectModalOpened(true);
    };

    const targetIds = (): number[] =>
        actionTarget !== null ? [actionTarget] : Array.from(selectedIds);

    const updateActivityStatus = async (
        taskId: number,
        idStatus: number,
        resolution: string | null
    ): Promise<{ ok: boolean; error?: string }> => {
        try {
            const response = await fetch('/api/requests-general/update-activities', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: taskId,
                    id_status: idStatus,
                    id_assigned: userId,
                    resolution,
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                return {
                    ok: false,
                    error: typeof data.error === 'string' ? data.error : `Error ${response.status}`,
                };
            }
            return { ok: true };
        } catch (e) {
            console.error('Error updating activity', taskId, e);
            return { ok: false, error: 'Error de red al autorizar' };
        }
    };

    const goToRelatedRequest = (req: PaymentSchedulingTask) => {
        if (!req.id_solicitud) return;
        const fileId = parseOrionFileIdFromAuthResolution(req.resolución_tarea);
        router.push(
            `/process/request-general/view-activities?id=${req.id_tarea}&from=payments-scheduling`
        );
    };

    const downloadPaymentPlano = async (rows: PaymentSchedulingTask[]) => {
        const columns = [
            { header: 'ID Solicitud', key: 'id', width: 12 },
            { header: 'Empresa', key: 'empresa', width: 26 },
            { header: 'Tipo', key: 'tipo', width: 22 },
            { header: 'Subtipo', key: 'subtipo', width: 24 },
            { header: 'Documento', key: 'documento', width: 16 },
            { header: 'Acreedor', key: 'acreedor', width: 30 },
            { header: 'Valor a Pagar', key: 'valor', width: 16 },
            { header: 'Fecha Solicitada de Pago', key: 'fecha', width: 20 },
            { header: 'Solicitante', key: 'solicitante', width: 24 },
            { header: 'Estado', key: 'estado', width: 14 },
        ];
        const data = rows.map((r) => {
            const a = splitAcreedor(r.acreedor);
            const valor = Number(String(r.valor_pagar ?? '').replace(/[^\d.-]/g, ''));
            return {
                id: r.id_solicitud,
                empresa: r.empresa ?? '',
                tipo: r.tipo_solicitud ?? '',
                subtipo: r.subtipo_solicitud ?? '',
                documento: a.doc,
                acreedor: a.name,
                valor: Number.isFinite(valor) ? valor : '',
                fecha: formatShortDate(r.fecha_solicitada_pago),
                solicitante: r.creador_solicitud ?? r.usuario_asignado ?? '',
                estado: 'Programado',
            };
        });

        const wb = new ExcelJS.Workbook();
        const ws = addDataSheet(wb, 'Pagos programados', columns, data);
        ws.getColumn(columns.findIndex((c) => c.key === 'valor') + 1).numFmt = '#,##0';

        const stamp = new Date().toISOString().slice(0, 10);
        await downloadWorkbook(wb, `plano-pagos-${stamp}.xlsx`);
    };

    const downloadConsolidatedPdf = async (rows: PaymentSchedulingTask[]): Promise<number> => {
        const token = await getMicrosoftToken();
        if (!token) throw new Error('No se pudo obtener el token de acceso a OneDrive.');

        const base = process.env.MICROSOFTGRAPHUSERROUTE;
        const merged = await PDFDocument.create();
        let mergedCount = 0;

        for (const r of rows) {
            const folder = `Request-${r.id_solicitud}`;
            let children: Array<{
                id: string;
                name?: string;
                file?: unknown;
                '@microsoft.graph.downloadUrl'?: string;
            }> = [];
            try {
                const res = await axios.get(
                    `${base}root:/SAPSEND/TEC/SG/${folder}:/children`,
                    { headers: { Authorization: `Bearer ${token}` } }
                );
                children = res.data?.value ?? [];
            } catch (err) {
                if (axios.isAxiosError(err) && err.response?.status === 404) continue;
                throw err;
            }

            const pdfs = children.filter(
                (it) => it.file && /\.pdf$/i.test(String(it.name || ''))
            );

            for (const pdf of pdfs) {
                const downloadUrl = pdf['@microsoft.graph.downloadUrl'];
                const bytesRes = downloadUrl
                    ? await axios.get(downloadUrl, { responseType: 'arraybuffer' })
                    : await axios.get(`${base}items/${pdf.id}/content`, {
                          responseType: 'arraybuffer',
                          headers: { Authorization: `Bearer ${token}` },
                      });
                try {
                    const src = await PDFDocument.load(bytesRes.data, { ignoreEncryption: true });
                    const pages = await merged.copyPages(src, src.getPageIndices());
                    pages.forEach((p) => merged.addPage(p));
                    mergedCount += 1;
                } catch (loadErr) {
                    console.error(`No se pudo agregar el PDF "${pdf.name}":`, loadErr);
                }
            }
        }

        if (mergedCount === 0) return 0;

        const bytes = await merged.save();
        const stamp = new Date().toISOString().slice(0, 10);
        saveAs(
            new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }),
            `consolidado-pagos-${stamp}.pdf`
        );
        return mergedCount;
    };

    const confirmAuthorize = async () => {
        if (!userId) return;
        const ids = targetIds();
        if (ids.length === 0) return;

        const authorizedRows = payments.filter((r) => ids.includes(r.id_tarea));

        setLoading(true);
        setAuthorizeModalOpened(false);
        try {
            const results = await Promise.all(
                authorizedRows.map(async (row) => {

                    const updated = await updateActivityStatus(row.id_tarea, 2, 'Solicitud Autorizada Correctamente');
                    return {
                        ok: updated.ok,
                        error: updated.error,
                        row,
                        fileId: parseOrionFileIdFromAuthResolution(row.resolución_tarea),
                        signTaskId: null as number | null,
                    };
                })
            );

            const okResults = results.filter((r) => r.ok);
            const fail = results.length - okResults.length;
            const failMessage = results.find((r) => !r.ok)?.error;

            setSelectedIds(new Set());
            if (fail > 0) {
                toast.error(failMessage || `${fail} solicitud(es) no se pudieron autorizar`);
            }

            if (okResults.length > 0) {
                toast.success(
                    okResults.length > 1
                        ? `${okResults.length} solicitudes autorizadas`
                        : 'Solicitud autorizada'
                );

                const executedRows = okResults.map((r) => r.row);
                try {
                    await downloadPaymentPlano(executedRows);
                } catch (e) {
                    console.error('Error generando el plano Excel:', e);
                    toast.error('Los pagos se ejecutaron, pero no se pudo generar el plano Excel.');
                }

                try {
                    const merged = await downloadConsolidatedPdf(executedRows);
                    if (merged === 0) {
                        toast('No se encontraron PDF adjuntos para el consolidado.', { icon: 'ℹ️' });
                    }
                } catch (e) {
                    console.error('Error generando el PDF consolidado:', e);
                    toast.error('Los pagos se ejecutaron, pero no se pudo generar el PDF consolidado.');
                }
            }
            await fetchPayments(userId, filters);
            setLoading(false);
        } catch {
            setLoading(false);
        }
    };

    const confirmReject = async () => {
        if (!rejectReason.trim()) {
            setRejectReasonError(true);
            return;
        }
        if (!userId) return;
        const ids = targetIds();
        if (ids.length === 0) return;

        setLoading(true);
        const reason = rejectReason.trim();
        const results = await Promise.all(ids.map((id) => updateActivityStatus(id, 3, reason)));
        const ok = results.filter((r) => r.ok).length;
        const fail = results.length - ok;

        setRejectModalOpened(false);
        setSelectedIds(new Set());
        if (ok > 0) {
            toast.success(ok > 1 ? `${ok} solicitudes rechazadas` : 'Solicitud rechazada');
        }
        if (fail > 0) {
            toast.error(`${fail} solicitud(es) no se pudieron rechazar`);
        }
        await fetchPayments(userId, filters);
    };

    const companySelectData = companyOptions.map((c) => ({
        value: String(c.id),
        label: c.empresa,
    }));

    const actionCount = actionTarget !== null ? 1 : selectedIds.size;

    const breadcrumbItems = [
        { title: 'Procesos', href: '/process' },
        { title: 'Programador de Pagos', href: '#' },
    ].map((item, index) =>
        item.href !== '#' ? (
        <Link key={index} href={item.href} passHref>
            <Anchor component='span'>{item.title}</Anchor>
        </Link>
        ) : (
        <span key={index} className='text-gray-500'>
            {item.title}
        </span>
        )
    );

    if (status === 'loading') {
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

    const renderRow = (req: PaymentSchedulingTask) => {
        const isPending = req.estado_tarea === 'Sin Empezar';
        const acreedor = splitAcreedor(req.acreedor);
        return (
        <Table.Tr
            key={req.id_tarea}
            bg={selectedIds.has(req.id_tarea) ? 'var(--mantine-color-blue-light)' : undefined}
        >
            <Table.Td>
            <Checkbox
                checked={selectedIds.has(req.id_tarea)}
                onChange={() => toggleSelect(req.id_tarea)}
                disabled={!isPending}
                aria-label={`Seleccionar solicitud ${req.id_tarea}`}
            />
            </Table.Td>
            <Table.Td>
            <UnstyledButton
                onClick={() => goToRelatedRequest(req)}
                style={{ display: 'block' }}
                aria-label={`Abrir Tarea ${req.id_tarea}`}
            >
                <Text size='sm' fw={700} c='var(--mantine-color-blue-light-color)'>
                    #{req.id_tarea}
                </Text>
            </UnstyledButton>
            </Table.Td>
            <Table.Td style={{ minWidth: 150, maxWidth: 220 }}>
            <Text size='sm' fw={500} lineClamp={2}>
                {req.tipo_solicitud || '—'}
            </Text>
            {req.subtipo_solicitud && (
                <Text size='xs' c='dimmed' lineClamp={2}>
                    {req.subtipo_solicitud}
                </Text>
            )}
            </Table.Td>
            <Table.Td style={{ minWidth: 150, maxWidth: 220 }}>
            <Group gap={6} wrap='nowrap'>
                <IconBuilding size={16} className='text-gray-400' style={{ flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                    <Text size='sm' fw={500} truncate>
                        {req.usuario_asignado}
                    </Text>
                    <Text size='xs' c='dimmed' truncate>
                        {req.empresa}
                    </Text>
                </div>
            </Group>
            </Table.Td>
            <Table.Td style={{ minWidth: 160, maxWidth: 240 }}>
                <Group gap={6} wrap='nowrap'>
                    <IconUser size={16} className='text-gray-400' style={{ flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                        <Text size='sm' fw={500} lineClamp={2}>
                            {acreedor.name || '—'}
                        </Text>
                        {acreedor.doc && (
                            <Text size='xs' c='dimmed' truncate>
                                {acreedor.doc}
                            </Text>
                        )}
                    </div>
                </Group>
            </Table.Td>
            <Table.Td>
                <Group gap={6} wrap='nowrap'>
                    <IconCalendarEvent size={16} className='text-gray-400' style={{ flexShrink: 0 }} />
                    <Text size='sm' c='dimmed' style={{ whiteSpace: 'nowrap' }}>
                    {formatShortDate(req.fecha_solicitada_pago)}
                    </Text>
                </Group>
            </Table.Td>
            <Table.Td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <Text size='sm' fw={600} style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatCurrency(req.valor_pagar)}
                </Text>
            </Table.Td>
            <Table.Td style={{ whiteSpace: 'nowrap', minWidth: 120 }}>
            <UnstyledButton
                onClick={() => goToRelatedRequest(req)}
                aria-label={`Ir a solicitud ${req.id_solicitud}`}
            >
                <Badge variant='light' color={getStatusColor(req.estado_tarea)} size='sm'>
                    {getStatusLabel(req.estado_tarea)}
                </Badge>
            </UnstyledButton>
            </Table.Td>
            <Table.Td style={{ whiteSpace: 'nowrap' }}>
            <Group gap='xs' wrap='nowrap' justify='center'>
                <Tooltip label='Ir a la solicitud'>
                <ActionIcon
                    variant='light'
                    color='blue'
                    onClick={() => goToRelatedRequest(req)}
                    aria-label='Ir a la solicitud'
                >
                    <IconEye size={16} />
                </ActionIcon>
                </Tooltip>
                <Tooltip label='Ver detalle'>
                <ActionIcon
                    variant='subtle'
                    color='gray'
                    onClick={() => openDetailModal(req)}
                    aria-label='Ver detalle'
                >
                    <IconNotes size={16} />
                </ActionIcon>
                </Tooltip>
            </Group>
            </Table.Td>
        </Table.Tr>
        );
    };

    const renderCard = (req: PaymentSchedulingTask) => {
        const isPending = req.estado_tarea === 'Sin Empezar';
        const acreedorCard = splitAcreedor(req.acreedor);
        return (
        <Card
            key={req.id_tarea}
            withBorder
            radius='md'
            p='md'
            style={{
            backgroundColor: selectedIds.has(req.id_tarea) ? 'var(--mantine-color-blue-light)' : undefined,
            }}
        >
            <Stack gap='xs'>
            <Group justify='space-between' wrap='nowrap'>
                <Group gap='xs' wrap='nowrap'>
                <Checkbox
                    checked={selectedIds.has(req.id_tarea)}
                    onChange={() => toggleSelect(req.id_tarea)}
                    disabled={!isPending}
                    aria-label={`Seleccionar solicitud ${req.id_solicitud}`}
                />
                <UnstyledButton onClick={() => goToRelatedRequest(req)}>
                <Text size='sm' fw={700} c='var(--mantine-color-blue-light-color)'>
                    #{req.id_tarea}
                </Text>
                </UnstyledButton>
                </Group>
                <UnstyledButton onClick={() => goToRelatedRequest(req)}>
                <Badge variant='light' color={getStatusColor(req.estado_tarea)} size='sm'>
                {getStatusLabel(req.estado_tarea)}
                </Badge>
                </UnstyledButton>
            </Group>

            <UnstyledButton onClick={() => goToRelatedRequest(req)} style={{ textAlign: 'left' }}>
            <Text size='sm' fw={500} lineClamp={2}>
                {req.tipo_solicitud || '—'}
            </Text>
            {req.subtipo_solicitud && (
                <Text size='xs' c='dimmed' lineClamp={2}>
                    {req.subtipo_solicitud}
                </Text>
            )}
            </UnstyledButton>

            <Group gap={6} wrap='nowrap'>
                <IconBuilding size={14} className='text-gray-400' style={{ flexShrink: 0 }} />
                <Text size='sm' truncate>{req.empresa}</Text>
                <Badge variant='light' color='indigo' size='xs' ml='auto' style={{ flexShrink: 0 }}>
                {req.usuario_asignado}
                </Badge>
            </Group>

            <Group gap={6} wrap='nowrap' align='flex-start'>
                <IconUser size={14} className='text-gray-400' style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ minWidth: 0 }}>
                    <Text size='sm'>{acreedorCard.name || '—'}</Text>
                    {acreedorCard.doc && (
                        <Text size='xs' c='dimmed'>{acreedorCard.doc}</Text>
                    )}
                </div>
            </Group>

            <Group gap={6} wrap='nowrap'>
                <IconCalendarEvent size={14} className='text-gray-400' />
                <Text size='xs' c='dimmed'>
                {formatShortDate(req.fecha_solicitada_pago)}
                </Text>
            </Group>

            <Group
                justify='space-between'
                wrap='nowrap'
                mt={4}
                px='sm'
                py={6}
                style={{
                    backgroundColor: 'var(--mantine-color-gray-0)',
                    borderRadius: 'var(--mantine-radius-sm)',
                }}
            >
                <Text size='xs' c='dimmed' fw={600} tt='uppercase'>
                    Valor a pagar
                </Text>
                <Text size='sm' fw={700} style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatCurrency(req.valor_pagar)}
                </Text>
            </Group>

            <Button
                size='xs'
                variant='light'
                color='blue'
                mt='xs'
                fullWidth
                leftSection={<IconEye size={14} />}
                onClick={() => goToRelatedRequest(req)}
            >
                Ir a la solicitud
            </Button>

            <Button
                size='xs'
                variant='subtle'
                color='gray'
                fullWidth
                leftSection={<IconNotes size={14} />}
                onClick={() => openDetailModal(req)}
            >
                Ver detalle
            </Button>

            </Stack>
        </Card>
        );
    };

    return (
        <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
        <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
            <Card shadow='sm' p='xl' radius='md' withBorder mb='lg'>
            <Breadcrumbs separator={<IconChevronRight size={16} />} className='mb-4'>
                {breadcrumbItems}
            </Breadcrumbs>

            <Flex justify='space-between' align='center' mb='lg'>
                <div>
                <Title order={1} className='text-3xl font-bold mb-2 flex items-center gap-3'>
                    <IconShieldCheck size={32} className='text-blue-600' />
                    Programador de Pagos
                </Title>
                <Text size='lg' c='dimmed'>
                    Tablero para realizar flujo de caja
                </Text>
                </div>
            </Flex>

            <Grid gutter='md'>
                {[
                { label: 'Total', value: stats.total, color: 'blue', icon: IconFileText },
                { label: 'Pendientes', value: stats.pendientes, color: 'yellow', icon: IconClock },
                { label: 'Autorizadas', value: stats.autorizadas, color: 'green', icon: IconCheck },
                { label: 'Rechazadas', value: stats.rechazadas, color: 'red', icon: IconX },
                ].map((s) => {
                const StatIcon = s.icon;
                return (
                    <Grid.Col span={{ base: 6, md: 3 }} key={s.label}>
                    <Card
                        p='md'
                        radius='md'
                        withBorder
                        style={{ borderLeft: `4px solid var(--mantine-color-${s.color}-6)`, height: '100%' }}
                    >
                        <Group justify='space-between' align='flex-start' wrap='nowrap'>
                        <div>
                            <Text size='xs' c='dimmed' fw={600} tt='uppercase'>
                            {s.label}
                            </Text>
                            <Text fw={700} style={{ fontSize: '1.75rem', lineHeight: 1.15 }}>
                            {s.value}
                            </Text>
                        </div>
                        <ThemeIcon variant='light' color={s.color} size={40} radius='md'>
                            <StatIcon size={22} />
                        </ThemeIcon>
                        </Group>
                    </Card>
                    </Grid.Col>
                );
                })}
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

            <Card shadow='sm' p='lg' radius='md' withBorder mb='lg'>
            <Group justify='space-between' mb='md'>
                <Title order={3} className='flex items-center gap-2'>
                <IconFilter size={20} />
                Filtros de Búsqueda
                </Title>
                <ActionIcon
                variant='subtle'
                onClick={() => setFiltersExpanded(!filtersExpanded)}
                aria-label={filtersExpanded ? 'Ocultar filtros' : 'Mostrar filtros'}
                >
                {filtersExpanded ? <IconX size={16} /> : <IconFilter size={16} />}
                </ActionIcon>
            </Group>

            <Collapse in={filtersExpanded}>
                <Box mt='md'>
                <Grid>
                    <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                    <TextInput
                        label='ID de Tarea'
                        type='text'
                        value={filters.id_tarea}
                        onChange={(e) => handleFilterChange('id_tarea', e.target.value)}
                        leftSection={<IconFilter size={16} />}
                    />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                    <TextInput
                        label='ID de Solicitud'
                        type='text'
                        value={filters.id_solicitud}
                        onChange={(e) => handleFilterChange('id_solicitud', e.target.value)}
                        leftSection={<IconFilter size={16} />}
                    />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                    <Select
                        label='Tipo de Solicitud'
                        placeholder='Todos los tipos'
                        clearable
                        data={TYPE_REQUEST_OPTIONS}
                        value={filters.tipo_solicitud || null}
                        onChange={(value) => handleFilterChange('tipo_solicitud', value || '')}
                    />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                    <Select
                        label='Subtipo de Solicitud'
                        placeholder='Todos los tipos'
                        clearable
                        data={SUBTYPE_REQUEST_OPTIONS}
                        value={filters.subtipo_solicitud || null}
                        onChange={(value) => handleFilterChange('subtipo_solicitud', value || '')}
                    />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                    <Select
                        label='Estado'
                        placeholder='Todos los estados'
                        clearable
                        data={STATUS_OPTIONS}
                        value={filters.status || null}
                        onChange={(value) => handleFilterChange('status', value || '')}
                    />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                    <Select
                        label='Empresa'
                        placeholder='Todas las empresas'
                        clearable
                        searchable
                        data={companySelectData}
                        value={filters.company || null}
                        onChange={(value) => handleFilterChange('company', value || '')}
                        leftSection={<IconBuilding size={16} />}
                    />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                    <TextInput
                        label='Fecha Desde'
                        type='date'
                        value={filters.date_from}
                        onChange={(e) => handleFilterChange('date_from', e.target.value)}
                        leftSection={<IconCalendarEvent size={16} />}
                        styles={dateInputStyles}
                    />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
                    <TextInput
                        label='Fecha Hasta'
                        type='date'
                        value={filters.date_to}
                        onChange={(e) => handleFilterChange('date_to', e.target.value)}
                        leftSection={<IconCalendarEvent size={16} />}
                        styles={dateInputStyles}
                    />
                    </Grid.Col>
                </Grid>

                <Group justify='flex-end' mt='md'>
                    <Button variant='outline' leftSection={<IconX size={16} />} onClick={clearFilters}>
                    Limpiar Filtros
                    </Button>
                    <Button leftSection={<IconRefresh size={16} />} onClick={applyFilters}>
                    Aplicar Filtros
                    </Button>
                </Group>
                </Box>
            </Collapse>
            </Card>

            {selectedIds.size > 0 && (
            <Card
                shadow='sm'
                p='md'
                radius='md'
                withBorder
                mb='lg'
                style={{ backgroundColor: 'var(--mantine-color-blue-light)' }}
            >
                <Flex
                justify='space-between'
                align={{ base: 'stretch', sm: 'center' }}
                direction={{ base: 'column', sm: 'row' }}
                gap='sm'
                >
                <Group gap='xs'>
                    <ThemeIcon variant='light' color='blue' radius='xl'>
                    <IconShieldCheck size={16} />
                    </ThemeIcon>
                    <Text fw={600}>{selectedIds.size} seleccionada(s)</Text>
                </Group>
                <Group grow={isMobile}>
                    <Button
                    color='green'
                    leftSection={<IconCheck size={16} />}
                    onClick={() => openAuthorizeModal(null)}
                    >
                    Programar seleccionadas
                    </Button>
                    <Button
                    color='red'
                    leftSection={<IconX size={16} />}
                    onClick={() => openRejectModal(null)}
                    >
                    Rechazar seleccionadas
                    </Button>
                </Group>
                </Flex>
            </Card>
            )}

            <Card shadow='sm' radius='md' withBorder className='overflow-hidden' pos='relative'>
            <LoadingOverlay
                visible={loading}
                zIndex={20}
                overlayProps={{ blur: 1 }}
            />

            <Group justify='space-between' mb='md'>
                <Title order={3} className='flex items-center gap-2'>
                <IconShieldCheck size={20} />
                Solicitudes por autorizar
                </Title>
                {!isMobile && selectableRequests.length > 0 && (
                <Checkbox
                    label='Seleccionar todo'
                    checked={allSelectableSelected}
                    indeterminate={someSelectableSelected && !allSelectableSelected}
                    onChange={toggleSelectAll}
                />
                )}
            </Group>

            {filteredRequests.length === 0 ? (
                <Stack align='center' gap='xs' py='xl'>
                <IconShieldCheck size={48} className='text-gray-300' />
                <Text size='lg' fw={500}>
                    No se encontraron solicitudes
                </Text>
                <Text size='sm' c='dimmed'>
                    No hay solicitudes que coincidan con los filtros
                </Text>
                </Stack>
            ) : isMobile ? (
                <Stack gap='sm'>
                {selectableRequests.length > 0 && (
                    <Checkbox
                    label='Seleccionar todo'
                    checked={allSelectableSelected}
                    indeterminate={someSelectableSelected && !allSelectableSelected}
                    onChange={toggleSelectAll}
                    />
                )}
                {filteredRequests.map(renderCard)}
                </Stack>
            ) : (
                <div className='overflow-x-auto'>
                <Table striped highlightOnHover verticalSpacing='sm' horizontalSpacing='md'>
                    <Table.Thead
                        style={{
                            backgroundColor:
                                'light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))',
                        }}
                    >
                    <Table.Tr>
                        <Table.Th w={40}>
                        <Checkbox
                            checked={allSelectableSelected}
                            indeterminate={someSelectableSelected && !allSelectableSelected}
                            onChange={toggleSelectAll}
                            disabled={selectableRequests.length === 0}
                            aria-label='Seleccionar todo'
                        />
                        </Table.Th>
                        <Table.Th>ID</Table.Th>
                        <Table.Th>Tipo</Table.Th>
                        <Table.Th>Solicitante</Table.Th>
                        <Table.Th>Acreedor</Table.Th>
                        <Table.Th>Fecha de pago</Table.Th>
                        <Table.Th ta='right'>Valor</Table.Th>
                        <Table.Th>Estado</Table.Th>
                        <Table.Th ta='center'>Acciones</Table.Th>
                    </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>{filteredRequests.map(renderRow)}</Table.Tbody>
                </Table>
                </div>
            )}
            </Card>
        </div>

        <Modal
            opened={authorizeModalOpened}
            onClose={() => setAuthorizeModalOpened(false)}
            title='Confirmar autorización'
            centered
        >
            <Stack>
            <Group gap='sm'>
                <ThemeIcon variant='light' color='green' size='lg' radius='xl'>
                <IconThumbUp size={20} />
                </ThemeIcon>
                <Text>
                ¿Deseas autorizar{' '}
                <strong>
                    {actionCount} solicitud{actionCount !== 1 ? 'es' : ''}
                </strong>
                ?
                </Text>
            </Group>
            <Group justify='flex-end'>
                <Button
                    variant='default'
                    onClick={() => setAuthorizeModalOpened(false)}
                    disabled={loading}
                >
                Cancelar
                </Button>
                <Button
                    color='green'
                    leftSection={<IconCheck size={16} />}
                    onClick={() => void confirmAuthorize()}
                    loading={loading}
                >
                Autorizar
                </Button>
            </Group>
            </Stack>
        </Modal>

        <Modal
            opened={rejectModalOpened}
            onClose={() => setRejectModalOpened(false)}
            title={`Rechazar ${actionCount} solicitud${actionCount !== 1 ? 'es' : ''}`}
            centered
        >
            <Stack>
            <Text size='sm' c='dimmed'>
                Indica el motivo del rechazo. Esta información será visible para el solicitante.
            </Text>
            <Textarea
                label='Motivo del rechazo'
                placeholder='Escribe el motivo...'
                required
                minRows={3}
                autosize
                value={rejectReason}
                error={rejectReasonError ? 'El motivo es obligatorio' : undefined}
                onChange={(e) => {
                setRejectReason(e.currentTarget.value);
                if (rejectReasonError) setRejectReasonError(false);
                }}
            />
            <Group justify='flex-end'>
                <Button variant='default' onClick={() => setRejectModalOpened(false)}>
                Cancelar
                </Button>
                <Button color='red' leftSection={<IconX size={16} />} onClick={confirmReject}>
                Rechazar
                </Button>
            </Group>
            </Stack>
        </Modal>

        <PaymentDetailModal
            opened={detailModalOpened}
            onClose={() => setDetailModalOpened(false)}
            request={detailRequest}
        />

        </div>
    );
    }

    export default function PaymentSchedulingPage() {
    return (
        <Suspense
        fallback={
            <div className='min-h-screen flex items-center justify-center'>
            <Loader size='lg' />
            </div>
        }
        >
        <PaymentSchedulingBoard />
        </Suspense>
    );
}
