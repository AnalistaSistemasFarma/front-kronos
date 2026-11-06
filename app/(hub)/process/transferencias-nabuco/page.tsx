'use client';

import NabucoShell from '../../../../components/transferencias-nabuco/NabucoShell';
import NabucoModulo from '../../../../components/transferencias-nabuco/NabucoModulo';

/** Transferencias Nabuco: tablero de envíos SAP → Nabuco WMS y corridas (lectura). */
export default function TransferenciasNabucoPage() {
  return <NabucoShell>{(company) => <NabucoModulo key={company.idCompany} company={company} />}</NabucoShell>;
}
