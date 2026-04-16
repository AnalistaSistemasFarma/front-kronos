import toast from 'react-hot-toast';
import * as Sentry from '@sentry/nextjs';
import { PublicClientApplication } from '@azure/msal-browser';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

const msalConfig = {
  auth: {
    clientId: process.env.MICROSOFTCLIENTID,
    authority: `https://login.microsoftonline.com/${process.env.MICROSOFTTENANTID}`,
    redirectUri: process.env.MSCALLBACKURI,
  },
};

export async function getAccessToken() {
  const msalInstance = new PublicClientApplication(msalConfig);
  await msalInstance.initialize();

  if (msalInstance === null) {
    toast.error('Error al iniciar sesión');
    return;
  }

  const accounts = msalInstance.getAllAccounts();
  if (accounts.length === 0) {
    await msalInstance.loginPopup({
      scopes: ['https://graph.microsoft.com/.default'],
    });
  }

  const response = await msalInstance.acquireTokenSilent({
    account: msalInstance.getAllAccounts()[0], // Asegura que hay un account
    scopes: ['https://graph.microsoft.com/.default'],
  });

  return response.accessToken;
}

export function NotifyError(message) {
  toast.error(message);
  const name = localStorage.getItem('name') || '';
  Sentry.captureException(`${message} - Producido por: ${name}`);
}

export const formatNumber = (number) => {
  return new Intl.NumberFormat('es-CO').format(number);
};

export const formatDate = (date) => {
  const parsedDate = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsedDate);
};

export async function sendMessageTeams(recipient, message, contentType = 'text') {
  const accessToken = await getAccessToken();

  const me = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }).then((res) => res.json());

  const myUserId = me.id;

  const user = await fetch(`https://graph.microsoft.com/v1.0/users/${recipient}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }).then((res) => res.json());

  const userId = user.id;

  const chat = await fetch('https://graph.microsoft.com/v1.0/chats', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chatType: 'oneOnOne',
      members: [
        {
          '@odata.type': '#microsoft.graph.aadUserConversationMember',
          roles: ['owner'],
          'user@odata.bind': `https://graph.microsoft.com/v1.0/users/${myUserId}`,
        },
        {
          '@odata.type': '#microsoft.graph.aadUserConversationMember',
          roles: ['owner'],
          'user@odata.bind': `https://graph.microsoft.com/v1.0/users/${userId}`,
        },
      ],
    }),
  }).then((res) => res.json());

  const chatId = chat.id;

  const success = await fetch(`https://graph.microsoft.com/v1.0/chats/${chatId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      body: {
        contentType: contentType,
        content: message,
      },
    }),
  });

  return success.ok ? success : false;
}

export async function exportToExcel(data, fileName) {
  // Crear un nuevo libro de Excel
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Datos');

  // Asignar encabezados basados en las claves del primer objeto en los datos
  const headers = Object.keys(data[0] || {});
  worksheet.columns = headers.map((header) => ({ header, key: header }));

  // Agregar los datos a las filas del archivo Excel
  data.forEach((item) => {
    worksheet.addRow(item);
  });

  // Generar el archivo Excel y descargarlo
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  saveAs(blob, `${fileName}.xlsx`);
  toast.success('Archivo Excel generado con éxito');
}

export const exportToExcelNew = async ({ data, fileName, sheetName }) => {
  // Crear un nuevo libro de Excel
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);

  // Asignar encabezados basados en las claves del primer objeto en los datos
  const headers = Object.keys(data[0] || {});
  worksheet.columns = headers.map((header) => ({ header, key: header }));

  // Agregar los datos a las filas del archivo Excel
  data.forEach((item) => {
    worksheet.addRow(item);
  });

  // Generar el archivo Excel y descargarlo
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  saveAs(blob, `${fileName}.xlsx`);
};

export async function getDepartments() {
  const res = await fetch(`/api/getUsersProcessAuthorizationsPurchases`);
  const data = await res.json();
  return data;
}
