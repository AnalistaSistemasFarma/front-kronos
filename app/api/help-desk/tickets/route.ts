import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { PrismaClient } from '../../../generated/prisma';

// Mock data for tickets
const mockTickets = [
  {
    id_case: 1,
    subject: 'Problema con impresora',
    priority: 'High',
    status: 'Open',
    created_at: '2024-10-15T10:00:00Z',
    assigned_user: 'Juan Pérez',
    subprocess_id: 1,
  },
  {
    id_case: 2,
    subject: 'Error en sistema de facturación',
    priority: 'Critical',
    status: 'In Progress',
    created_at: '2024-10-14T15:30:00Z',
    assigned_user: 'María García',
    subprocess_id: 1,
  },
  {
    id_case: 3,
    subject: 'Solicitud de capacitación',
    priority: 'Low',
    status: 'Closed',
    created_at: '2024-10-13T09:15:00Z',
    assigned_user: 'Carlos López',
    subprocess_id: 1,
  },
  {
    id_case: 4,
    subject: 'Problema de conexión a internet',
    priority: 'Medium',
    status: 'Open',
    created_at: '2024-10-12T14:20:00Z',
    assigned_user: 'Ana Rodríguez',
    subprocess_id: 1,
  },
  {
    id_case: 5,
    subject: 'Actualización de software',
    priority: 'Medium',
    status: 'In Progress',
    created_at: '2024-10-11T11:45:00Z',
    assigned_user: 'Pedro Martínez',
    subprocess_id: 1,
  },
];

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const subprocessId = searchParams.get('subprocess_id');
    const priority = searchParams.get('priority');
    const status = searchParams.get('status');
    const assignedUser = searchParams.get('assigned_user');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');

    let filteredTickets = mockTickets;

    // Filter by subprocess_id if provided
    if (subprocessId) {
      filteredTickets = filteredTickets.filter(ticket => ticket.subprocess_id === parseInt(subprocessId));
    }

    // Apply filters
    if (priority) {
      filteredTickets = filteredTickets.filter(ticket => ticket.priority === priority);
    }

    if (status) {
      filteredTickets = filteredTickets.filter(ticket => ticket.status === status);
    }

    if (assignedUser) {
      filteredTickets = filteredTickets.filter(ticket =>
        ticket.assigned_user.toLowerCase().includes(assignedUser.toLowerCase())
      );
    }

    if (dateFrom) {
      filteredTickets = filteredTickets.filter(ticket =>
        new Date(ticket.created_at) >= new Date(dateFrom)
      );
    }

    if (dateTo) {
      filteredTickets = filteredTickets.filter(ticket =>
        new Date(ticket.created_at) <= new Date(dateTo)
      );
    }

    return NextResponse.json(filteredTickets);
  } catch (error) {
    console.error('Error fetching tickets:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { subject, description, priority, department, place, subprocess_id } = body;

    // Validate required fields
    if (!subject || !description || !priority || !department) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const prisma = new PrismaClient();

    try {
      // Find or create department
      let departmentRecord = await prisma.department.findFirst({
        where: { department: department }
      });

      if (!departmentRecord) {
        departmentRecord = await prisma.department.create({
          data: { department }
        });
      }

      // Find status "Open"
      const statusRecord = await prisma.statusCase.findFirst({
        where: { status: 'Open' }
      });

      if (!statusRecord) {
        return NextResponse.json({ error: 'Status "Open" not found' }, { status: 500 });
      }

      // Create the case
      const newCase = await prisma.case.create({
        data: {
          description,
          id_status_case: statusRecord.id_status_case,
          subject_case: subject,
          creation_date: new Date(),
          id_technical: session.user?.email || '',
          requester: session.user?.name || '',
          id_active: 1, // Default active, adjust as needed
          place: place || '',
          id_department: departmentRecord.id_department,
          case_type: 'Help Desk',
          priority,
        },
        include: {
          statusCase: true,
          department: true,
          active: true,
        }
      });

      // Transform to match the expected response format
      const newTicket = {
        id_case: newCase.id_case,
        subject: newCase.subject_case,
        priority: newCase.priority,
        status: newCase.statusCase.status,
        created_at: newCase.creation_date.toISOString(),
        assigned_user: session.user?.name || 'Unassigned',
        subprocess_id: subprocess_id || 1,
        description: newCase.description,
        department: newCase.department.department,
        place: newCase.place,
      };

      return NextResponse.json(newTicket, { status: 201 });
    } finally {
      await prisma.$disconnect();
    }
  } catch (error) {
    console.error('Error creating ticket:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}