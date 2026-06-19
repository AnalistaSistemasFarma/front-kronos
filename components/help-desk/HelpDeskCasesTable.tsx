'use client';

import { useRouter } from 'next/navigation';
import { Badge, Group, Table, Text } from '@mantine/core';
import { IconTicket, IconUser } from '@tabler/icons-react';
import type { HelpDeskCaseListItem } from '../../lib/help-desk/types';
import { formatTicketDateIso } from '../../lib/help-desk/dates';
import { getPriorityColor, getPriorityIcon, getStatusColor } from '../../lib/help-desk/ticketDisplay';

interface HelpDeskCasesTableProps {
  tickets: HelpDeskCaseListItem[];
  showRequester?: boolean;
  emptyMessage?: string;
  emptyHint?: string;
}

export function HelpDeskCasesTable({
  tickets,
  showRequester = false,
  emptyMessage = 'No se encontraron casos',
  emptyHint = 'Intenta ajustar los filtros',
}: HelpDeskCasesTableProps) {
  const router = useRouter();

  const openTicket = (ticket: HelpDeskCaseListItem) => {
    sessionStorage.setItem('selectedTicket', JSON.stringify(ticket));
    sessionStorage.setItem('ticketsList', JSON.stringify(tickets));
    router.push(`/process/help-desk/view-ticket?id=${ticket.id_case}`);
  };

  return (
    <div className='overflow-x-auto'>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>ID</Table.Th>
            <Table.Th>Asunto</Table.Th>
            {showRequester && <Table.Th>Solicitante</Table.Th>}
            <Table.Th>Empresa</Table.Th>
            <Table.Th>Prioridad</Table.Th>
            <Table.Th>Estado</Table.Th>
            <Table.Th>Fecha de Creación</Table.Th>
            <Table.Th>Técnico Asignado</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {tickets.length === 0 ? (
            <Table.Tr>
              <Table.Td colSpan={showRequester ? 8 : 7} className='text-center py-12 text-gray-500'>
                <div className='flex flex-col items-center gap-3'>
                  <IconTicket size={48} className='text-gray-300' />
                  <Text size='lg' fw={500}>
                    {emptyMessage}
                  </Text>
                  <Text size='sm'>{emptyHint}</Text>
                </div>
              </Table.Td>
            </Table.Tr>
          ) : (
            tickets.map((ticket) => (
              <Table.Tr
                key={ticket.id_case}
                className='cursor-pointer hover:bg-gray-50 transition-colors'
                onClick={() => openTicket(ticket)}
              >
                <Table.Td>
                  <Badge variant='light' color='blue' size='sm'>
                    #{ticket.id_case}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text fw={500} className='max-w-xs truncate'>
                    {ticket.subject_case}
                  </Text>
                </Table.Td>
                {showRequester && (
                  <Table.Td>
                    <div>
                      <Text size='sm' fw={500} className='max-w-[200px] truncate'>
                        {ticket.requester_name || '—'}
                      </Text>
                      <Text size='xs' c='dimmed' className='max-w-[200px] truncate'>
                        {ticket.requester_email || '—'}
                      </Text>
                    </div>
                  </Table.Td>
                )}
                <Table.Td>
                  <Text size='sm'>{ticket.company}</Text>
                </Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    {getPriorityIcon(ticket.priority)}
                    <Badge color={getPriorityColor(ticket.priority)} variant='light' size='sm'>
                      {ticket.priority}
                    </Badge>
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Badge color={getStatusColor(ticket.status)} variant='light' size='sm'>
                    {ticket.status}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text size='sm'>{formatTicketDateIso(ticket.creation_date)}</Text>
                </Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    <IconUser size={14} className='text-gray-400' />
                    <Text size='sm'>{ticket.nombreTecnico || 'Sin asignar'}</Text>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))
          )}
        </Table.Tbody>
      </Table>
    </div>
  );
}
