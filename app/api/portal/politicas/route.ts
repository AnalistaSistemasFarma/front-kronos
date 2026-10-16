import { NextRequest, NextResponse } from 'next/server';
import { identificar } from '@/lib/portal/acceso';
import { FormacionStorageNoConfigurado } from '@/lib/portal/formacion-storage';
import { listarPoliticas } from '@/lib/portal/politicas-storage';
import { mensajeErrorPoliticas } from './mensajes';

/**
 * Archivos de la carpeta POLITICAS Y REGLAMENTOS (SharePoint TalentoHumano),
 * para la ventana "VISUALIZAR" del portal. Pedido de Cristian, 2026-10-08.
 *
 *   GET /api/portal/politicas
 *
 * Exige la misma identidad que el resto del portal (sesión de SynerLink con
 * el módulo, o el código del portal abierto). Solo devuelve metadatos y, por
 * archivo, la ruta del endpoint de vista previa: ningún token ni URL de Graph.
 * Caché corta en el servidor (2 min) y privada en el navegador (1 min).
 */
export async function GET(request: NextRequest) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  try {
    const listado = await listarPoliticas();
    return NextResponse.json(
      {
        carpeta: listado.carpeta,
        truncado: listado.truncado,
        archivos: listado.archivos.map((a) => ({
          ...a,
          vistaPrevia: `/api/portal/politicas/${encodeURIComponent(a.id)}/vista`,
        })),
      },
      { headers: { 'Cache-Control': 'private, max-age=60' } }
    );
  } catch (error) {
    if (error instanceof FormacionStorageNoConfigurado) {
      console.error('[portal] Políticas sin SharePoint configurado:', error.detalle);
    } else {
      console.error('[portal] GET /api/portal/politicas', error);
    }
    const { status, mensaje } = mensajeErrorPoliticas(error, 'listar');
    return NextResponse.json({ error: mensaje }, { status });
  }
}
