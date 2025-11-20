'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  Container,
  Title,
  Text,
  Card,
  TextInput,
  Button,
  PasswordInput,
  Avatar,
  Group,
  Stack,
  Alert,
  LoadingOverlay,
  Badge,
} from '@mantine/core';
import { IconCheck, IconX, IconUpload, IconUser, IconMail, IconLock } from '@tabler/icons-react';
import Header from '../../components/Header';

interface UserProfile {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  createdAt: string;
}

interface FormData {
  name: string;
  email: string;
  image: string | null;
}

interface PasswordFormData {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export default function ProfileSettingsPage() {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [formData, setFormData] = useState<FormData>({ name: '', email: '', image: '' });
  const [passwordFormData, setPasswordFormData] = useState<PasswordFormData>({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/login');
      return;
    }
    fetchProfile();
  }, [session, status, router]);

  const fetchProfile = async () => {
    try {
      const response = await fetch('/api/profile');
      if (response.ok) {
        const data = await response.json();
        setProfile(data.user);
        setFormData({
          name: data.user.name || '',
          email: data.user.email,
          image: data.user.image || '',
        });
      } else {
        setErrorMessage('Error al cargar el perfil');
      }
    } catch (error) {
      setErrorMessage('Error al cargar el perfil');
    } finally {
      setLoading(false);
    }
  };

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const submitData = new FormData();
      submitData.append('name', formData.name);
      submitData.append('email', formData.email);
      if (formData.image) {
        submitData.append('image', formData.image);
      }

      const response = await fetch('/api/profile', {
        method: 'PUT',
        body: submitData,
      });

      if (response.ok) {
        const data = await response.json();
        setProfile(data.user);
        setSuccessMessage('Perfil actualizado exitosamente');
        // Update session if needed
        if (
          data.user.name !== session?.user?.name ||
          data.user.email !== session?.user?.email ||
          data.user.image !== session?.user?.image
        ) {
          // Trigger session update
          await update({
            name: data.user.name,
            email: data.user.email,
            image: data.user.image,
          });
        }
      } else {
        const error = await response.json();
        setErrorMessage(error.error || 'Error al actualizar el perfil');
      }
    } catch (error) {
      setErrorMessage('Error al actualizar el perfil');
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangingPassword(true);
    setPasswordError('');
    setSuccessMessage('');

    if (passwordFormData.newPassword !== passwordFormData.confirmPassword) {
      setPasswordError('Las nuevas contraseñas no coinciden');
      setChangingPassword(false);
      return;
    }

    try {
      const response = await fetch('/api/profile/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword: passwordFormData.currentPassword,
          newPassword: passwordFormData.newPassword,
          confirmPassword: passwordFormData.confirmPassword,
        }),
      });

      if (response.ok) {
        setSuccessMessage('Contraseña cambiada exitosamente');
        setPasswordFormData({
          currentPassword: '',
          newPassword: '',
          confirmPassword: '',
        });
      } else {
        const error = await response.json();
        setPasswordError(error.error || 'Error al cambiar la contraseña');
      }
    } catch (error) {
      setPasswordError('Error al cambiar la contraseña');
    } finally {
      setChangingPassword(false);
    }
  };

  const validateImageUrl = (url: string): string | null => {
    if (!url) return null;
    try {
      new URL(url);
      return null;
    } catch {
      return 'Por favor ingresa una URL válida';
    }
  };

  const handleImageChange = (url: string) => {
    const error = validateImageUrl(url);
    if (error) {
      setErrorMessage(error);
      return;
    }
    setFormData({ ...formData, image: url });
    setErrorMessage('');
  };

  if (status === 'loading' || loading) {
    return (
      <>
        <Header />
        <Container size='md' py='xl'>
          <LoadingOverlay visible />
        </Container>
      </>
    );
  }

  return (
    <>
      <Header />
      <Container size='md' py='xl'>
        <Title order={2} mb='lg'>
          Configuración del Perfil
        </Title>

        {successMessage && (
          <Alert icon={<IconCheck size={16} />} color='green' mb='md'>
            {successMessage}
          </Alert>
        )}

        {errorMessage && (
          <Alert icon={<IconX size={16} />} color='red' mb='md'>
            {errorMessage}
          </Alert>
        )}

        <Stack gap='xl'>
          {/* Personal Information Section */}
          <Card withBorder padding='lg' radius='md'>
            <Title order={3} mb='md'>
              <Group gap='xs'>
                <IconUser size={20} />
                Información Personal
              </Group>
            </Title>

            <form onSubmit={handleProfileSubmit}>
              <Stack gap='md'>
                <Group align='center' gap='md'>
                  <Avatar
                    src={formData.image || profile?.image}
                    alt={profile?.name || 'Profile'}
                    size='xl'
                  />
                  <div>
                    <TextInput
                      label='Foto de Perfil (URL)'
                      placeholder='Ingresa la URL de tu imagen'
                      value={formData.image || ''}
                      onChange={(e) => handleImageChange(e.target.value)}
                      size='sm'
                      leftSection={<IconUpload size={16} />}
                    />
                    <Text size='xs' c='dimmed' mt={4}>
                      Ingresa una URL válida de imagen
                    </Text>
                  </div>
                </Group>

                <TextInput
                  label='Nombre Completo'
                  placeholder='Ingresa tu nombre completo'
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  leftSection={<IconUser size={16} />}
                />

                <TextInput
                  label='Email Address'
                  placeholder='Enter your email'
                  type='email'
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                  leftSection={<IconMail size={16} />}
                />

                <Group justify='flex-end'>
                  <Button type='submit' loading={saving}>
                    Guardar Cambios
                  </Button>
                </Group>
              </Stack>
            </form>
          </Card>

          {/* Change Password Section */}
          <Card withBorder padding='lg' radius='md'>
            <Title order={3} mb='md'>
              <Group gap='xs'>
                <IconLock size={20} />
                Cambiar Contraseña
              </Group>
            </Title>

            {passwordError && (
              <Alert icon={<IconX size={16} />} color='red' mb='md'>
                {passwordError}
              </Alert>
            )}

            <form onSubmit={handlePasswordSubmit}>
              <Stack gap='md'>
                <PasswordInput
                  label='Contraseña Actual'
                  placeholder='Ingresa la contraseña actual'
                  value={passwordFormData.currentPassword}
                  onChange={(e) =>
                    setPasswordFormData({ ...passwordFormData, currentPassword: e.target.value })
                  }
                  required
                />

                <PasswordInput
                  label='Nueva Contraseña'
                  placeholder='Ingresa la nueva contraseña'
                  description='Debe tener al menos 8 caracteres con mayúscula, minúscula, número y carácter especial'
                  value={passwordFormData.newPassword}
                  onChange={(e) =>
                    setPasswordFormData({ ...passwordFormData, newPassword: e.target.value })
                  }
                  required
                />

                <PasswordInput
                  label='Confirmar Nueva Contraseña'
                  placeholder='Confirma la nueva contraseña'
                  value={passwordFormData.confirmPassword}
                  onChange={(e) =>
                    setPasswordFormData({ ...passwordFormData, confirmPassword: e.target.value })
                  }
                  required
                />

                <Group justify='flex-end'>
                  <Button type='submit' loading={changingPassword}>
                    Cambiar Contraseña
                  </Button>
                </Group>
              </Stack>
            </form>
          </Card>
        </Stack>
      </Container>
    </>
  );
}
