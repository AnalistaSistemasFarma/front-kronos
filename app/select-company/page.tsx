'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Select, Button, Paper, Title, Stack, Loader, Alert } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { useUserContext } from '../../lib/user-context';
import Image from 'next/image';

interface Company {
  id: number;
  name: string;
}

export default function SelectCompany() {
  const { data: session, status } = useSession();
  const { selectedCompany, setSelectedCompany } = useUserContext();
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedValue, setSelectedValue] = useState<string>('');

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/login');
      return;
    }
    if (selectedCompany) {
      router.push('/dashboard');
      return;
    }
    fetchCompanies();
  }, [session, status, selectedCompany, router]);

  const fetchCompanies = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/companies');
      if (!response.ok) {
        throw new Error('Failed to fetch companies');
      }
      const data: Company[] = await response.json();
      setCompanies(data);
      if (data.length === 0) {
        setError('No companies available. Please contact support.');
      }
    } catch (err) {
      setError('Unable to load companies. Please try again.');
      console.error('Error fetching companies:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (value: string | null) => {
    setSelectedValue(value || '');
  };

  const handleSubmit = () => {
    const company = companies.find((c) => c.id.toString() === selectedValue);
    if (company) {
      setSelectedCompany(company);
      router.push('/dashboard');
    }
  };

  if (status === 'loading' || selectedCompany) {
    return (
      <div className='min-h-screen flex items-center justify-center'>
        <Loader size='lg' />
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'blue',
      }}
    >
      <Image
        src='/grupo-pisa-logo.svg'
        alt='Grupo Pisa Logo'
        width={200}
        height={100}
        style={{ marginBottom: '2rem' }}
      />
      <Paper shadow='md' p='xl' radius='md' withBorder style={{ maxWidth: 400, width: '100%' }}>
        <Title order={2} ta='center' mb='lg'>
          Seleccionar Empresa
        </Title>
        <p className='text-xs italic'>Selecciona la empresa con la que deseas trabajar</p>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
            <Loader />
          </div>
        ) : error ? (
          <Alert icon={<IconAlertCircle size={16} />} title='Error' color='red' mb='md'>
            {error}
          </Alert>
        ) : (
          <Stack>
            <Select
              label='Empresa'
              placeholder='Selecciona una empresa'
              data={companies.map((c) => ({ value: c.id.toString(), label: c.name }))}
              value={selectedValue}
              onChange={handleSelect}
              required
            />
            <Button type='button' onClick={handleSubmit} disabled={!selectedValue} fullWidth>
              Seleccionar
            </Button>
          </Stack>
        )}
      </Paper>
    </div>
  );
}
