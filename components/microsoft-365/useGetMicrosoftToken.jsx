"use server";

import axios from "axios";

// Datos de la app registrados en Azure
const clientId = `${process.env.NEXT_PUBLIC_MICROSOFTCLIENTID}`;
const clientSecret = `${process.env.NEXT_PUBLIC_MICROSOFTCLIENTSECRET}`;
const tenantId = `${process.env.NEXT_PUBLIC_MICROSOFTTENANTID}`;

// URL del endpoint de token
const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

console.log(`clientId: ${clientId}`);
console.log(`clientId: ${clientSecret}`);
console.log(`clientId: ${tenantId}`);

// Función para obtener el token de acceso
export const useGetMicrosoftToken = async () => {
  try {
    const response = await axios.post(
      tokenUrl,
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default", // El scope de la API de Microsoft Graph
        grant_type: "client_credentials", // Usamos 'client_credentials' para flujo sin intervención de usuario
      })
    );

    return response.data.access_token;
  } catch (error) {
    console.error("Error obteniendo el token", error);
    throw error;
  }
};
