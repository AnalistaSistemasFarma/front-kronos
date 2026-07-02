'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { Loader, Alert, Table, TextInput, Select, Pagination, Badge, Group } from '@mantine/core';
import { IconSearch, IconAlertTriangle } from '@tabler/icons-react';
import { FLAG_YES, cardTypeLabel } from '../../../../lib/business-partners/fields';

/**
 * Socios de Negocio (multiempresa, SOLO LECTURA).
 *
 * Pantalla unica que consolida los socios de negocio (entidad estandar
 * BusinessPartners de SAP B1) de TODAS las empresas a las que el usuario tiene
 * acceso. El navegador NUNCA ve credenciales SAP: solo consume endpoints
 * propios (/api/business-partners/*) que resuelven todo en el servidor.
 *
 * Espejo del modulo de Articulos, sin acciones de escritura (crear / editar /
 * cargue masivo): aqui solo se consulta.
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

interface Partner {
  companyId: number;
  companyName: string;
  CardCode?: string;
  CardName?: string;
  CardType?: string;
  FederalTaxID?: string;
  Phone1?: string;
  EmailAddress?: string;
  CurrentAccountBalance?: number;
  Currency?: string;
  Valid?: string;
  Frozen?: string;
  [key: string]: unknown;
}

const ITEMS_PER_PAGE = 15;

/** Formatea un saldo numerico en formato latino (1.000.000,00). */
function formatBalance(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  const n = Number(value);
  if (Number.isNaN(n)) return '-';
  return n.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Badge de estado del socio. Un socio bloqueado (Frozen = tYES) o no valido
 * (Valid != tYES) se muestra en rojo; activo en verde.
 */
function stateBadge(partner: Partner) {
  const frozen = partner.Frozen === FLAG_YES;
  const valid = partner.Valid === FLAG_YES;
  const active = valid && !frozen;
  return (
    <Badge variant="light" color={active ? 'green' : 'red'}>
      {active ? 'Activo' : frozen ? 'Bloqueado' : 'Inactivo'}
    </Badge>
  );
}

export default function BusinessPartnersPage() {
  const { data: session } = useSession();

  const [companies, setCompanies] = useState<CompanyAccess[]>([]);
  const [items, setItems] = useState<Partner[]>([]);
  const [companyErrors, setCompanyErrors] = useState<CompanyError[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    if (session) loadData();
  }, [session]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const accessRes = await fetch('/api/business-partners/access');
      if (!accessRes.ok) throw new Error('No se pudo verificar el acceso al modulo');
      const accessData = await accessRes.json();
      const userCompanies: CompanyAccess[] = accessData.companies ?? [];
      setCompanies(userCompanies);

      if (userCompanies.length === 0) {
        setError('No tiene acceso a socios de negocio en ninguna empresa.');
        return;
      }

      const listRes = await fetch('/api/business-partners/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ top: 10000 }),
      });
      if (!listRes.ok) throw new Error('No se pudieron cargar los socios de negocio');
      const listData = await listRes.json();

      setItems(listData.items ?? []);
      setCompanyErrors(listData.errors ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return items.filter((r) => {
      if (selectedCompany !== 'all' && String(r.companyId) !== selectedCompany) return false;
      if (!term) return true;
      return [r.CardCode, r.CardName, r.FederalTaxID]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [items, searchTerm, selectedCompany]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const pageItems = filtered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCompany]);

  if (loading) {
    return (
      <Group justify="center" mt="xl">
        <Loader />
      </Group>
    );
  }

  if (error) {
    return (
      <Alert color="red" title="Socios de Negocio" mt="md">
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
      <Group justify="space-between" align="center">
        <h2 style={{ margin: 0 }}>Socios de Negocio</h2>
      </Group>

      {companyErrors.length > 0 && (
        <Alert color="yellow" icon={<IconAlertTriangle size={16} />} mt="sm" mb="sm">
          No se pudo consultar:{' '}
          {companyErrors.map((e) => `${e.companyName} (${e.message})`).join(', ')}
        </Alert>
      )}

      <Group mt="md" mb="md" gap="sm" wrap="wrap">
        <TextInput
          placeholder="Buscar por codigo, nombre o NIT"
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

      <Table.ScrollContainer minWidth={980}>
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Empresa</Table.Th>
              <Table.Th>Codigo</Table.Th>
              <Table.Th>Nombre</Table.Th>
              <Table.Th>Tipo</Table.Th>
              <Table.Th>NIT</Table.Th>
              <Table.Th>Telefono</Table.Th>
              <Table.Th>Correo</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Saldo</Table.Th>
              <Table.Th>Moneda</Table.Th>
              <Table.Th>Estado</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {pageItems.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={10} style={{ textAlign: 'center' }}>
                  Sin socios de negocio para mostrar.
                </Table.Td>
              </Table.Tr>
            ) : (
              pageItems.map((r) => (
                <Table.Tr key={`${r.companyId}-${r.CardCode}`}>
                  <Table.Td>
                    <Badge variant="light">{r.companyName}</Badge>
                  </Table.Td>
                  <Table.Td>{r.CardCode ?? '-'}</Table.Td>
                  <Table.Td>{r.CardName ?? '-'}</Table.Td>
                  <Table.Td>{cardTypeLabel(r.CardType)}</Table.Td>
                  <Table.Td>{r.FederalTaxID ?? '-'}</Table.Td>
                  <Table.Td>{r.Phone1 ?? '-'}</Table.Td>
                  <Table.Td>{r.EmailAddress ?? '-'}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    {formatBalance(r.CurrentAccountBalance)}
                  </Table.Td>
                  <Table.Td>{r.Currency ?? '-'}</Table.Td>
                  <Table.Td>{stateBadge(r)}</Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <Group justify="space-between" mt="md">
        <span style={{ fontSize: 13, color: '#666' }}>
          {filtered.length} socio(s) — {companies.length} empresa(s) con acceso
        </span>
        {totalPages > 1 && (
          <Pagination total={totalPages} value={currentPage} onChange={setCurrentPage} />
        )}
      </Group>
    </div>
  );
}
