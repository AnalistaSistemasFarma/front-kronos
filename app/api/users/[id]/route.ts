import bcrypt from 'bcryptjs';
import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '../../../../app/generated/prisma';
import { authOptions } from '../../auth/[...nextauth]/route';

const prisma = new PrismaClient();

// Helper function to check if user has admin permissions
async function checkAdminPermission(userEmail: string): Promise<boolean> {
  try {
    // Check if user has access to the administration subprocess
    const adminSubprocess = await prisma.subprocessUserCompany.findFirst({
      where: {
        companyUser: {
          user: {
            email: userEmail,
          },
        },
        subprocess: {
          subprocess_url: '/process/administration/users',
        },
      },
    });
    return !!adminSubprocess;
  } catch (error) {
    console.error('Error checking admin permission:', error);
    return false;
  }
}

// PUT /api/users/[id] - Update user
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdmin = await checkAdminPermission(session.user.email);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { id } = await params;
    const { name, email, role, isActive, password } = await request.json();

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { id },
    });

    if (!existingUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Check if email is already taken by another user
    if (email && email !== existingUser.email) {
      const emailExists = await prisma.user.findUnique({
        where: { email },
      });
      if (emailExists) {
        return NextResponse.json({ error: 'Email already in use' }, { status: 400 });
      }
    }

    // Prepare update data
    const updateData: {
      name?: string;
      email?: string;
      role?: string;
      isActive?: boolean;
      password?: string;
    } = {};
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (role !== undefined) updateData.role = role;
    if (isActive !== undefined) updateData.isActive = isActive;

    // Handle password update
    if (password) {
      if (password.length < 8) {
        return NextResponse.json(
          { error: 'Password must be at least 8 characters long' },
          { status: 400 }
        );
      }
      updateData.password = await bcrypt.hash(password, 12);
    }

    // Update user
    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    // Log the action
    const changes = [];
    if (name !== existingUser.name) changes.push(`name: ${existingUser.name} -> ${name}`);
    if (email !== existingUser.email) changes.push(`email: ${existingUser.email} -> ${email}`);
    if (role !== existingUser.role) changes.push(`role: ${existingUser.role} -> ${role}`);
    if (isActive !== existingUser.isActive)
      changes.push(`isActive: ${existingUser.isActive} -> ${isActive}`);
    if (password) changes.push('password updated');

    await prisma.userAuditLog.create({
      data: {
        user_id: user.id,
        action: 'UPDATE',
        performed_by: session.user.email,
        details: changes.length > 0 ? `Updated: ${changes.join(', ')}` : 'No changes detected',
      },
    });

    return NextResponse.json({ user });
  } catch (error) {
    console.error('Error updating user:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/users/[id] - Deactivate user (soft delete)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdmin = await checkAdminPermission(session.user.email);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { id } = await params;

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { id },
    });

    if (!existingUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Soft delete: deactivate user instead of deleting
    const user = await prisma.user.update({
      where: { id },
      data: { isActive: false },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    // Log the action
    await prisma.userAuditLog.create({
      data: {
        user_id: user.id,
        action: 'DEACTIVATE',
        performed_by: session.user.email,
        details: 'User account deactivated',
      },
    });

    return NextResponse.json({ user });
  } catch (error) {
    console.error('Error deactivating user:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
