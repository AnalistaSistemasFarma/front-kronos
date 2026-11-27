'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  Loader,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconId } from '@tabler/icons-react';
import { SIGNER_ID_DOCUMENT_OPTIONS } from '../../lib/orion/signerIdentity';
import { SIGNING_LEGAL_COPY } from '../../lib/orion/signingLegalConsent';
import { invalidateUserProfileCache } from '../../lib/orion/userProfileClient';

type Result = { tipo: 'ok' | 'error'; mensaje: string };
interface SealView {
  disponible: boolean;
  fullName?: string | null;
  idDocumentType?: string | null;
  idNumber?: string | null;
  jobTitle?: string | null;
  hasSigningLegalConsent: boolean;
}

const VACIO = { fullName: '', idDocumentType: 'CC', idNumber: '', jobTitle: '' };

/**
 * «Datos del sello» en el perfil, junto a «Mi firma» (2026-11-20): nombre,
 * documento y cargo con los que se estampa la firma, más la aceptación de las
 * condiciones de firma electrónica. Con esto completo, autorizar una firma la
 * deja firmada de una vez, sin el modal de cédula/cargo.
 * Los datos viven en GSS Firma (Orión), no en el navegador (Ley 1581).
 */
export default function SealDataSection({
  hasSignature,
  onResult,
}: {
  hasSignature: boolean;
  onResult: (r: Result) => void;
}) {
  const { data: session } = useSession();
  const [vista, setVista] = useState<SealView | null>(null);
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState(VACIO);
  const [aceptaTerminos, setAceptaTerminos] = useState(false);
  const [password, setPassword] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/firma-gss/datos-sello', { cache: 'no-store' });
      setVista(res.ok ? ((await res.json()) as SealView) : { disponible: false, hasSigningLegalConsent: false });
    } catch {
      setVista({ disponible: false, hasSigningLegalConsent: false });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Para firmar de una vez basta el nombre y las condiciones aceptadas; documento y cargo son opcionales.
  const complete = Boolean(vista?.fullName && vista?.hasSigningLegalConsent);

  const open = () => {
    setForm({
      fullName: vista?.fullName || session?.user?.name || '',
      idDocumentType: vista?.idDocumentType || 'CC',
      idNumber: vista?.idNumber || '',
      jobTitle: vista?.jobTitle || '',
    });
    setAceptaTerminos(false);
    setPassword('');
    setError(null);
    setEditando(true);
  };

  const cancel = () => {
    setEditando(false);
    setPassword('');
    setError(null);
  };

  const save = async () => {
    if (!vista?.hasSigningLegalConsent && !aceptaTerminos) {
      return setError('Debe leer y aceptar las condiciones de firma electrónica.');
    }
    if (!password) return setError('Escriba su contraseña de SynerLink para guardar sus datos.');
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch('/api/firma-gss/datos-sello', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, acceptedTerms: aceptaTerminos, password }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || 'No se pudieron guardar sus datos.');
      // La firma automática lee el perfil de un caché de pestaña: que vea los datos nuevos.
      invalidateUserProfileCache(session?.user?.email);
      cancel();
      await load();
      onResult({ tipo: 'ok', mensaje: 'Datos del sello guardados. Al autorizar una firma, quedará firmada de una vez.' });
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : 'No se pudieron guardar sus datos.';
      setError(mensaje);
      setPassword('');
      onResult({ tipo: 'error', mensaje });
    } finally {
      setGuardando(false);
    }
  };

  const documentTypeLabel = (v?: string | null) => SIGNER_ID_DOCUMENT_OPTIONS.find((o) => o.value === v)?.label ?? v ?? '—';

  return (
    <Stack gap='sm' data-testid='datos-sello'>
      <Divider my='xs' />
      <Group justify='space-between' align='center'>
        <Title order={4}>
          <Group gap='xs'>
            <IconId size={18} />
            Datos del sello
          </Group>
        </Title>
        {vista?.disponible && (
          <Badge color={complete ? 'green' : 'yellow'} variant='light'>
            {complete ? 'Completos' : 'Incompletos'}
          </Badge>
        )}
      </Group>
      <Text size='sm' c='dimmed'>
        Nombre (obligatorio), documento y cargo (opcionales) con los que se estampa su firma. Con el nombre y las
        condiciones aceptadas, al autorizar una firma el documento queda firmado de una vez.
      </Text>

      {!vista && <Loader size='sm' />}

      {vista && !vista.disponible && (
        <Alert color='yellow' icon={<IconAlertTriangle size={18} />}>
          GSS Firma no responde en este momento. Intente más tarde.
        </Alert>
      )}

      {vista?.disponible && !editando && (
        <Stack gap='xs'>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='xs'>
            <Text size='sm'>
              <b>Nombre:</b> {vista.fullName || '—'}
            </Text>
            <Text size='sm'>
              <b>Documento:</b> {vista.idNumber ? `${documentTypeLabel(vista.idDocumentType)} ${vista.idNumber}` : '—'}
            </Text>
            <Text size='sm'>
              <b>Cargo:</b> {vista.jobTitle || '—'}
            </Text>
            <Text size='sm'>
              <b>Condiciones de firma:</b> {vista.hasSigningLegalConsent ? 'Aceptadas' : 'Pendientes'}
            </Text>
          </SimpleGrid>
          <Group>
            <Button
              size='md'
              variant='light'
              onClick={open}
              disabled={!hasSignature}
              data-testid='datos-sello-editar'
            >
              {complete ? 'Cambiar mis datos' : 'Completar mis datos'}
            </Button>
          </Group>
          {!hasSignature && (
            <Text size='xs' c='dimmed'>
              Registre primero su firma: los datos del sello se guardan junto a ella.
            </Text>
          )}
        </Stack>
      )}

      {vista?.disponible && editando && (
        <Stack gap='sm'>
          {error && (
            <Alert color='red' icon={<IconAlertTriangle size={18} />} withCloseButton onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          <TextInput
            size='md'
            label='Nombre completo'
            value={form.fullName}
            onChange={(e) => setForm((f) => ({ ...f, fullName: e.currentTarget.value }))}
            maxLength={80}
            required
          />
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='sm'>
            <Select
              size='md'
              label='Tipo de documento'
              data={SIGNER_ID_DOCUMENT_OPTIONS}
              value={form.idDocumentType}
              onChange={(v) => setForm((f) => ({ ...f, idDocumentType: v || 'CC' }))}
              allowDeselect={false}
            />
            <TextInput
              size='md'
              label='Número de documento (opcional)'
              value={form.idNumber}
              onChange={(e) => setForm((f) => ({ ...f, idNumber: e.currentTarget.value }))}
              maxLength={50}
            />
          </SimpleGrid>
          <TextInput
            size='md'
            label='Cargo (opcional)'
            description='Solo se estampa en el sello si lo registra.'
            value={form.jobTitle}
            onChange={(e) => setForm((f) => ({ ...f, jobTitle: e.currentTarget.value }))}
            maxLength={120}
          />
          {!vista.hasSigningLegalConsent && (
            <Alert color='blue' variant='light' title={SIGNING_LEGAL_COPY.ELECTRONIC.title}>
              <Text size='sm' mb='xs'>
                {SIGNING_LEGAL_COPY.ELECTRONIC.body}
              </Text>
              <Checkbox
                checked={aceptaTerminos}
                onChange={(e) => setAceptaTerminos(e.currentTarget.checked)}
                label='He leído y acepto firmar electrónicamente los documentos que autorice o firme en SynerLink. Entiendo que esta firma tiene la misma validez legal que una firma manuscrita, y autorizo el tratamiento de mis datos de identificación para este fin.'
              />
            </Alert>
          )}
          <PasswordInput
            size='md'
            label='Contraseña de SynerLink'
            description='Confirma que es usted quien registra sus datos. No se guarda.'
            autoComplete='current-password'
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
          />
          <Group justify='flex-end' gap='sm'>
            <Button variant='default' size='md' onClick={cancel} disabled={guardando}>
              Cancelar
            </Button>
            <Button
              size='md'
              leftSection={<IconCheck size={16} />}
              onClick={save}
              loading={guardando}
              disabled={!password}
              data-testid='datos-sello-guardar'
            >
              Guardar mis datos
            </Button>
          </Group>
        </Stack>
      )}
    </Stack>
  );
}
