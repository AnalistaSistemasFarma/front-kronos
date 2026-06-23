import bcrypt from 'bcryptjs';
import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '../../../../app/generated/prisma';
import { authOptions } from '../../auth/[...nextauth]/route';

const prisma = new PrismaClient();

// Simple in-memory rate limiter
const rateLimitMap = new Map<string, { attempts: number; resetTime: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(email: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(email);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(email, { attempts: 1, resetTime: now + WINDOW_MS });
    return true;
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    return false;
  }

  record.attempts++;
  return true;
}

// Password strength validation
function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) {
    return 'Password must be at least 8 characters long';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must contain at least one uppercase letter';
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must contain at least one lowercase letter';
  }
  if (!/\d/.test(password)) {
    return 'Password must contain at least one number';
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return 'Password must contain at least one special character';
  }
  return null;
}

// POST /api/profile/change-password - Change user password
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { currentPassword, newPassword, confirmPassword } = await request.json();

    if (!currentPassword || !newPassword || !confirmPassword) {
      return NextResponse.json(
        { error: 'Current password, new password, and confirmation are required' },
        { status: 400 }
      );
    }

    if (newPassword !== confirmPassword) {
      return NextResponse.json(
        { error: 'New password and confirmation do not match' },
        { status: 400 }
      );
    }

    // Validate new password strength
    const strengthError = validatePasswordStrength(newPassword);
    if (strengthError) {
      return NextResponse.json({ error: strengthError }, { status: 400 });
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user || !user.password) {
      return NextResponse.json({ error: 'User not found or no password set' }, { status: 404 });
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
    }

    // Hash new password
    const hashedNewPassword = await bcrypt.hash(newPassword, 12);

    // Update password
    await prisma.user.update({
      where: { email: session.user.email },
      data: { password: hashedNewPassword },
    });

    // Log the action
    await prisma.userAuditLog.create({
      data: {
        user_id: user.id,
        action: 'PASSWORD_CHANGE',
        performed_by: session.user.email,
        details: 'Password changed successfully',
      },
    });

    return NextResponse.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Error changing password:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
