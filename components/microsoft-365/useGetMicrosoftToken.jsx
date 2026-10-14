'use server';

import axios from 'axios';

// Datos de la app registrados en Azure
const clientId = `${process.env.MICROSOFTCLIENTID}`;
const clientSecret = `${process.env.MICROSOFTCLIENTSECRET}`;
const tenantId = `${process.env.MICROSOFTTENANTID}`;

// URL del endpoint de token
const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

// El token dura ~1 hora: se reutiliza hasta 5 minutos antes de vencer en vez de pedir uno
// nuevo a Microsoft en cada lectura de OneDrive (cada pedido tardaba cientos de ms).
// Se guarda en globalThis para que sobreviva a las recargas del servidor de desarrollo.
const RENEW_BEFORE_MS = 5 * 60 * 1000;
const cache = (globalThis.__kronosMicrosoftToken ??= { token: null, expiresAt: 0, pending: null });

async function requestToken() {
  const response = await axios.post(
    tokenUrl,
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default', // El scope de la API de Microsoft Graph
      grant_type: 'client_credentials', // Usamos 'client_credentials' para flujo sin intervención de usuario
    })
  );
  const token = response.data.access_token;
  const expiresInSec = Number(response.data.expires_in) || 3600;
  cache.token = token;
  cache.expiresAt = Date.now() + expiresInSec * 1000;
  return token;
}

// Función para obtener el token de acceso
export const useGetMicrosoftToken = async () => {
  if (cache.token && Date.now() < cache.expiresAt - RENEW_BEFORE_MS) return cache.token;
  try {
    // Si llegan varias lecturas a la vez, comparten un solo pedido a Microsoft.
    cache.pending ??= requestToken().finally(() => {
      cache.pending = null;
    });
    return await cache.pending;
  } catch (error) {
    console.error('Error obteniendo el token', error);
    throw error;
  }
};
