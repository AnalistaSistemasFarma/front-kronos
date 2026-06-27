'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { Loader, Alert, Table, TextInput, Select, Pagination, Badge, Group, Button } from '@mantine/core';
import { IconSearch, IconAlertTriangle, IconPlus, IconUpload } from '@tabler/icons-react';
import CreateModal from './CreateModal';
import BulkModal from './BulkModal';

/**
 * Registros Sanitarios (multiempresa).
 *
 * Pantalla unica que consolida los registros sanitarios de TODAS las empresas
 * a las que el usuario tiene acceso. A diferencia del modulo de compras, aqui
 * el navegador NUNCA ve credenciales SAP: solo consume dos endpoints propios
 * (/api/health-records/access y /api/health-records/list) que resuelven todo
 * en el servidor.
 */

interface CompanyAccess {
  idCompany: number;
  companyName: string;
  canRead: boolean;
  canWrite: boolean;
  ready: boolean;
}

interface HealthRecord {
  companyId: number;
  companyName: string;
  DocNum?: number;
  U_Registro_Sanitario?: string;
  U_Referencia?: string;
  U_Descripcion?: string;
  U_Pais?: string;
  U_Titular?: string;
  U_Fecha_Vencimiento?: string;
  U_Estado_Comercializacion?: string;
  [key: string]: unknown;
}

interface CompanyError {
  companyId: number;
  companyName: string;
  message: string;
}

const ITEMS_PER_PAGE = 15;

export default function HealthRecordsPage() {
  const { data: session } = useSession();

  const [companies, setCompanies] = useState<CompanyAccess[]>([]);
  const [records, setRecords] = useState<HealthRecord[]>([]);
  const [companyErrors, setCompanyErrors] = useState<CompanyError[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  useEffect(() => {
    if (session) loadData();
  }, [session]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const accessRes = await fetch('/api/health-records/access');
      if (!accessRes.ok) throw new Error('No se pudo verificar el acceso al modulo');
      const accessData = await accessRes.json();
      const userCompanies: CompanyAccess[] = accessData.companies ?? [];
      setCompanies(userCompanies);

      if (userCompanies.length === 0) {
        setError('No tiene acceso a registros sanitarios en ninguna empresa.');
        return;
      }

      const listRes = await fetch('/api/health-records/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ top: 500 }),
      });
      if (!listRes.ok) throw new Error('No se pudieron cargar los registros sanitarios');
      const listData = await listRes.json();

      setRecords(listData.items ?? []);
      setCompanyErrors(listData.errors ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return records.filter((r) => {
      if (selectedCompany !== 'all' && String(r.companyId) !== selectedCompany) return false;
      if (!term) return true;
      return [
        r.U_Registro_Sanitario,
        r.U_Referencia,
        r.U_Descripcion,
        r.U_Titular,
        r.U_Pais,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [records, searchTerm, selectedCompany]);

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
      <Alert color="red" title="Registros Sanitarios" mt="md">
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

  return (
    <div style={{ padding: '1rem' }}>
      <Group justify="space-between" align="center">
        <h2 style={{ margin: 0 }}>Registros Sanitarios</h2>
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

      {companyErrors.length > 0 && (
        <Alert color="yellow" icon={<IconAlertTriangle size={16} />} mt="sm" mb="sm">
          No se pudo consultar:{' '}
          {companyErrors.map((e) => `${e.companyName} (${e.message})`).join(', ')}
        </Alert>
      )}

      <Group mt="md" mb="md" gap="sm" wrap="wrap">
        <TextInput
          placeholder="Buscar por registro, referencia, descripcion, titular o pais"
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

      <Table.ScrollContainer minWidth={780}>
      <Table striped highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Empresa</Table.Th>
            <Table.Th>Registro Sanitario</Table.Th>
            <Table.Th>Referencia</Table.Th>
            <Table.Th>Descripcion</Table.Th>
            <Table.Th>Pais</Table.Th>
            <Table.Th>Titular</Table.Th>
            <Table.Th>Vencimiento</Table.Th>
            <Table.Th>Estado</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {pageItems.length === 0 ? (
            <Table.Tr>
              <Table.Td colSpan={8} style={{ textAlign: 'center' }}>
                Sin registros para mostrar.
              </Table.Td>
            </Table.Tr>
          ) : (
            pageItems.map((r) => (
              <Table.Tr key={`${r.companyId}-${r.DocNum ?? r.U_Registro_Sanitario}`}>
                <Table.Td>
                  <Badge variant="light">{r.companyName}</Badge>
                </Table.Td>
                <Table.Td>{r.U_Registro_Sanitario ?? '-'}</Table.Td>
                <Table.Td>{r.U_Referencia ?? '-'}</Table.Td>
                <Table.Td>{r.U_Descripcion ?? '-'}</Table.Td>
                <Table.Td>{r.U_Pais ?? '-'}</Table.Td>
                <Table.Td>{r.U_Titular ?? '-'}</Table.Td>
                <Table.Td>{r.U_Fecha_Vencimiento?.slice(0, 10) ?? '-'}</Table.Td>
                <Table.Td>{r.U_Estado_Comercializacion ?? '-'}</Table.Td>
              </Table.Tr>
            ))
          )}
        </Table.Tbody>
      </Table>
      </Table.ScrollContainer>

      <Group justify="space-between" mt="md">
        <span style={{ fontSize: 13, color: '#666' }}>
          {filtered.length} registro(s) — {companies.length} empresa(s) con acceso
        </span>
        {totalPages > 1 && (
          <Pagination total={totalPages} value={currentPage} onChange={setCurrentPage} />
        )}
      </Group>
    </div>
  );
}
