'use client';

import { useEffect, useState } from 'react';
import {
  Alert,
  Anchor,
  Box,
  Button,
  Checkbox,
  Collapse,
  Group,
  Image,
  Loader,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { IconCheck, IconFingerprint, IconPencil } from '@tabler/icons-react';
import { FINGERPRINT_NOT_REGISTERED_MESSAGE } from '../../lib/orion/errorCodes';
import { formatSignerIdLabel } from '../../lib/orion/signerIdentity';
import {
  BIOMETRIC_CONSENT_COPY,
  BIOMETRIC_CONSENT_REQUIRED_MESSAGE,
  SIGNING_LEGAL_CONSENT_REQUIRED_MESSAGE,
  SIGNING_LEGAL_CONSENT_VERSION,
  SIGNING_LEGAL_COPY,
} from '../../lib/orion/signingLegalConsent';

/** Respuesta de GET /api/integrations/orion/user-profile. */
export type SignerTurnPreview = {
  fullName: string | null;
  idDocumentType: string | null;
  idNumber: string | null;
  jobTitle: string | null;
  companyName: string | null;
  hasSignature: boolean;
  signatureDataUrl: string | null;
  hasFingerprint: boolean;
  hasSigningLegalConsent: boolean;
  hasBiometricConsent: boolean;
  missingInOrion: Array<'fullName' | 'idNumber' | 'jobTitle'>;
  suggested: { fullName: string | null; idNumber: string | null };
  signatureProfileUrl: string | null;
  fingerprintProfileUrl: string | null;
};

export type SignerTurnConfirmation = {
  acceptedTerms: boolean;
  acceptedBiometric?: boolean;
  /** Solo lo que falta en el perfil Orion; Orion lo guarda y no pisa lo existente. */
  supplement?: { fullName?: string; idNumber?: string; jobTitle?: string };
};

type Props = {
  documentFileName?: string | null;
  currentUserEmail?: string | null;
  preview: SignerTurnPreview | null;
  previewLoading?: boolean;
  /** Rúbrica dibujada en este turno: reemplaza la guardada en Orion. */
  drawnSignature: string | null;
  onDrawSignature: () => void;
  onDiscardDrawnSignature: () => void;
  requireFingerprint: boolean;
  canFingerprint: boolean;
  personHasSigningConsent: boolean;
  personHasBiometricConsent: boolean;
  confirming?: boolean;
  externalError?: string | null;
  /** Enlace a "Mi huella" cuando Orion responde FINGERPRINT_NOT_REGISTERED. */
  fingerprintHelpUrl?: string | null;
  onCancel: () => void;
  onConfirm: (confirmation: SignerTurnConfirmation) => void | Promise<void>;
};

function ReadOnlyRow({ label, value }: { label: string; value: string | null }) {
  return (
    <Group justify='space-between' gap='xs' wrap='nowrap'>
      <Text size='xs' c='dimmed'>
        {label}
      </Text>
      <Text size='sm' fw={500} ta='right' style={{ wordBreak: 'break-word' }}>
        {value || '—'}
      </Text>
    </Group>
  );
}

export default function SignerTurnConfirm({
  documentFileName = null,
  currentUserEmail,
  preview,
  previewLoading = false,
  drawnSignature,
  onDrawSignature,
  onDiscardDrawnSignature,
  requireFingerprint,
  canFingerprint,
  personHasSigningConsent,
  personHasBiometricConsent,
  confirming = false,
  externalError = null,
  fingerprintHelpUrl = null,
  onCancel,
  onConfirm,
}: Props) {
  const legal = SIGNING_LEGAL_COPY.ELECTRONIC;
  const [acceptedTerms, setAcceptedTerms] = useState(personHasSigningConsent);
  const [acceptedBiometric, setAcceptedBiometric] = useState(personHasBiometricConsent);
  const [termsOpen, setTermsOpen] = useState(false);
  const [biometricOpen, setBiometricOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [supplementName, setSupplementName] = useState('');
  const [supplementIdNumber, setSupplementIdNumber] = useState('');
  const [supplementJobTitle, setSupplementJobTitle] = useState('');

  useEffect(() => {
    if (personHasSigningConsent) setAcceptedTerms(true);
  }, [personHasSigningConsent]);

  useEffect(() => {
    if (personHasBiometricConsent) setAcceptedBiometric(true);
  }, [personHasBiometricConsent]);

  useEffect(() => {
    if (!preview) return;
    setSupplementName((v) => v || preview.suggested.fullName || '');
    setSupplementIdNumber((v) => v || preview.suggested.idNumber || '');
  }, [preview]);

  const missing = new Set(preview?.missingInOrion ?? []);
  const hasSavedSignature = Boolean(preview?.hasSignature);
  const signatureToShow = drawnSignature || preview?.signatureDataUrl || null;
  const fingerprintHelp = fingerprintHelpUrl || preview?.fingerprintProfileUrl || null;
  const fingerprintMissing = requireFingerprint && preview != null && !preview.hasFingerprint;
  const needsSignature = !drawnSignature && !hasSavedSignature;

  const canSubmit =
    !confirming &&
    !previewLoading &&
    !needsSignature &&
    !fingerprintMissing &&
    (personHasSigningConsent || acceptedTerms) &&
    (!requireFingerprint || (canFingerprint && (personHasBiometricConsent || acceptedBiometric)));

  const handleSubmit = async () => {
    if (!personHasSigningConsent && !acceptedTerms) {
      setFormError(SIGNING_LEGAL_CONSENT_REQUIRED_MESSAGE);
      return;
    }
    if (requireFingerprint && !personHasBiometricConsent && !acceptedBiometric) {
      setFormError(BIOMETRIC_CONSENT_REQUIRED_MESSAGE);
      return;
    }
    if (missing.has('fullName') && supplementName.trim().length < 3) {
      setFormError('Indique su nombre completo (mínimo 3 caracteres).');
      return;
    }
    setFormError(null);
    const supplement: SignerTurnConfirmation['supplement'] = {};
    if (missing.has('fullName') && supplementName.trim()) supplement.fullName = supplementName.trim();
    if (missing.has('idNumber') && supplementIdNumber.trim()) supplement.idNumber = supplementIdNumber.trim();
    if (missing.has('jobTitle') && supplementJobTitle.trim()) supplement.jobTitle = supplementJobTitle.trim();
    await onConfirm({
      acceptedTerms: true,
      acceptedBiometric: requireFingerprint ? true : undefined,
      supplement: Object.keys(supplement).length > 0 ? supplement : undefined,
    });
  };

  return (
    <Stack gap='sm'>
      {documentFileName ? (
        <Alert color='teal' variant='light' title='Documento a firmar'>
          <Text size='sm' fw={600} style={{ wordBreak: 'break-word' }}>
            {documentFileName}
          </Text>
        </Alert>
      ) : null}

      {previewLoading ? (
        <Group gap='xs'>
          <Loader size='xs' />
          <Text size='sm' c='dimmed'>
            Consultando su perfil en GSS Firma…
          </Text>
        </Group>
      ) : (
        <Box
          p='sm'
          style={{ border: '1px solid var(--mantine-color-gray-3)', borderRadius: 8 }}
        >
          <Text size='xs' c='dimmed' mb={6}>
            Datos de su perfil en GSS Firma (Orion)
          </Text>
          <Stack gap={4}>
            <ReadOnlyRow label='Nombre' value={preview?.fullName ?? null} />
            <ReadOnlyRow
              label='Documento'
              value={formatSignerIdLabel(preview?.idDocumentType, preview?.idNumber)}
            />
            <ReadOnlyRow label='Cargo' value={preview?.jobTitle ?? null} />
          </Stack>
        </Box>
      )}

      {!previewLoading && missing.size > 0 ? (
        <Stack gap={6}>
          <Text size='xs' c='dimmed'>
            Su perfil en Orion no tiene estos datos. Lo que indique se guardará allí una sola vez.
          </Text>
          {missing.has('fullName') ? (
            <TextInput
              label='Nombre completo'
              value={supplementName}
              onChange={(e) => setSupplementName(e.currentTarget.value)}
              disabled={confirming}
              required
            />
          ) : null}
          {missing.has('idNumber') ? (
            <TextInput
              label='Número de cédula'
              description='Opcional'
              value={supplementIdNumber}
              onChange={(e) => setSupplementIdNumber(e.currentTarget.value)}
              disabled={confirming}
            />
          ) : null}
          {missing.has('jobTitle') ? (
            <TextInput
              label='Cargo'
              description='Opcional'
              value={supplementJobTitle}
              onChange={(e) => setSupplementJobTitle(e.currentTarget.value)}
              disabled={confirming}
            />
          ) : null}
        </Stack>
      ) : null}

      <Stack gap={6}>
        <Group justify='space-between'>
          <Text size='sm' fw={600}>
            Firma
          </Text>
          <Group gap={4}>
            {drawnSignature ? (
              <Button size='compact-xs' variant='subtle' color='gray' onClick={onDiscardDrawnSignature}>
                Usar la guardada
              </Button>
            ) : null}
            <Button
              size='compact-xs'
              variant='light'
              leftSection={<IconPencil size={12} />}
              disabled={confirming}
              onClick={onDrawSignature}
            >
              {needsSignature ? 'Dibujar firma' : 'Dibujar otra (opcional)'}
            </Button>
          </Group>
        </Group>
        {signatureToShow ? (
          <Box
            p={6}
            style={{
              border: '1px dashed var(--mantine-color-gray-4)',
              borderRadius: 8,
              background: 'var(--mantine-color-gray-0)',
            }}
          >
            <Image src={signatureToShow} alt='Firma' h={80} fit='contain' />
          </Box>
        ) : null}
        <Text size='xs' c='dimmed'>
          {drawnSignature
            ? 'Esta firma se usará en el documento y reemplazará la guardada en Orion.'
            : hasSavedSignature
              ? 'Se usará la firma guardada en su perfil de Orion.'
              : 'No tiene firma registrada en Orion. Dibújela para continuar.'}
        </Text>
      </Stack>

      {requireFingerprint ? (
        !canFingerprint ? (
          <Alert color='orange' variant='light'>
            Este documento requiere huella, pero no tiene permiso “Registrar huella”. Pídalo en
            Administración → Usuarios.
          </Alert>
        ) : fingerprintMissing || fingerprintHelpUrl ? (
          <Alert color='orange' variant='light' icon={<IconFingerprint size={16} />}>
            <Text size='xs'>{FINGERPRINT_NOT_REGISTERED_MESSAGE}</Text>
            {fingerprintHelp ? (
              <Anchor href={fingerprintHelp} target='_blank' rel='noreferrer' size='xs' fw={600}>
                Cargar huella en Firmas GSS
              </Anchor>
            ) : null}
          </Alert>
        ) : preview?.hasFingerprint ? (
          <Alert color='green' variant='light' icon={<IconCheck size={16} />}>
            <Text size='xs'>Se usará la huella registrada en “Mi huella” de GSS Firma.</Text>
          </Alert>
        ) : null
      ) : null}

      <Stack gap={6}>
        <Text size='sm' fw={600}>
          {legal.title}
        </Text>
        <Text
          size='xs'
          c='blue'
          style={{ cursor: 'pointer', textDecoration: 'underline', width: 'fit-content' }}
          onClick={() => setTermsOpen((o) => !o)}
        >
          {termsOpen ? 'Ocultar condiciones' : 'Ver condiciones de firma'}
        </Text>
        <Collapse in={termsOpen}>
          <Alert color='gray' variant='light'>
            <Text size='xs'>{legal.body}</Text>
            <Text size='xs' c='dimmed' mt={6}>
              Versión de consentimiento: {SIGNING_LEGAL_CONSENT_VERSION}
              {currentUserEmail ? ` · ${currentUserEmail}` : ''}
            </Text>
          </Alert>
        </Collapse>
        {personHasSigningConsent ? (
          <Text size='xs' c='green'>
            Ya autorizó la firma electrónica en su perfil; no es necesario aceptar de nuevo.
          </Text>
        ) : (
          <Checkbox
            checked={acceptedTerms}
            disabled={confirming}
            label={legal.checkbox}
            onChange={(e) => {
              setAcceptedTerms(e.currentTarget.checked);
              setFormError(null);
            }}
          />
        )}
      </Stack>

      {requireFingerprint && canFingerprint ? (
        <Stack gap={6}>
          <Text size='sm' fw={600}>
            {BIOMETRIC_CONSENT_COPY.title}
          </Text>
          <Text
            size='xs'
            c='blue'
            style={{ cursor: 'pointer', textDecoration: 'underline', width: 'fit-content' }}
            onClick={() => setBiometricOpen((o) => !o)}
          >
            {biometricOpen ? 'Ocultar autorización biométrica' : 'Ver autorización biométrica'}
          </Text>
          <Collapse in={biometricOpen}>
            <Alert color='orange' variant='light'>
              <Text size='xs'>{BIOMETRIC_CONSENT_COPY.body}</Text>
            </Alert>
          </Collapse>
          {personHasBiometricConsent ? (
            <Text size='xs' c='green'>
              Ya autorizó el tratamiento de su huella en su perfil.
            </Text>
          ) : (
            <Checkbox
              checked={acceptedBiometric}
              disabled={confirming}
              label={BIOMETRIC_CONSENT_COPY.checkbox}
              onChange={(e) => {
                setAcceptedBiometric(e.currentTarget.checked);
                setFormError(null);
              }}
            />
          )}
        </Stack>
      ) : null}

      {(formError || externalError) && (
        <Alert color='red' variant='light'>
          {formError || externalError}
        </Alert>
      )}

      <Group justify='flex-end' mt='xs'>
        <Button variant='default' disabled={confirming} onClick={onCancel}>
          Volver
        </Button>
        <Button
          color='green'
          loading={confirming}
          disabled={!canSubmit}
          onClick={() => void handleSubmit()}
        >
          Confirmar y firmar
        </Button>
      </Group>
    </Stack>
  );
}
