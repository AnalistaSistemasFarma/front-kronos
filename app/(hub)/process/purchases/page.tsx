'use client';

import React, { useState, useEffect, useMemo } from 'react';
import ExcelJS from 'exceljs';
import { useSession } from 'next-auth/react';
import {
  Loader, Alert, Table, TextInput, Select, Pagination, Badge, Group, SegmentedControl, ActionIcon, Button,
} from '@mantine/core';
import { IconSearch, IconAlertTriangle, IconEye, IconPencil, IconPlus, IconReceipt, IconSend, IconUpload, IconCopy, IconFileSpreadsheet } from '@tabler/icons-react';
import { stateLabel, stateColor, type PurchaseTipo } from '../../../../lib/purchases/fields';
import { EDITABLE_STATES } from '../../../../lib/purchases/drafts';
import DetailModal, { type PurchaseDraft } from './DetailModal';
import RequestFormModal, { type EditTarget } from './RequestFormModal';
import BulkModal from './BulkModal';
import { VARIANT_OPTIONS, matchesVariant, type PurchaseVariant } from '../../../../lib/purchases/variants';

/**
 * Compras (multiempresa, SOLO LECTURA).
 *
 * Pantalla unica que consolida las Solicitudes y Ordenes de compra (Drafts de
 * SAP B1 escritos por SAPSEND) de TODAS las empresas a las que el usuario tiene
 * acceso de lectura. El navegador NUNCA ve credenciales SAP: solo consume
 * endpoints propios (/api/purchases/*) que resuelven todo en el servidor.
 */

interface CompanyAccess {
  idCompany: number;
  companyName: string;
  canRead: boolean;
  canWrite: boolean;
  ready: boolean;
  /** Mapeo SAPSEND propio del usuario en la empresa (variantes «Mis solicitudes» / «Mi area»). */
  sapsendUserId: number | null;
  sapsendDepartmentId: number | null;
}

interface CompanyError {
  companyId: number;
  companyName: string;
  message: string;
}

const ITEMS_PER_PAGE = 15;

/** Da formato legible a una fecha ISO -> YYYY-MM-DD. */
function formatDate(raw: unknown): string {
  if (raw == null || raw === '') return '-';
  // eslint-disable-next-line security/detect-unsafe-regex -- Falso positivo de safe-regex por el cuantificador anidado `(T.*)?`: el `?` acota `.*` a una sola ejecucion, por lo que NO hay backtracking catastrofico (verificado lineal: 1M chars en ~2 ms). Ademas el input es un valor de campo de SAP, corto y acotado.
  const iso = /^(\d{4}-\d{2}-\d{2})(T.*)?$/.exec(String(raw));
  return iso ? iso[1] : String(raw);
}

/** Da formato a un total en moneda (formato latino). */
function formatTotal(raw: unknown): string {
  if (raw == null || raw === '') return '-';
  const n = Number(raw);
  return Number.isNaN(n) ? String(raw) : n.toLocaleString('es-CO');
}

export default function PurchasesPage() {
  const { data: session } = useSession();

  const [tipo, setTipo] = useState<PurchaseTipo>('solicitudes');
  const [companies, setCompanies] = useState<CompanyAccess[]>([]);
  const [items, setItems] = useState<PurchaseDraft[]>([]);
  const [companyErrors, setCompanyErrors] = useState<CompanyError[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [selected, setSelected] = useState<PurchaseDraft | null>(null);
  // Formulario de solicitud: crear (edit = null) o editar un borrador B/ENC.
  const [formOpened, setFormOpened] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [bulkOpened, setBulkOpened] = useState(false);
  const [duplicateTarget, setDuplicateTarget] = useState<EditTarget | null>(null);
  const [variant, setVariant] = useState<PurchaseVariant>('todas');

  const writableCompanies = useMemo(
    () => companies.filter((c) => c.canWrite && c.ready),
    [companies]
  );
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ color: string; text: string } | null>(null);

  /** Envia el borrador al modulo de Autorizaciones (queda en LA). */
  const sendToAuthorize = async (r: PurchaseDraft) => {
    const key = `${r.companyId}-${r.DocEntry}`;
    setSendingKey(key);
    setActionMessage(null);
    try {
      const res = await fetch('/api/purchases/drafts/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: r.companyId, docEntry: Number(r.DocEntry) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionMessage({ color: 'red', text: data.error || 'No se pudo enviar a autorizar' });
        return;
      }
      setActionMessage({ color: 'green', text: `Borrador #${r.DocEntry} enviado a autorizar.` });
      setReloadKey((k) => k + 1);
    } catch {
      setActionMessage({ color: 'red', text: 'Error de red al enviar a autorizar' });
    } finally {
      setSendingKey(null);
    }
  };

  /** «Cotizar»: LA -> ENC. El servidor valida que el usuario pueda decidir la autorizacion. */
  const sendToQuotation = async (r: PurchaseDraft) => {
    const reason = window.prompt(`Motivo para enviar el borrador #${r.DocEntry} a cotizacion (opcional):`);
    if (reason === null) return;
    const key = `${r.companyId}-${r.DocEntry}`;
    setSendingKey(key);
    setActionMessage(null);
    try {
      const res = await fetch('/api/purchases/drafts/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: r.companyId, docEntry: Number(r.DocEntry), reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionMessage({ color: 'red', text: data.error || 'No se pudo enviar a cotizacion' });
        return;
      }
      setActionMessage({ color: 'green', text: `Borrador #${r.DocEntry} enviado a cotizacion.` });
      setReloadKey((k) => k + 1);
    } catch {
      setActionMessage({ color: 'red', text: 'Error de red al enviar a cotizacion' });
    } finally {
      setSendingKey(null);
    }
  };

  /** Exporta lo filtrado a Excel (como la descarga completa de SAPSEND). */
  const exportExcel = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(tipo === 'solicitudes' ? 'Solicitudes' : 'Ordenes');
    ws.columns = [
      { header: 'Empresa', key: 'empresa', width: 20 },
      { header: 'Borrador (DocEntry)', key: 'docEntry', width: 16 },
      { header: 'Numero', key: 'docNum', width: 12 },
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Proveedor', key: 'proveedor', width: 32 },
      { header: 'Solicitante', key: 'solicitante', width: 24 },
      { header: 'Estado', key: 'estado', width: 22 },
      { header: 'Total', key: 'total', width: 14 },
      { header: 'Solicitud firme', key: 'firme', width: 14 },
      { header: 'Comentarios', key: 'comentarios', width: 48 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const r of filtered) {
      ws.addRow({
        empresa: r.companyName,
        docEntry: r.DocEntry,
        docNum: r.DocNum,
        fecha: formatDate(r.DocDate),
        proveedor: r.CardName ?? '',
        solicitante: r.U_SEND_UserName ?? '',
        estado: stateLabel(r.U_SEND_State),
        total: r.DocTotal == null ? null : Number(r.DocTotal),
        firme: r.U_SEND_SolCom ?? '',
        comentarios: r.Comments ?? '',
      });
    }
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `compras-${tipo}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const canEditRow = (r: PurchaseDraft) =>
    tipo === 'solicitudes' &&
    writableCompanies.some((c) => c.idCompany === r.companyId) &&
    (EDITABLE_STATES as readonly string[]).includes(String(r.U_SEND_State ?? ''));

  // Carga el acceso una vez al iniciar sesion.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        const accessRes = await fetch('/api/purchases/access');
        if (!accessRes.ok) throw new Error('No se pudo verificar el acceso al modulo');
        const accessData = await accessRes.json();
        const userCompanies: CompanyAccess[] = accessData.companies ?? [];
        if (cancelled) return;
        setCompanies(userCompanies);
        if (userCompanies.length === 0) {
          setError('No tiene acceso a compras en ninguna empresa.');
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error inesperado');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  // Carga el listado cada vez que cambia el tipo (solicitudes/ordenes).
  useEffect(() => {
    if (!session) return;
    if (companies.length === 0) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const listRes = await fetch('/api/purchases/list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tipo, top: 10000 }),
        });
        if (!listRes.ok) throw new Error('No se pudieron cargar los documentos de compra');
        const listData = await listRes.json();
        if (cancelled) return;
        setItems(listData.items ?? []);
        setCompanyErrors(listData.errors ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error inesperado');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, companies, tipo, reloadKey]);

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return items.filter((r) => {
      if (selectedCompany !== 'all' && String(r.companyId) !== selectedCompany) return false;
      if (tipo === 'solicitudes') {
        const identity = companies.find((c) => c.idCompany === r.companyId);
        if (!matchesVariant(r, variant, identity)) return false;
      }
      if (!term) return true;
      return [r.DocNum, r.CardName, r.CardCode, r.U_SEND_UserName, r.Comments]
        .filter((v) => v != null && v !== '')
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [items, searchTerm, selectedCompany, tipo, variant, companies]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const pageItems = filtered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCompany, tipo, variant]);

  if (error) {
    return (
      <Alert color="red" title="Compras" mt="md">
        {error}
      </Alert>
    );
  }

  const companyOptions = [
    { value: 'all', label: 'Todas las empresas' },
    ...companies.map((c) => ({ value: String(c.idCompany), label: c.companyName })),
  ];

  return (
    <div style={{ padding: '1rem' }}>
      <Group justify="space-between" align="center" wrap="wrap">
        <h2 style={{ margin: 0 }}>Compras</h2>
        <Group gap="sm">
          {tipo === 'solicitudes' && writableCompanies.length > 0 && (
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() => {
                setEditTarget(null);
                setDuplicateTarget(null);
                setFormOpened(true);
              }}
            >
              Nueva solicitud
            </Button>
          )}
          {tipo === 'solicitudes' && writableCompanies.length > 0 && (
            <Button variant="light" leftSection={<IconUpload size={16} />} onClick={() => setBulkOpened(true)}>
              Carga masiva
            </Button>
          )}
          <SegmentedControl
            value={tipo}
            onChange={(v) => setTipo(v as PurchaseTipo)}
            data={[
              { label: 'Solicitudes', value: 'solicitudes' },
              { label: 'Ordenes de compra', value: 'ordenes' },
            ]}
          />
        </Group>
      </Group>

      <DetailModal draft={selected} tipo={tipo} onClose={() => setSelected(null)} />
      <RequestFormModal
        opened={formOpened}
        onClose={() => setFormOpened(false)}
        onSaved={() => setReloadKey((k) => k + 1)}
        companies={writableCompanies}
        edit={editTarget}
        duplicate={duplicateTarget}
      />
      <BulkModal
        opened={bulkOpened}
        onClose={() => setBulkOpened(false)}
        onDone={() => setReloadKey((k) => k + 1)}
        companies={writableCompanies}
      />

      {actionMessage && (
        <Alert color={actionMessage.color} mt="sm" withCloseButton onClose={() => setActionMessage(null)}>
          {actionMessage.text}
        </Alert>
      )}

      {companyErrors.length > 0 && (
        <Alert color="yellow" icon={<IconAlertTriangle size={16} />} mt="sm" mb="sm">
          No se pudo consultar:{' '}
          {companyErrors.map((e) => `${e.companyName} (${e.message})`).join(', ')}
        </Alert>
      )}

      <Group mt="md" mb="md" gap="sm" wrap="wrap">
        <TextInput
          placeholder="Buscar por numero, proveedor, solicitante o comentario"
          leftSection={<IconSearch size={16} />}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.currentTarget.value)}
          style={{ flex: '1 1 240px' }}
        />
        <Select
          data={companyOptions}
          value={selectedCompany}
          onChange={(v) => setSelectedCompany(v ?? 'all')}
          allowDeselect={false}
          style={{ flex: '0 1 220px', minWidth: 180 }}
        />
        {tipo === 'solicitudes' && (
          <Select
            data={VARIANT_OPTIONS}
            value={variant}
            onChange={(v) => setVariant((v as PurchaseVariant) ?? 'todas')}
            allowDeselect={false}
            aria-label="Vista"
            style={{ flex: '0 1 180px', minWidth: 160 }}
          />
        )}
        <Button
          variant="default"
          leftSection={<IconFileSpreadsheet size={16} />}
          onClick={() => void exportExcel()}
          disabled={filtered.length === 0}
        >
          Exportar Excel
        </Button>
      </Group>

      {loading ? (
        <Group justify="center" mt="xl">
          <Loader />
        </Group>
      ) : (
        <>
          <Table.ScrollContainer minWidth={860}>
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Empresa</Table.Th>
                  <Table.Th>Numero</Table.Th>
                  <Table.Th>Fecha</Table.Th>
                  <Table.Th>Proveedor</Table.Th>
                  <Table.Th>Solicitante</Table.Th>
                  <Table.Th>Estado</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Total</Table.Th>
                  <Table.Th>Detalle</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {pageItems.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={8} style={{ textAlign: 'center' }}>
                      Sin documentos para mostrar.
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  pageItems.map((r) => (
                    <Table.Tr
                      key={`${r.companyId}-${r.DocEntry}`}
                      onClick={() => setSelected(r)}
                      style={{ cursor: 'pointer' }}
                    >
                      <Table.Td>
                        <Badge variant="light">{r.companyName}</Badge>
                      </Table.Td>
                      <Table.Td>{r.DocNum ?? '-'}</Table.Td>
                      <Table.Td>{formatDate(r.DocDate)}</Table.Td>
                      <Table.Td>{(r.CardName as string) ?? '-'}</Table.Td>
                      <Table.Td>{(r.U_SEND_UserName as string) ?? '-'}</Table.Td>
                      <Table.Td>
                        <Badge variant="light" color={stateColor(r.U_SEND_State)}>
                          {stateLabel(r.U_SEND_State)}
                        </Badge>
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{formatTotal(r.DocTotal)}</Table.Td>
                      <Table.Td>
                        <Group gap={2} wrap="nowrap">
                          <ActionIcon
                            variant="subtle"
                            size="sm"
                            onClick={() => setSelected(r)}
                            aria-label="Ver detalle"
                          >
                            <IconEye size={16} />
                          </ActionIcon>
                          {canEditRow(r) && (
                            <ActionIcon
                              variant="subtle"
                              color="blue"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDuplicateTarget(null);
                                setEditTarget({ companyId: r.companyId, docEntry: Number(r.DocEntry) });
                                setFormOpened(true);
                              }}
                              aria-label="Editar solicitud"
                            >
                              <IconPencil size={16} />
                            </ActionIcon>
                          )}
                          {canEditRow(r) && (
                            <ActionIcon
                              variant="subtle"
                              color="teal"
                              size="sm"
                              loading={sendingKey === `${r.companyId}-${r.DocEntry}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                void sendToAuthorize(r);
                              }}
                              aria-label="Enviar a autorizar"
                            >
                              <IconSend size={16} />
                            </ActionIcon>
                          )}
                          {tipo === 'solicitudes' && writableCompanies.some((c) => c.idCompany === r.companyId) && (
                            <ActionIcon
                              variant="subtle"
                              color="gray"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditTarget(null);
                                setDuplicateTarget({ companyId: r.companyId, docEntry: Number(r.DocEntry) });
                                setFormOpened(true);
                              }}
                              aria-label="Duplicar solicitud"
                            >
                              <IconCopy size={16} />
                            </ActionIcon>
                          )}
                          {tipo === 'solicitudes' && String(r.U_SEND_State ?? '') === 'LA' && (
                            <ActionIcon
                              variant="subtle"
                              color="orange"
                              size="sm"
                              loading={sendingKey === `${r.companyId}-${r.DocEntry}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                void sendToQuotation(r);
                              }}
                              aria-label="Enviar a cotizacion"
                              title="Enviar a cotizacion (autorizador)"
                            >
                              <IconReceipt size={16} />
                            </ActionIcon>
                          )}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))
                )}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>

          <Group justify="space-between" mt="md">
            <span style={{ fontSize: 13, color: '#666' }}>
              {filtered.length} documento(s) — {companies.length} empresa(s) con acceso
            </span>
            {totalPages > 1 && (
              <Pagination total={totalPages} value={currentPage} onChange={setCurrentPage} />
            )}
          </Group>
        </>
      )}
    </div>
  );
}
