'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { Loader, Alert, Table, TextInput, Select, Pagination, Badge, Group, Button, ActionIcon } from '@mantine/core';
import { IconSearch, IconAlertTriangle, IconPlus, IconUpload, IconEdit, IconEye } from '@tabler/icons-react';
import { FLAG_YES } from '../../../../lib/articles/fields';
import CreateModal from './CreateModal';
import BulkModal from './BulkModal';
import EditModal, { type Article } from './EditModal';

/**
 * Articulos (multiempresa).
 *
 * Pantalla unica que consolida los articulos (entidad estandar Items de SAP B1)
 * de TODAS las empresas a las que el usuario tiene acceso. El navegador NUNCA ve
 * credenciales SAP: solo consume endpoints propios (/api/articles/*) que
 * resuelven todo en el servidor.
 */

interface CompanyAccess {
  idCompany: number;
  companyName: string;
  canRead: boolean;
  canWrite: boolean;
  ready: boolean;
}

interface CompanyError {
  companyId: number;
  companyName: string;
  message: string;
}

const ITEMS_PER_PAGE = 15;

/** Pinta un Badge Si/No a partir de una bandera tYES/tNO. */
function flagBadge(value: unknown) {
  const yes = value === FLAG_YES;
  return (
    <Badge variant="light" color={yes ? 'green' : 'gray'}>
      {yes ? 'Si' : 'No'}
    </Badge>
  );
}

export default function ArticlesPage() {
  const { data: session } = useSession();

  const [companies, setCompanies] = useState<CompanyAccess[]>([]);
  const [items, setItems] = useState<Article[]>([]);
  const [companyErrors, setCompanyErrors] = useState<CompanyError[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [selected, setSelected] = useState<Article | null>(null);

  useEffect(() => {
    if (session) loadData();
  }, [session]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const accessRes = await fetch('/api/articles/access');
      if (!accessRes.ok) throw new Error('No se pudo verificar el acceso al modulo');
      const accessData = await accessRes.json();
      const userCompanies: CompanyAccess[] = accessData.companies ?? [];
      setCompanies(userCompanies);

      if (userCompanies.length === 0) {
        setError('No tiene acceso a articulos en ninguna empresa.');
        return;
      }

      const listRes = await fetch('/api/articles/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ top: 10000 }),
      });
      if (!listRes.ok) throw new Error('No se pudieron cargar los articulos');
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
      return [r.ItemCode, r.ItemName, r.ForeignName]
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
      <Alert color="red" title="Articulos" mt="md">
        {error}
      </Alert>
    );
  }

  const companyOptions = [
    { value: 'all', label: 'Todas las empresas' },
    ...companies.map((c) => ({ value: String(c.idCompany), label: c.companyName })),
  ];

  const writable = companies
    .filter((c) => c.canWrite)
    .map((c) => ({ idCompany: c.idCompany, companyName: c.companyName }));

  const canWriteFor = (companyId: number) =>
    companies.find((c) => c.idCompany === companyId)?.canWrite ?? false;

  return (
    <div style={{ padding: '1rem' }}>
      <Group justify="space-between" align="center">
        <h2 style={{ margin: 0 }}>Articulos</h2>
        {writable.length > 0 && (
          <Group gap="xs">
            <Button leftSection={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>
              Crear
            </Button>
            <Button variant="default" leftSection={<IconUpload size={16} />} onClick={() => setBulkOpen(true)}>
              Cargue masivo
            </Button>
          </Group>
        )}
      </Group>

      <CreateModal opened={createOpen} onClose={() => setCreateOpen(false)} companies={writable} onCreated={loadData} />
      <BulkModal opened={bulkOpen} onClose={() => setBulkOpen(false)} companies={writable} onLoaded={loadData} />
      <EditModal
        article={selected}
        canWrite={selected ? canWriteFor(selected.companyId) : false}
        onClose={() => setSelected(null)}
        onUpdated={loadData}
      />

      {companyErrors.length > 0 && (
        <Alert color="yellow" icon={<IconAlertTriangle size={16} />} mt="sm" mb="sm">
          No se pudo consultar:{' '}
          {companyErrors.map((e) => `${e.companyName} (${e.message})`).join(', ')}
        </Alert>
      )}

      <Group mt="md" mb="md" gap="sm" wrap="wrap">
        <TextInput
          placeholder="Buscar por codigo, descripcion o nombre extranjero"
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

      <Table.ScrollContainer minWidth={860}>
      <Table striped highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Empresa</Table.Th>
            <Table.Th>Codigo</Table.Th>
            <Table.Th>Descripcion</Table.Th>
            <Table.Th>Grupo</Table.Th>
            <Table.Th>Ventas</Table.Th>
            <Table.Th>Compras</Table.Th>
            <Table.Th>Inv.</Table.Th>
            <Table.Th>Activo</Table.Th>
            <Table.Th>Acciones</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {pageItems.length === 0 ? (
            <Table.Tr>
              <Table.Td colSpan={9} style={{ textAlign: 'center' }}>
                Sin articulos para mostrar.
              </Table.Td>
            </Table.Tr>
          ) : (
            pageItems.map((r) => (
              <Table.Tr
                key={`${r.companyId}-${r.ItemCode}`}
                onClick={() => setSelected(r)}
                style={{ cursor: 'pointer' }}
              >
                <Table.Td>
                  <Badge variant="light">{r.companyName}</Badge>
                </Table.Td>
                <Table.Td>{r.ItemCode ?? '-'}</Table.Td>
                <Table.Td>{r.ItemName ?? '-'}</Table.Td>
                <Table.Td>{r.ItemsGroupCode ?? '-'}</Table.Td>
                <Table.Td>{flagBadge(r.SalesItem)}</Table.Td>
                <Table.Td>{flagBadge(r.PurchaseItem)}</Table.Td>
                <Table.Td>{flagBadge(r.InventoryItem)}</Table.Td>
                <Table.Td>{flagBadge(r.Valid)}</Table.Td>
                <Table.Td>
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    onClick={() => setSelected(r)}
                    aria-label={canWriteFor(r.companyId) ? 'Editar' : 'Ver detalle'}
                  >
                    {canWriteFor(r.companyId) ? <IconEdit size={16} /> : <IconEye size={16} />}
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
          {filtered.length} articulo(s) — {companies.length} empresa(s) con acceso
        </span>
        {totalPages > 1 && (
          <Pagination total={totalPages} value={currentPage} onChange={setCurrentPage} />
        )}
      </Group>
    </div>
  );
}
