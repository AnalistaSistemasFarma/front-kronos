'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  TextInput,
  Textarea,
  Select,
  Button,
  Title,
  Paper,
  Stack,
  Alert,
  Breadcrumbs,
  Anchor,
} from '@mantine/core';
import { IconAlertCircle, IconChevronRight } from '@tabler/icons-react';

function CreateTicketForm() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const subprocessId = searchParams.get('subprocess_id');

  const [formData, setFormData] = useState({
    subject: '',
    description: '',
    priority: '',
    category: '',
    subcategory: '',
    activity: '',
    active: '',
    department: '',
    place: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/login');
      return;
    }
  }, [session, status, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/help-desk/create-ticket', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...formData,
          subprocess_id: subprocessId,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create ticket');
      }

      const result = await response.json();
      // Redirect to ticket details or success page
      router.push(`/process/help-desk/ticket/${result.id_case}`);
    } catch (err) {
      setError('Failed to create ticket. Please try again.');
      console.error('Error creating ticket:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  if (status === 'loading') {
    return <div>Loading...</div>;
  }

  if (!session) {
    return null;
  }

  const breadcrumbItems = [
    { title: 'Process', href: '/process' },
    { title: 'Help Desk', href: '#' },
    { title: 'Create Ticket', href: '#' },
  ].map((item, index) =>
    item.href !== '#' ? (
      <Link key={index} href={item.href} passHref>
        <Anchor component='span' className='hover:text-blue-600 transition-colors'>
          {item.title}
        </Anchor>
      </Link>
    ) : (
      <span key={index} className='text-gray-500'>
        {item.title}
      </span>
    )
  );

  return (
    <div className='max-w-4xl mx-auto py-12 px-4 sm:px-6 lg:px-8'>
      <div className='mb-8'>
        <Breadcrumbs separator={<IconChevronRight size={16} />} className='mb-4'>
          {breadcrumbItems}
        </Breadcrumbs>
        <Title order={1} className='text-3xl font-bold text-gray-900 mb-2'>
          Create Help Desk Ticket
        </Title>
        <p className='text-gray-600'>
          Fill out the form below to create a new help desk ticket.
          {subprocessId && ` Related to subprocess ID: ${subprocessId}`}
        </p>
      </div>

      {error && (
        <Alert icon={<IconAlertCircle size={16} />} title='Error' color='red' mb='md'>
          {error}
        </Alert>
      )}

      <Paper shadow='sm' p='lg' radius='md' withBorder>
        <form onSubmit={handleSubmit}>
          <Stack gap='md'>
            <TextInput
              label='Subject'
              placeholder='Brief description of the issue'
              required
              value={formData.subject}
              onChange={(e) => handleChange('subject', e.target.value)}
            />

            <Textarea
              label='Description'
              placeholder='Detailed description of the issue'
              required
              minRows={4}
              value={formData.description}
              onChange={(e) => handleChange('description', e.target.value)}
            />

            <Select
              label='Priority'
              placeholder='Select priority'
              required
              data={[
                { value: 'Low', label: 'Low' },
                { value: 'Medium', label: 'Medium' },
                { value: 'High', label: 'High' },
                { value: 'Critical', label: 'Critical' },
              ]}
              value={formData.priority}
              onChange={(value) => handleChange('priority', value || '')}
            />

            <Select
              label='Department'
              placeholder='Select department'
              required
              data={[
                { value: 'IT', label: 'IT' },
                { value: 'HR', label: 'HR' },
                { value: 'Finance', label: 'Finance' },
                { value: 'Operations', label: 'Operations' },
              ]}
              value={formData.department}
              onChange={(value) => handleChange('department', value || '')}
            />

            <TextInput
              label='Place/Location'
              placeholder='Where is the issue occurring?'
              value={formData.place}
              onChange={(e) => handleChange('place', e.target.value)}
            />

            <div className='flex gap-4 pt-4'>
              <Button type='submit' loading={loading} fullWidth>
                {loading ? 'Creating Ticket...' : 'Create Ticket'}
              </Button>
              <Button type='button' variant='outline' onClick={() => router.back()} fullWidth>
                Cancel
              </Button>
            </div>
          </Stack>
        </form>
      </Paper>
    </div>
  );
}

export default function CreateTicketPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <CreateTicketForm />
    </Suspense>
  );
}
