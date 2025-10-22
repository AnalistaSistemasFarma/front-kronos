'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Card, Title, Text, Loader, Alert, Stack, Badge } from '@mantine/core';
import { IconAlertCircle, IconFolder } from '@tabler/icons-react';

interface Company {
  id_company: number;
  company: string;
}

interface CompanyUser {
  id_company_user: number;
  company: Company;
}

interface SubprocessUserCompany {
  id_subprocess_user_company: number;
  companyUser: CompanyUser;
}

interface Subprocess {
  id_subprocess: number;
  subprocess: string;
  subprocess_url?: string;
  subprocessUserCompanies: SubprocessUserCompany[];
}

interface Process {
  id_process: number;
  process: string;
  process_url?: string;
  subprocesses: Subprocess[];
}

export default function ProcessPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [processes, setProcesses] = useState<Process[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/login');
      return;
    }
    fetchProcesses();
  }, [session, status, router]);

  const fetchProcesses = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/processes');
      if (!response.ok) {
        throw new Error('Failed to fetch processes');
      }
      const data: Process[] = await response.json();
      setProcesses(data);
    } catch (err) {
      setError('Unable to load processes. Please try again.');
      console.error('Error fetching processes:', err);
    } finally {
      setLoading(false);
    }
  };

  if (status === 'loading' || loading) {
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
    <div className='max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8'>
      <div className='mb-8'>
        <Title order={1} className='text-3xl font-bold text-gray-900 mb-2'>
          Procesos
        </Title>
        <Text className='text-gray-600'>List de procesos disponibles para tu usuario</Text>
      </div>

      {error && (
        <Alert icon={<IconAlertCircle size={16} />} title='Error' color='red' mb='md'>
          {error}
        </Alert>
      )}

      {processes.length === 0 && !error ? (
        <Card shadow='sm' p='lg' radius='md' withBorder>
          <div className='text-center py-8'>
            <IconFolder size={48} className='text-gray-400 mx-auto mb-4' />
            <Title order={3} className='text-gray-500 mb-2'>
              No processes available
            </Title>
            <Text className='text-gray-400'>No tienes procesos asignados en este momento.</Text>
          </div>
        </Card>
      ) : (
        <div className='grid gap-6 md:grid-cols-2 lg:grid-cols-3'>
          {processes.map((process) => (
            <Card key={process.id_process} shadow='sm' p='lg' radius='md' withBorder>
              <div className='flex items-start justify-between mb-4'>
                <div className='flex-1'>
                  <Title order={3} className='text-lg font-semibold text-gray-900 mb-2'>
                    {process.process}
                  </Title>
                  {process.process_url && (
                    <Text size='sm' className='text-blue-600 hover:text-blue-800'>
                      <a href={process.process_url} target='_blank' rel='noopener noreferrer'>
                        Ver documentación
                      </a>
                    </Text>
                  )}
                </div>
                <Badge color='blue' variant='light'>
                  {process.subprocesses.length} subprocesos
                </Badge>
              </div>

              {process.subprocesses.length > 0 && (
                <div>
                  <Text size='sm' className='font-medium text-gray-700 mb-2'>
                    Subprocesos:
                  </Text>
                  <Stack gap='xs'>
                    {process.subprocesses.map((subprocess) => (
                      <div
                        key={subprocess.id_subprocess}
                        className='flex items-center p-2 bg-gray-50 rounded text-sm text-gray-700 cursor-pointer hover:bg-gray-100 transition-colors'
                        onClick={() => {
                          if (subprocess.subprocess_url) {
                            try {
                              if (subprocess.subprocess_url.startsWith('/')) {
                                router.push(subprocess.subprocess_url);
                              } else {
                                router.push(subprocess.subprocess_url);
                              }
                            } catch (error) {
                              console.error(
                                'Invalid subprocess URL:',
                                subprocess.subprocess_url,
                                'Error:',
                                error
                              );
                              alert(
                                'La URL del subproceso no es válida. Por favor, contacta al administrador.'
                              );
                            }
                          } else {
                            router.push(
                              `/process/help-desk/create-ticket?subprocess_id=${subprocess.id_subprocess}`
                            );
                          }
                        }}
                      >
                        <IconFolder size={16} className='mr-2 text-gray-500' />
                        <span className='flex-1'>{subprocess.subprocess}</span>
                        {subprocess.subprocessUserCompanies.length > 0 && (
                          <Badge size='xs' color='gray' variant='light' className='ml-2'>
                            {subprocess.subprocessUserCompanies[0].companyUser.company.company}
                          </Badge>
                        )}
                      </div>
                    ))}
                  </Stack>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
