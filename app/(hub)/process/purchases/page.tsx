'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import {
  Loader, Alert, Table, TextInput, Select, Pagination, Badge, Group, SegmentedControl, ActionIcon,
} from '@mantine/core';
import { IconSearch, IconAlertTriangle, IconEye } from '@tabler/icons-react';
import { stateLabel, stateColor, type PurchaseTipo } from '../../../../lib/purchases/fields';
import DetailModal, { type PurchaseDraft } from './DetailModal';

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
  ready: boolean;
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
  }, [session, companies, tipo]);

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return items.filter((r) => {
      if (selectedCompany !== 'all' && String(r.companyId) !== selectedCompany) return false;
      if (!term) return true;
      return [r.DocNum, r.CardName, r.CardCode, r.U_SEND_UserName, r.Comments]
        .filter((v) => v != null && v !== '')
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [items, searchTerm, selectedCompany]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const pageItems = filtered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCompany, tipo]);

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
        <SegmentedControl
          value={tipo}
          onChange={(v) => setTipo(v as PurchaseTipo)}
          data={[
            { label: 'Solicitudes', value: 'solicitudes' },
            { label: 'Ordenes de compra', value: 'ordenes' },
          ]}
        />
      </Group>

      <DetailModal draft={selected} tipo={tipo} onClose={() => setSelected(null)} />

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
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          onClick={() => setSelected(r)}
                          aria-label="Ver detalle"
                        >
                          <IconEye size={16} />
                        </ActionIcon>
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
