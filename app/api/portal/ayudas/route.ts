import { NextRequest, NextResponse } from 'next/server';
import { identificar } from '@/lib/portal/acceso';
import { FormacionStorageNoConfigurado } from '@/lib/portal/formacion-storage';
import { leerConfigAyudas, listarPoliticas } from '@/lib/portal/politicas-storage';
import { mensajeErrorPoliticas } from '../politicas/mensajes';

/**
 * Videos de AYUDA: archivos de la carpeta FORMACION/AYUDAS (SharePoint TalentoHumano), para la ventana del botón
 * «AYUDAS» del portal. Pedido de Cristian, 2026-10-15. Misma lectura y mismas reglas que Políticas y reglamentos.
 *
 *   GET /api/portal/ayudas
 *
 * Exige la misma identidad que el resto del portal. Solo devuelve metadatos y, por archivo, la ruta del endpoint de vista
 * previa: ningún token ni URL de Graph. Solo lectura.
 */
export async function GET(request: NextRequest) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  try {
    const listado = await listarPoliticas({ config: leerConfigAyudas() });
    return NextResponse.json(
      {
        carpeta: listado.carpeta,
        truncado: listado.truncado,
        archivos: listado.archivos.map((a) => ({ ...a, vistaPrevia: `/api/portal/ayudas/${encodeURIComponent(a.id)}/vista` })),
      },
      { headers: { 'Cache-Control': 'private, max-age=60' } }
    );
  } catch (error) {
    if (error instanceof FormacionStorageNoConfigurado) {
      console.error('[portal] Ayudas sin SharePoint configurado:', error.detalle);
    } else {
      console.error('[portal] GET /api/portal/ayudas', error);
    }
    const { status, mensaje } = mensajeErrorPoliticas(error, 'listar', 'de ayudas');
    return NextResponse.json({ error: mensaje }, { status });
  }
}
