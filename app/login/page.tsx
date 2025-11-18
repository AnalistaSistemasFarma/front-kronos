'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Paper, Title, TextInput, Button, Stack, Group, Text, Divider } from '@mantine/core';
import { IconEye, IconEyeOff, IconLock, IconAt, IconArrowRight } from '@tabler/icons-react';
import Link from 'next/link';
import TextLogo from '../../components/TextLogo';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
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
        toast.error('Credenciales inválidas. Por favor, inténtalo de nuevo.');
      } else {
        router.push('/dashboard');
      }
    } catch {
      toast.error('Ocurrió un error. Por favor, inténtalo más tarde.');
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
        position: 'relative',
        overflow: 'hidden',
        padding: '20px',
      }}
      role='main'
      aria-labelledby='login-title'
    >
      {/* Background with animated gradient and shapes */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)',
          zIndex: -2,
        }}
      />

      {/* Animated background shapes */}
      <div
        className='bg-shapes'
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: -1,
          overflow: 'hidden',
        }}
      >
        <div className='shape shape-1'></div>
        <div className='shape shape-2'></div>
        <div className='shape shape-3'></div>
        <div className='shape shape-4'></div>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes float {
          0%,
          100% {
            transform: translateY(0) rotate(0deg);
          }
          50% {
            transform: translateY(-20px) rotate(5deg);
          }
        }

        @keyframes pulse {
          0%,
          100% {
            opacity: 0.4;
            transform: scale(1);
          }
          50% {
            opacity: 0.2;
            transform: scale(1.1);
          }
        }

        .form-container {
          animation: slideUp 0.8s ease-out 0.2s both;
        }

        .logo {
          transition: transform 0.3s ease;
          animation: fadeIn 1s ease-in-out;
        }

        .logo:hover {
          transform: scale(1.05);
        }

        .shape {
          position: absolute;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(5px);
        }

        .shape-1 {
          width: 300px;
          height: 300px;
          top: -150px;
          right: -100px;
          animation: float 15s infinite ease-in-out;
        }

        .shape-2 {
          width: 200px;
          height: 200px;
          bottom: -100px;
          left: -50px;
          animation: float 12s infinite ease-in-out reverse;
        }

        .shape-3 {
          width: 150px;
          height: 150px;
          top: 50%;
          left: 10%;
          animation: pulse 8s infinite ease-in-out;
        }

        .shape-4 {
          width: 100px;
          height: 100px;
          top: 20%;
          right: 15%;
          animation: float 10s infinite ease-in-out 2s;
        }

        .input-focus {
          transform: translateY(-2px);
          box-shadow: 0 4px 20px rgba(102, 126, 234, 0.4);
        }

        .btn-hover:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 25px rgba(102, 126, 234, 0.5);
        }

        @media (max-width: 768px) {
          .form-container {
            margin: 0 16px;
          }
          .text-logo.logo {
            width: 250px !important;
            height: auto !important;
            font-size: 22px !important;
          }
          .shape-1,
          .shape-2 {
            width: 200px;
            height: 200px;
          }
          .shape-3,
          .shape-4 {
            width: 100px;
            height: 100px;
          }
        }

        @media (max-width: 480px) {
          .form-container {
            margin: 0 8px;
            padding: 24px !important;
          }
          .text-logo.logo {
            width: 200px !important;
            height: auto !important;
            font-size: 18px !important;
          }
        }
      `}</style>

      <TextLogo size='large' className='mb-6 logo' withShadow={true} withHover={true} />

      <Paper
        shadow='xl'
        p='xl'
        radius='lg'
        withBorder
        style={{
          maxWidth: 450,
          width: '100%',
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.1)',
        }}
        className='form-container'
      >
        <Title
          order={2}
          ta='center'
          mb='lg'
          style={{ color: '#333', fontWeight: 600 }}
          id='login-title'
        >
          Bienvenido al Portal de servicios
        </Title>
        <Text size='sm' c='dimmed' ta='center' mb='lg'>
          Inicia sesión para acceder a tu cuenta
        </Text>

        <form onSubmit={handleSubmit}>
          <Stack gap='md'>
            <TextInput
              label='Correo electrónico'
              placeholder='tu@email.com'
              type='email'
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              leftSection={<IconAt size={16} />}
              onFocus={() => setFocusedField('email')}
              onBlur={() => setFocusedField(null)}
              style={{
                transition: 'all 0.3s ease',
                transform: focusedField === 'email' ? 'translateY(-2px)' : 'none',
                boxShadow:
                  focusedField === 'email' ? '0 4px 20px rgba(102, 126, 234, 0.4)' : 'none',
              }}
              aria-label='Correo electrónico'
              autoComplete='email'
            />
            <TextInput
              label='Contraseña'
              placeholder='Tu contraseña'
              type={visible ? 'text' : 'password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              leftSection={<IconLock size={16} />}
              rightSection={
                <button
                  type='button'
                  onClick={() => setVisible(!visible)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'color 0.3s ease',
                    color: visible ? '#667eea' : '#999',
                  }}
                  aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {visible ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                </button>
              }
              onFocus={() => setFocusedField('password')}
              onBlur={() => setFocusedField(null)}
              style={{
                transition: 'all 0.3s ease',
                transform: focusedField === 'password' ? 'translateY(-2px)' : 'none',
                boxShadow:
                  focusedField === 'password' ? '0 4px 20px rgba(102, 126, 234, 0.4)' : 'none',
              }}
              aria-label='Contraseña'
              autoComplete='current-password'
            />

            <Group justify='space-between' mt='md'>
              <Text
                size='sm'
                component={Link}
                href='/forgot-password'
                c='#667eea'
                style={{ textDecoration: 'none' }}
              >
                ¿Olvidaste tu contraseña?
              </Text>
            </Group>

            <Button
              type='submit'
              loading={loading}
              fullWidth
              size='lg'
              rightSection={!loading && <IconArrowRight size={16} />}
              style={{
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                border: 'none',
                transition: 'all 0.3s ease',
                marginTop: '10px',
              }}
              className='btn-hover'
            >
              {loading ? 'Iniciando sesión...' : 'Iniciar sesión'}
            </Button>
          </Stack>
        </form>

        <Divider label='O' labelPosition='center' my='lg' />

        <Text ta='center' size='sm'>
          ¿No tienes una cuenta?{' '}
          <Text
            component={Link}
            href='/register'
            c='#667eea'
            style={{ textDecoration: 'none', fontWeight: 600 }}
          >
            Regístrate
          </Text>
        </Text>
      </Paper>

      <Text ta='center' size='xs' c='rgba(255, 255, 255, 0.8)' mt='md'>
        © 2024 Portal de servicios. Todos los derechos reservados.
      </Text>
    </div>
  );
}
