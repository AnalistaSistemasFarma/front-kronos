'use client';

import { Suspense, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Paper, Title, TextInput, Button, Stack, Group, Text, ActionIcon } from '@mantine/core';
import {
  IconEye,
  IconEyeOff,
  IconLock,
  IconAt,
  IconArrowRight,
  IconMoon,
  IconSun,
} from '@tabler/icons-react';
import Link from 'next/link';
import { useTheme } from '../../components/providers';
import LoginPharmacyBackground from '../../components/login/LoginPharmacyBackground';
import { getSafeCallbackUrl } from '../../lib/auth/logout';

function LoginForm() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

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
        const callbackUrl = getSafeCallbackUrl(
          searchParams.get('callbackUrl'),
          typeof window !== 'undefined' ? window.location.origin : undefined
        );
        router.push(callbackUrl);
      }
    } catch {
      toast.error('Ocurrió un error. Por favor, inténtalo más tarde.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className='login-page'
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
      <LoginPharmacyBackground theme={theme} />

      <ActionIcon
        variant='subtle'
        color={isDark ? 'gray' : 'blue'}
        size='lg'
        radius='xl'
        onClick={toggleTheme}
        aria-label={isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
        className='login-theme-toggle'
        style={{
          position: 'absolute',
          top: 20,
          right: 20,
          zIndex: 2,
          background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.65)',
          backdropFilter: 'blur(8px)',
          border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(17,53,98,0.12)',
        }}
      >
        {isDark ? <IconSun size={18} /> : <IconMoon size={18} />}
      </ActionIcon>

      <style jsx>{`
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

        .form-container {
          animation: slideUp 0.8s ease-out 0.15s both;
          position: relative;
          z-index: 1;
        }

        .input-focus {
          transform: translateY(-2px);
          box-shadow: 0 4px 20px rgba(61, 182, 224, 0.35);
        }

        .btn-hover:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 25px rgba(17, 53, 98, 0.35);
        }

        @media (max-width: 480px) {
          .form-container {
            padding: 24px !important;
          }
        }
      `}</style>

      <Paper
        shadow='xl'
        p='xl'
        radius='lg'
        withBorder
        style={{
          maxWidth: 450,
          width: '100%',
          background: isDark ? 'rgba(31, 40, 64, 0.92)' : 'rgba(255, 255, 255, 0.94)',
          backdropFilter: 'blur(16px)',
          border: isDark
            ? '1px solid rgba(126, 200, 239, 0.18)'
            : '1px solid rgba(255, 255, 255, 0.6)',
          boxShadow: isDark
            ? '0 24px 48px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(94, 179, 232, 0.06)'
            : '0 20px 40px rgba(17, 53, 98, 0.12)',
        }}
        className='form-container'
      >
        <img
          src={isDark ? '/Logo_Principal_Blanco_Ancho.svg' : '/Logo_Principal.svg'}
          alt='SynerLink'
          width={1000}
          height={100}
          className='h-28 w-full object-contain'
          decoding='async'
        />
        <Title
          order={2}
          ta='center'
          mb='lg'
          style={{
            color: isDark ? '#f0f4ff' : '#1a2d42',
            fontWeight: 600,
            paddingTop: '20px',
          }}
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
                  focusedField === 'email' ? '0 4px 20px rgba(61, 182, 224, 0.35)' : 'none',
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
                    color: visible ? (isDark ? '#7ec8ef' : '#113562') : isDark ? '#9ca8c7' : '#999',
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
                  focusedField === 'password' ? '0 4px 20px rgba(61, 182, 224, 0.35)' : 'none',
              }}
              aria-label='Contraseña'
              autoComplete='current-password'
            />

            <Group justify='space-between' mt='md'>
              <Text
                size='sm'
                component={Link}
                href='/forgot-password'
                c={isDark ? '#7ec8ef' : '#113562'}
                style={{ textDecoration: 'none' }}
              >
                ¿Olvidaste tu contraseña? Solicita una nueva.
              </Text>
            </Group>

            <Button
              type='submit'
              loading={loading}
              fullWidth
              size='lg'
              rightSection={!loading && <IconArrowRight size={16} />}
              style={{
                background: 'linear-gradient(135deg, #113562 0%, #3db6e0 100%)',
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
      </Paper>

      <Text
        ta='center'
        size='xs'
        mt='md'
        style={{
          position: 'relative',
          zIndex: 1,
          color: isDark ? 'rgba(201, 214, 240, 0.75)' : 'rgba(17, 53, 98, 0.72)',
        }}
      >
        © 2025 Portal de servicios. Todos los derechos reservados.
      </Text>
    </div>
  );
}

export default function Login() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
