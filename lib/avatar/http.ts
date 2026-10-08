import 'server-only';
import { NextResponse } from 'next/server';
import { jsonNoStore } from '../chat/http';
import { composeAvatarSvg, parseAvatarConfig } from './compose';
import { AvatarStoreUnavailableError, type AvatarOwnerType } from './store';

/**
 * Respuesta con el SVG del avatar. Cabeceras pensadas para un SVG servido
 * desde el mismo origen:
 *   - CSP sin scripts: aunque el catálogo no trae ninguno, si alguien abre la
 *     URL directo el navegador no ejecutará nada.
 *   - nosniff: que nadie lo interprete como HTML.
 *   - Caché larga e inmutable: la URL lleva ?v=<fecha del cambio>, así que al
 *     guardar otro avatar cambia la URL y se pide el nuevo.
 */
export function svgResponse(configJson: string, title: string, version: number, owner: AvatarOwnerType): NextResponse {
  const config = parseAvatarConfig(configJson, owner);
  if (!config) return NextResponse.json({ error: 'Avatar inválido.' }, { status: 404 });
  const svg = composeAvatarSvg(config, { title });
  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=31536000, immutable',
      ETag: `"${version}"`,
    },
  });
}

/** 503 claro cuando falta el script de base de datos. */
export function storeUnavailable() {
  return jsonNoStore(
    {
      error:
        'El avatar estilo Notion aún no está habilitado en esta base de datos. Comuníquese con el equipo de Tecnología.',
    },
    { status: 503 }
  );
}

export function isStoreUnavailable(error: unknown): boolean {
  return error instanceof AvatarStoreUnavailableError;
}
