'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Box, Button, Card, Stack, Text, Title } from '@mantine/core';
import PortalFormacion from '../../../components/portal/PortalFormacion';
import { RequestsHeader, RequestsPage } from '../../../components/request-general/list/RequestListUi';
import {
  RUTA_FORMACION_HUB,
  cursoDesdeParametro,
  origenDesdeParametro,
  urlIngresoYVolverAFormacion,
  urlVolverAlPortal,
} from '../../../lib/portal/formacion-navegacion';

/**
 * PORTAL DE TALENTO HUMANO — FORMACIÓN, en su propia página.
 *
 * Pedido de Cristian Baldión (2026-09-30): Formación ya no va al final del
 * portal; se abre en una pestaña nueva desde el acceso "Formación" del portal
 * principal. Aquí vive todo: lista de cursos, vista del estudiante y vista del
 * formador (el "← Volver a Formación" de un curso sigue funcionando igual,
 * porque es estado interno de `PortalFormacion`).
 *
 * Funciona con las DOS sesiones, igual que el portal: la del código al correo
 * y la de SynerLink — las rutas `/api/portal/*` resuelven quién es (ver
 * `lib/portal/acceso.ts`). Vive fuera de `(hub)` por la misma razón que
 * `/portal`: adentro quedaría detrás del login de SynerLink.
 */
function PaginaFormacion() {
  const parametros = useSearchParams();
  const origen = origenDesdeParametro(parametros.get('desde'));
  // Invitación a un curso (?curso=N): se abre ese curso al ingresar.
  const cursoInicial = cursoDesdeParametro(parametros.get('curso'));
  const volver = urlVolverAlPortal(origen);
  const [sinSesion, setSinSesion] = useState(false);
  const router = useRouter();

  // Enlaces viejos (`?desde=hub`): quien viene del módulo del hub sigue en el
  // hub, con el encabezado de SynerLink (Nicolás, 2026-10-09).
  useEffect(() => {
    if (origen === 'hub') router.replace(RUTA_FORMACION_HUB);
  }, [origen, router]);

  return (
    <RequestsPage>
      <RequestsHeader
        crumbs={[{ title: 'Portal de Talento Humano', href: volver }, { title: 'Formación' }]}
        title='Formación'
        subtitle='Portal de Talento Humano · Group Shared Services Latinoamérica'
      />

      <Box mt='md' data-testid='formacion-cuerpo'>
        {sinSesion ? (
          <Card withBorder radius='md' shadow='sm' padding='lg'>
            <Stack gap='sm' align='flex-start'>
              <Title order={3}>Ingrese primero al portal</Title>
              {cursoInicial ? (
                <Text size='sm'>
                  Lo invitaron a un curso de Formación. Ingrese con su correo (le enviaremos un código) y el curso se abrirá de
                  inmediato.
                </Text>
              ) : (
                <Text size='sm'>
                  Para ver los cursos de Formación, ingrese al Portal de Talento Humano y vuelva a abrir Formación desde allí.
                </Text>
              )}
              {/* Con una invitación, el ingreso lo trae de vuelta a ESTE curso apenas valide el código. */}
              <Button component='a' href={cursoInicial ? urlIngresoYVolverAFormacion(cursoInicial) : volver} data-testid='ingresar-invitacion'>
                {cursoInicial ? 'Ingresar al portal' : 'Ir al portal'}
              </Button>
            </Stack>
          </Card>
        ) : (
          <PortalFormacion onSinSesion={() => setSinSesion(true)} cursoInicialId={cursoInicial} />
        )}
      </Box>
    </RequestsPage>
  );
}

export default function PaginaFormacionConParametros() {
  // `useSearchParams` exige un límite de Suspense en el build de Next 15.
  return (
    <Suspense fallback={null}>
      <PaginaFormacion />
    </Suspense>
  );
}
