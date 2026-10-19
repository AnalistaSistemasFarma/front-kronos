'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@mantine/core';
import { IconTopologyStar3 } from '@tabler/icons-react';
import SgcShell from '../../../../../components/sgc/SgcShell';
import SgcDocumentTree from '../../../../../components/sgc/relations/SgcDocumentTree';
import { sgcHref } from '../../../../../components/sgc/useSgcCompany';
import { SGC_BASE_URL } from '../../../../../lib/sgc/constants';

/**
 * ÁRBOL DOCUMENTAL (documentos padre e hijos, 2026-10-19): el procedimiento y
 * todo lo que se desprende de él, para el auditor. ?documento=<id> abre la
 * rama de ese documento.
 */
export default function SgcArbolPage() {
  const [focus] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    const v = new URLSearchParams(window.location.search).get('documento');
    return v && /^\d+$/.test(v) ? Number(v) : null;
  });
  return (
    <SgcShell
      section='Árbol documental'
      subtitle='Cada procedimiento y lo que se desprende de él: formatos, instructivos y anexos, con su estado y versión vigente.'
      actions={(company) => (
        <Button component={Link} href={sgcHref(`${SGC_BASE_URL}/relaciones`, company.idCompany)} variant='light' leftSection={<IconTopologyStar3 size={16} />}>
          Mapa de relaciones
        </Button>
      )}
    >
      {(company) => <SgcDocumentTree company={company} focusDocument={focus} />}
    </SgcShell>
  );
}
