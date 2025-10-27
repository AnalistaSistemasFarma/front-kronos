'use client';

import React, { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useSapContext } from '../../../../lib/sap-context';
import { Loader, Alert, Table, TextInput, Select, Button, Pagination } from '@mantine/core';
import { IconSearch, IconFilter } from '@tabler/icons-react';

interface Company {
  id: number;
  name: string;
  sapEndpoint: {
    id_sap_endpoint: number;
    base_url: string;
    username: string;
    password: string;
    client: string;
  } | null;
}

interface UnifiedDraft {
  id: string; // companyId-docEntry
  companyId: number;
  companyName: string;
  docEntry: number;
  docNum: number;
  docDate: string;
  docDueDate: string;
  cardCode: string;
  cardName: string;
  docTotal: number;
  comments?: string;
}

export default function PurchaseRequestPage() {
  const { data: session } = useSession();
  const { getToken, addToken } = useSapContext();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [drafts, setDrafts] = useState<UnifiedDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters and pagination
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    if (session) {
      loadCompaniesAndDrafts();
    }
  }, [session]);

  const loadCompaniesAndDrafts = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get companies with access
      const accessResponse = await fetch('/api/purchase-request/access');
      if (!accessResponse.ok) {
        throw new Error('Failed to fetch company access');
      }
      const accessData = await accessResponse.json();
      const userCompanies: Company[] = accessData.companies;

      if (userCompanies.length === 0) {
        setError('No tienes acceso a solicitudes de compra en ninguna empresa');
        setLoading(false);
        return;
      }

      setCompanies(userCompanies);

      // Authenticate and fetch drafts for each company
      const allDrafts: UnifiedDraft[] = [];
      const authPromises = userCompanies.map(async (company) => {
        if (!company.sapEndpoint) {
          console.warn(`No SAP endpoint configured for company ${company.name}`);
          return;
        }

        try {
          let token = getToken(company.id);

          if (!token) {
            // Authenticate
            const authResponse = await fetch('/api/purchase-request/auth', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                companyId: company.id,
                endpoint: company.sapEndpoint.base_url,
                username: company.sapEndpoint.username,
                password: company.sapEndpoint.password,
                client: company.sapEndpoint.client,
              }),
            });

            if (!authResponse.ok) {
              console.error(`Authentication failed for ${company.name}`);
              return;
            }

            const authData = await authResponse.json();
            addToken({
              companyId: authData.companyId,
              companyName: company.name,
              token: authData.token,
              expiresAt: authData.expiresAt,
              endpoint: authData.endpoint,
            });
            token = getToken(company.id);
          }

          if (token) {
            // Fetch drafts
            const draftsResponse = await fetch('/api/purchase-request/drafts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                companyId: company.id,
                endpoint: token.endpoint,
                token: token.token,
              }),
            });

            if (draftsResponse.ok) {
              const draftsData = await draftsResponse.json();
              const companyDrafts: UnifiedDraft[] = draftsData.drafts.map(
                (draft: {
                  DocEntry: number;
                  DocNum: number;
                  DocDate: string;
                  DocDueDate: string;
                  CardCode: string;
                  CardName: string;
                  DocTotal: number;
                  Comments?: string;
                }) => ({
                  id: `${company.id}-${draft.DocEntry}`,
                  companyId: company.id,
                  companyName: company.name,
                  docEntry: draft.DocEntry,
                  docNum: draft.DocNum,
                  docDate: draft.DocDate,
                  docDueDate: draft.DocDueDate,
                  cardCode: draft.CardCode,
                  cardName: draft.CardName,
                  docTotal: draft.DocTotal,
                  comments: draft.Comments,
                })
              );
              allDrafts.push(...companyDrafts);
            } else {
              console.error(`Failed to fetch drafts for ${company.name}`);
            }
          }
        } catch (error) {
          console.error(`Error processing company ${company.name}:`, error);
        }
      });

      await Promise.all(authPromises);

      // Sort by date descending
      allDrafts.sort((a, b) => new Date(b.docDate).getTime() - new Date(a.docDate).getTime());

      setDrafts(allDrafts);
    } catch (error) {
      console.error('Error loading data:', error);
      setError('Error al cargar los datos');
    } finally {
      setLoading(false);
    }
  };

  // Filter drafts
  const filteredDrafts = drafts.filter((draft) => {
    const matchesSearch =
      draft.cardName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      draft.cardCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      draft.comments?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCompany =
      selectedCompany === 'all' || draft.companyId.toString() === selectedCompany;

    return matchesSearch && matchesCompany;
  });

  // Pagination
  const totalPages = Math.ceil(filteredDrafts.length / itemsPerPage);
  const paginatedDrafts = filteredDrafts.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  if (loading) {
    return (
      <div className='flex justify-center items-center min-h-64'>
        <Loader size='lg' />
      </div>
    );
  }

  if (error) {
    return (
      <Alert color='red' title='Error'>
        {error}
      </Alert>
    );
  }

  return (
    <div className='p-6'>
      <h1 className='text-2xl font-bold mb-6'>Solicitudes de Compra</h1>

      {/* Filters */}
      <div className='flex gap-4 mb-6'>
        <TextInput
          placeholder='Buscar por proveedor, código o comentarios...'
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          leftSection={<IconSearch size={16} />}
          className='flex-1'
        />
        <Select
          placeholder='Filtrar por empresa'
          value={selectedCompany}
          onChange={(value) => setSelectedCompany(value || 'all')}
          data={[
            { value: 'all', label: 'Todas las empresas' },
            ...companies.map((company) => ({
              value: company.id.toString(),
              label: company.name,
            })),
          ]}
          leftSection={<IconFilter size={16} />}
          className='w-64'
        />
        <Button onClick={loadCompaniesAndDrafts} loading={loading}>
          Actualizar
        </Button>
      </div>

      {/* Table */}
      <div className='bg-white rounded-lg shadow overflow-hidden'>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Empresa</Table.Th>
              <Table.Th>Número</Table.Th>
              <Table.Th>Fecha</Table.Th>
              <Table.Th>Proveedor</Table.Th>
              <Table.Th>Total</Table.Th>
              <Table.Th>Comentarios</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {paginatedDrafts.map((draft) => (
              <Table.Tr key={draft.id}>
                <Table.Td>{draft.companyName}</Table.Td>
                <Table.Td>{draft.docNum}</Table.Td>
                <Table.Td>{new Date(draft.docDate).toLocaleDateString()}</Table.Td>
                <Table.Td>{draft.cardName}</Table.Td>
                <Table.Td>${draft.docTotal.toFixed(2)}</Table.Td>
                <Table.Td>{draft.comments || '-'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className='flex justify-center mt-6'>
          <Pagination total={totalPages} value={currentPage} onChange={setCurrentPage} size='md' />
        </div>
      )}

      {filteredDrafts.length === 0 && (
        <div className='text-center py-8 text-gray-500'>
          No se encontraron solicitudes de compra
        </div>
      )}
    </div>
  );
}
