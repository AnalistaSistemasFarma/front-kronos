'use client';

import SgcShell from '../../../../../components/sgc/SgcShell';
import SgcOwnSignature from '../../../../../components/sgc/signature/SgcOwnSignature';

/** «Mi firma» (Sprint 13): cada persona registra SU firma; Aseguramiento de Calidad la valida. */
export default function SgcMyFirmaPage() {
  return (
    <SgcShell section='Mi firma' subtitle='Registre su firma (dibujada o imagen); Aseguramiento de Calidad la valida antes de usarla'>
      {(company) => <SgcOwnSignature idCompany={company.idCompany} />}
    </SgcShell>
  );
}
