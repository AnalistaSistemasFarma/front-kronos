import toast from 'react-hot-toast';
import * as Sentry from '@sentry/nextjs';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

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
