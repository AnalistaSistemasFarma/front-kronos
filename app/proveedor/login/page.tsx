'use client';

import { Suspense, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  Paper,
  Title,
  TextInput,
  Button,
  Stack,
  Text,
  Alert,
} from '@mantine/core';
import {
  IconEye,
  IconEyeOff,
  IconLock,
  IconId,
  IconArrowRight,
  IconAlertCircle,
} from '@tabler/icons-react';

function SupplierLoginForm() {
  const [nit, setNit] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const result = await signIn('supplier-nit', {
        nit,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError('NIT o contraseña incorrectos. Por favor, verifique e intente de nuevo.');
        toast.error('NIT o contraseña incorrectos.');
      } else {
        toast.success('Ingreso exitoso. Bienvenido a su portal.');
        router.push('/proveedor/portal');
      }
    } catch {
      setError('Ocurrió un error. Por favor, intente más tarde.');
      toast.error('Ocurrió un error. Por favor, intente más tarde.');
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
        padding: '20px',
        background: 'linear-gradient(135deg, #0b2545 0%, #113562 55%, #1d3b63 100%)',
      }}
      role='main'
      aria-labelledby='supplier-login-title'
    >
      <Paper
        shadow='xl'
        p='xl'
        radius='lg'
        withBorder
        style={{ maxWidth: 440, width: '100%', background: 'rgba(255,255,255,0.97)' }}
      >
        <img
          src='/Logo_Principal.svg'
          alt='SynerLink'
          width={1000}
          height={100}
          className='h-24 w-full object-contain'
          decoding='async'
        />
        <Title order={2} ta='center' mt='md' mb='xs' style={{ color: '#113562', fontWeight: 600 }}>
          Portal de Proveedores
        </Title>
        <Text size='sm' c='dimmed' ta='center' mb='lg'>
          Ingrese con su NIT para consultar su información.
        </Text>

        {error && (
          <Alert
            icon={<IconAlertCircle size={18} />}
            color='red'
            variant='light'
            mb='md'
            role='alert'
          >
            {error}
          </Alert>
        )}

        <form onSubmit={handleSubmit}>
          <Stack gap='md'>
            <TextInput
              label='NIT'
              placeholder='Ej: 900123456'
              required
              value={nit}
              onChange={(e) => setNit(e.target.value)}
              leftSection={<IconId size={16} />}
              aria-label='NIT del proveedor'
              autoComplete='username'
              inputMode='numeric'
            />
            <TextInput
              label='Contraseña'
              placeholder='Su contraseña'
              type={visible ? 'text' : 'password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              leftSection={<IconLock size={16} />}
              rightSection={
                <button
                  type='button'
                  onClick={() => setVisible(!visible)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666' }}
                  aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {visible ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                </button>
              }
              aria-label='Contraseña'
              autoComplete='current-password'
            />

            <Button
              type='submit'
              loading={loading}
              fullWidth
              size='lg'
              rightSection={!loading && <IconArrowRight size={16} />}
              style={{
                background: 'linear-gradient(135deg, #113562 0%, #3db6e0 100%)',
                border: 'none',
                marginTop: '6px',
              }}
            >
              {loading ? 'Ingresando...' : 'Ingresar'}
            </Button>
          </Stack>
        </form>
      </Paper>

      <Text ta='center' size='xs' mt='md' style={{ color: 'rgba(255,255,255,0.8)' }}>
        © {new Date().getFullYear()} Portal de Proveedores. Todos los derechos reservados.
      </Text>
    </div>
  );
}

export default function SupplierLogin() {
  return (
    <Suspense fallback={null}>
      <SupplierLoginForm />
    </Suspense>
  );
}
