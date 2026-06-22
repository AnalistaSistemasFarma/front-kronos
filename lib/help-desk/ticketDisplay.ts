import { IconFlag } from '@tabler/icons-react';
import { createElement } from 'react';

export function getPriorityColor(priority: string) {
  switch (priority?.toLowerCase()) {
    case 'alta':
      return 'red';
    case 'media':
      return 'yellow';
    case 'baja':
      return 'green';
    default:
      return 'gray';
  }
}

export function getStatusColor(status: string) {
  switch (status?.toLowerCase()) {
    case 'abierto':
      return 'green';
    case 'cancelado':
      return 'gray';
    case 'resuelto':
      return 'blue';
    default:
      return 'gray';
  }
}

export function getPriorityIcon(priority: string) {
  switch (priority?.toLowerCase()) {
    case 'alta':
      return createElement(IconFlag, { size: 14, color: 'red' });
    case 'media':
      return createElement(IconFlag, { size: 14, color: 'yellow' });
    case 'baja':
      return createElement(IconFlag, { size: 14, color: 'green' });
    default:
      return createElement(IconFlag, { size: 14 });
  }
}
