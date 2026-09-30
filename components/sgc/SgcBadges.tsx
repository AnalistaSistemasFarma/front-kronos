'use client';

import { Badge, Group, Text, Tooltip } from '@mantine/core';
import {
  SGC_CONFIDENTIALITY_LABELS,
  SGC_DOCUMENT_STATUS_LABELS,
  isSgcConfidentiality,
  isSgcDocumentStatus,
} from '../../lib/sgc/constants';
import { SGC_REVIEW_STATE_LABELS, getReviewState } from '../../lib/sgc/review';

const STATUS_COLOR: Record<string, string> = { borrador: 'gray', vigente: 'green', obsoleto: 'orange', anulado: 'red' };
const CONF_COLOR: Record<string, string> = { publica: 'blue', departamento: 'violet', confidencial: 'red' };
const REVIEW_COLOR = { al_dia: 'teal', por_vencer: 'yellow', vencido: 'red', sin_fecha: 'gray' } as const;
// El texto del distintivo de Mantine tiene overflow:hidden, así que en una
// tabla angosta se encoge hasta «VIGE…». Con max-content no se recorta nunca.
const FULL = { flexShrink: 0, minWidth: 'max-content' } as const;

export function SgcStatusBadge({ status }: { status: string }) {
  return (
    <Badge color={STATUS_COLOR[status] ?? 'gray'} variant='light' size='sm' style={FULL}>
      {isSgcDocumentStatus(status) ? SGC_DOCUMENT_STATUS_LABELS[status] : status}
    </Badge>
  );
}

export function SgcConfidentialityBadge({ value }: { value: string }) {
  return (
    <Badge color={CONF_COLOR[value] ?? 'gray'} variant='outline' size='sm' style={FULL}>
      {isSgcConfidentiality(value) ? SGC_CONFIDENTIALITY_LABELS[value] : value}
    </Badge>
  );
}

export function SgcReviewBadge({ reviewDueDate, alertMonths }: { reviewDueDate: string | null; alertMonths: number }) {
  const state = getReviewState(reviewDueDate, alertMonths);
  return (
    <Tooltip label={reviewDueDate ? `Próxima revisión: ${reviewDueDate}` : 'Sin fecha de revisión'}>
      <Badge color={REVIEW_COLOR[state]} variant='dot' size='sm' style={FULL}>
        {SGC_REVIEW_STATE_LABELS[state]}
      </Badge>
    </Tooltip>
  );
}

/** «código · V<n>» siempre visibles, como en la referencia (GT-MA-007 V3). */
export function SgcDocumentCode({ code, versionNumber }: { code: string; versionNumber: number | null }) {
  return (
    <Group gap={6} wrap='nowrap'>
      <Text fw={700} ff='monospace' size='sm' data-testid='sgc-codigo'>
        {code}
      </Text>
      <Badge variant='filled' color='dark' size='xs' radius='sm' style={FULL}>
        {versionNumber ? `V${versionNumber}` : 'sin versión'}
      </Badge>
    </Group>
  );
}
