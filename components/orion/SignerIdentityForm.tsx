'use client';

import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import {
  clearStoredSignerIdentity,
  normalizeSignerIdentity,
  SIGNER_ID_DOCUMENT_OPTIONS,
  formatSignerIdLabel,
  isCompanyNitDocumentType,
  validateSignerIdentity,
  type SignerAcceptIdentity,
  type SignerIdDocumentType,
} from '../../lib/orion/signerIdentity';
import {
  BIOMETRIC_CONSENT_COPY,
  BIOMETRIC_CONSENT_REQUIRED_MESSAGE,
  SIGNING_LEGAL_CONSENT_REQUIRED_MESSAGE,
  SIGNING_LEGAL_CONSENT_VERSION,
  SIGNING_LEGAL_COPY,
} from '../../lib/orion/signingLegalConsent';

type Props = {
  defaultName?: string | null;
  currentUserEmail?: string | null;
  confirming?: boolean;
  externalError?: string | null;
  onClearExternalError?: () => void;
  onCancel: () => void;
  onConfirm: (identity: SignerAcceptIdentity) => void | Promise<void>;
  /** Captura de huella (si el documento la exige). */
  fingerprintSlot?: React.ReactNode;
  /** Exige autorización biométrica (Ley 1581 art. 6) además del consentimiento de firma. */
  requireBiometricConsent?: boolean;
  /** ELECTRONIC (default) | DIGITAL */
  legalKind?: 'ELECTRONIC' | 'DIGITAL';
  /**
   * Consentimiento ya guardado a nivel persona (no por documento).
   * Si la versión vigente coincide, no se vuelve a pedir checkbox.
   */
  personHasSigningConsent?: boolean;
  personHasBiometricConsent?: boolean;
};

export default function SignerIdentityForm({
  defaultName,
  currentUserEmail,
  confirming = false,
  externalError = null,
  onClearExternalError,
  onCancel,
  onConfirm,
  fingerprintSlot = null,
  requireBiometricConsent = false,
  legalKind = 'ELECTRONIC',
  personHasSigningConsent = false,
  personHasBiometricConsent = false,
}: Props) {
  const legal = SIGNING_LEGAL_COPY[legalKind] ?? SIGNING_LEGAL_COPY.ELECTRONIC;

  const [fullName, setFullName] = useState(() => defaultName || '');
  const [idDocumentType, setIdDocumentType] = useState<SignerIdDocumentType>('CC');
  const [idNumber, setIdNumber] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(() => personHasSigningConsent);
  const [acceptedBiometric, setAcceptedBiometric] = useState(
    () => personHasBiometricConsent && requireBiometricConsent
  );
  const [termsOpen, setTermsOpen] = useState(!personHasSigningConsent);
  const [biometricOpen, setBiometricOpen] = useState(
    !(personHasBiometricConsent && requireBiometricConsent)
  );
  const [formError, setFormError] = useState<string | null>(null);

  // Limpia residuos de identidad en localStorage (versiones anteriores).
  useEffect(() => {
    clearStoredSignerIdentity();
  }, []);

  useEffect(() => {
    if (!fullName.trim() && defaultName) setFullName(defaultName);
  }, [defaultName, fullName]);

  useEffect(() => {
    if (externalError) setFormError(null);
  }, [externalError]);

  useEffect(() => {
    if (personHasSigningConsent) {
      setAcceptedTerms(true);
      setTermsOpen(false);
    }
  }, [personHasSigningConsent]);

  useEffect(() => {
    if (!requireBiometricConsent) {
      setAcceptedBiometric(false);
      return;
    }
    if (personHasBiometricConsent) {
      setAcceptedBiometric(true);
      setBiometricOpen(false);
    }
  }, [requireBiometricConsent, personHasBiometricConsent]);

  const isNitEmpresa = isCompanyNitDocumentType(idDocumentType);
  const previewLabel = formatSignerIdLabel(idDocumentType, idNumber);
  const needsTermsCheckbox = !personHasSigningConsent;
  const needsBiometricCheckbox = requireBiometricConsent && !personHasBiometricConsent;
  const canSubmit =
    (personHasSigningConsent || acceptedTerms) &&
    (!requireBiometricConsent || personHasBiometricConsent || acceptedBiometric) &&
    !confirming;

  const handleSubmit = async () => {
    if (!personHasSigningConsent && !acceptedTerms) {
      setFormError(SIGNING_LEGAL_CONSENT_REQUIRED_MESSAGE);
      return;
    }
    if (requireBiometricConsent && !personHasBiometricConsent && !acceptedBiometric) {
      setFormError(BIOMETRIC_CONSENT_REQUIRED_MESSAGE);
      return;
    }

    const draft = normalizeSignerIdentity(
      {
        fullName,
        idDocumentType,
        idNumber,
        companyName,
        companySlug: companyName,
        jobTitle,
        acceptedTerms: true,
        acceptedBiometric: requireBiometricConsent ? true : undefined,
      },
      defaultName
    );
    const error = validateSignerIdentity(draft);
    if (error) {
      setFormError(error);
      return;
    }

    setFormError(null);
    onClearExternalError?.();

    try {
      await onConfirm({
        ...draft,
        acceptedTerms: true,
        acceptedBiometric: requireBiometricConsent ? true : undefined,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo confirmar la firma.');
    }
  };

  return (
    <Stack gap='sm'>
      <Text size='sm' c='dimmed'>
        Indique su nombre. Tipo y número de documento son opcionales (igual que en GSS Firma).
        Los datos no se guardan en este navegador.
      </Text>

      <TextInput
        label='Nombre completo'
        placeholder='Como aparece en su documento de identidad'
        value={fullName}
        onChange={(e) => setFullName(e.currentTarget.value)}
        disabled={confirming}
        required
        autoComplete='name'
      />

      <Select
        label='Tipo de documento'
        description='Opcional'
        data={SIGNER_ID_DOCUMENT_OPTIONS.map((o) => ({
          value: o.value,
          label: o.label,
        }))}
        value={idDocumentType}
        onChange={(value) => {
          setIdDocumentType((value as SignerIdDocumentType) || 'CC');
          setIdNumber('');
          setFormError(null);
        }}
        disabled={confirming}
        allowDeselect={false}
        searchable={false}
        nothingFoundMessage='Sin opciones'
        comboboxProps={{ withinPortal: true, zIndex: 500 }}
        maxDropdownHeight={280}
      />

      {isNitEmpresa ? (
        <>
          <TextInput
            label='Empresa'
            description='Opcional'
            placeholder='Nombre de la empresa'
            value={companyName}
            onChange={(e) => setCompanyName(e.currentTarget.value)}
            disabled={confirming}
          />
          <TextInput
            label='Cargo'
            description='Opcional'
            placeholder='Ej. Abogada, Gerente jurídico'
            value={jobTitle}
            onChange={(e) => setJobTitle(e.currentTarget.value)}
            disabled={confirming}
            autoComplete='organization-title'
          />
          <TextInput
            label='Número de documento (NIT)'
            description='Opcional'
            placeholder='Ej. 900.123.456-7'
            value={idNumber}
            onChange={(e) => setIdNumber(e.currentTarget.value)}
            disabled={confirming}
            inputMode='numeric'
          />
        </>
      ) : (
        <TextInput
          label='Número de documento'
          description='Opcional'
          placeholder='Cédula, extranjería o pasaporte'
          value={idNumber}
          onChange={(e) => setIdNumber(e.currentTarget.value)}
          disabled={confirming}
        />
      )}

      {(previewLabel || (isNitEmpresa && (jobTitle || companyName))) && (
        <Text size='xs' c='dimmed'>
          Vista previa bajo la firma:{' '}
          {[
            fullName.trim() || defaultName,
            isNitEmpresa ? jobTitle.trim() : null,
            isNitEmpresa ? companyName.trim() : null,
            previewLabel,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      )}

      {fingerprintSlot}

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
          <Alert color='green' variant='light'>
            <Text size='xs'>
              Ya autorizó el marco de firma electrónica a nivel de su perfil (válido para todos
              los documentos). No es necesario volver a aceptar por cada firma.
            </Text>
          </Alert>
        ) : (
          <Checkbox
            checked={acceptedTerms}
            disabled={confirming}
            label={legal.checkbox}
            onChange={(e) => {
              const checked = e.currentTarget.checked;
              setAcceptedTerms(checked);
              setFormError(null);
              if (checked) onClearExternalError?.();
            }}
          />
        )}
      </Stack>

      {requireBiometricConsent ? (
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
            <Alert color='green' variant='light'>
              <Text size='xs'>
                Ya autorizó el tratamiento de huella a nivel de su perfil. Solo se pedirá de nuevo
                si cambia la normativa.
              </Text>
            </Alert>
          ) : needsBiometricCheckbox ? (
            <Checkbox
              checked={acceptedBiometric}
              disabled={confirming}
              label={BIOMETRIC_CONSENT_COPY.checkbox}
              onChange={(e) => {
                setAcceptedBiometric(e.currentTarget.checked);
                setFormError(null);
              }}
            />
          ) : null}
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
