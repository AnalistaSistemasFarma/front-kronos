'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Group, Select, Stack, Text, TextInput } from '@mantine/core';
import {
  SIGNER_ID_DOCUMENT_OPTIONS,
  formatSignerIdLabel,
  isCompanyNitDocumentType,
  loadStoredSignerIdentity,
  normalizeSignerIdentity,
  storeSignerIdentity,
  validateSignerIdentity,
  type SignerAcceptIdentity,
  type SignerIdDocumentType,
} from '../../lib/orion/signerIdentity';

type Props = {
  defaultName?: string | null;
  currentUserEmail?: string | null;
  confirming?: boolean;
  /** Error del API / padre (visible dentro del modal). */
  externalError?: string | null;
  onCancel: () => void;
  onConfirm: (identity: SignerAcceptIdentity) => void | Promise<void>;
};

export default function SignerIdentityForm({
  defaultName,
  currentUserEmail,
  confirming = false,
  externalError = null,
  onCancel,
  onConfirm,
}: Props) {
  const stored = useMemo(
    () => loadStoredSignerIdentity(currentUserEmail),
    [currentUserEmail]
  );

  const [fullName, setFullName] = useState(
    () => stored?.fullName || defaultName || ''
  );
  const [idDocumentType, setIdDocumentType] = useState<SignerIdDocumentType>(
    () => (stored?.idDocumentType as SignerIdDocumentType) || 'CC'
  );
  const [idNumber, setIdNumber] = useState(() => stored?.idNumber || '');
  const [companyName, setCompanyName] = useState(() => stored?.companyName || '');
  const [jobTitle, setJobTitle] = useState(() => stored?.jobTitle || '');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!fullName.trim() && defaultName) setFullName(defaultName);
  }, [defaultName, fullName]);

  useEffect(() => {
    if (externalError) setFormError(null);
  }, [externalError]);

  const isNitEmpresa = isCompanyNitDocumentType(idDocumentType);

  const previewLabel = formatSignerIdLabel(idDocumentType, idNumber);

  const handleSubmit = async () => {
    const draft = normalizeSignerIdentity(
      {
        fullName,
        idDocumentType,
        idNumber,
        companyName,
        companySlug: companyName,
        jobTitle,
      },
      defaultName
    );
    const error = validateSignerIdentity(draft);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    storeSignerIdentity(currentUserEmail, draft);
    await onConfirm(draft);
  };

  return (
    <Stack gap='sm'>
      <Text size='sm' c='dimmed'>
        Indique su nombre. Tipo y número de documento son opcionales (igual que en GSS Firma).
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

      {(formError || externalError) && (
        <Alert color='red' variant='light'>
          {formError || externalError}
        </Alert>
      )}

      <Group justify='flex-end' mt='xs'>
        <Button variant='default' disabled={confirming} onClick={onCancel}>
          Volver
        </Button>
        <Button color='green' loading={confirming} onClick={() => void handleSubmit()}>
          Confirmar y firmar
        </Button>
      </Group>
    </Stack>
  );
}
