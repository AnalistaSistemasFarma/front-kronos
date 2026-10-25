'use client';

import NabucoShell from '../../../../../components/transferencias-nabuco/NabucoShell';
import NabucoModulo from '../../../../../components/transferencias-nabuco/NabucoModulo';

/** Transferencias Nabuco · Administración: abre directo en la configuración. */
export default function TransferenciasNabucoAdminPage() {
  return <NabucoShell requireAdmin>{(company) => <NabucoModulo key={company.idCompany} company={company} inicial='configuracion' />}</NabucoShell>;
}
