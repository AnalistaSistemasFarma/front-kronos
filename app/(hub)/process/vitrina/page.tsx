'use client';

import VitrinaShell from '../../../../components/vitrina/VitrinaShell';
import VitrinaEnConstruccion from '../../../../components/vitrina/VitrinaEnConstruccion';
import { VITRINA_MODULE_NAME } from '../../../../lib/vitrina/constants';

/** Vitrina Comercial (comerciales). En el V2 solo existe el subproceso: el catálogo llega en el V3. */
export default function VitrinaPage() {
  return (
    <VitrinaShell title={VITRINA_MODULE_NAME} subtitle={(c) => `Portafolio comercial de ${c.companyName.trim()}`}>
      {(company) => <VitrinaEnConstruccion company={company} />}
    </VitrinaShell>
  );
}
