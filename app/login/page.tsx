'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Paper, Title, TextInput, Button, Stack, Divider } from '@mantine/core';
import { IconEye, IconEyeOff } from '@tabler/icons-react';
import Image from 'next/image';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        toast.error('Invalid credentials');
      } else {
        toast.success('Bienvenido');
        router.push('/dashboard');
      }
    } catch {
      toast.error('An error occurred');
    } finally {
      setLoading(false);
    }
  };

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
          Bienvenido al Portal de servicios
        </Title>
        <p className='text-xs italic'>Inicia sesión con tu cuenta</p>

        <form onSubmit={handleSubmit}>
          <Stack>
            <TextInput
              label='Dirección de correo electrónico'
              placeholder='Dirección de correo electrónico'
              type='email'
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <TextInput
              label='Contraseña'
              placeholder='Contraseña'
              type={visible ? 'text' : 'password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              rightSection={
                <button
                  type='button'
                  onClick={() => setVisible(!visible)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  {visible ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                </button>
              }
            />
            <Button type='submit' loading={loading} fullWidth>
              {loading ? 'Iniciando sesión...' : 'Iniciar sesión'}
            </Button>
          </Stack>
        </form>
      </Paper>
    </div>
  );
}
