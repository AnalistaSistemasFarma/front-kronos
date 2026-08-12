import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma';
import { isValidPaletteKey } from '../../../lib/theme/palettes';
import { authOptions } from '../auth/[...nextauth]/route';

// GET /api/profile - Get current user profile
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        createdAt: true,
        themePalette: true,
        colorScheme: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error('Error fetching profile:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT /api/profile - Update user profile
export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const name = formData.get('name') as string;
    const email = formData.get('email') as string;
    const imageUrl = formData.get('image') as string;
    const themePaletteRaw = formData.get('themePalette');
    const colorSchemeRaw = formData.get('colorScheme');

    // Validate appearance fields against the allowed catalog
    if (themePaletteRaw !== null && !isValidPaletteKey(themePaletteRaw)) {
      return NextResponse.json({ error: 'Invalid theme palette' }, { status: 400 });
    }
    if (
      colorSchemeRaw !== null &&
      colorSchemeRaw !== 'light' &&
      colorSchemeRaw !== 'dark'
    ) {
      return NextResponse.json({ error: 'Invalid color scheme' }, { status: 400 });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (email && !emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    // Check if email is already taken by another user
    if (email && email !== session.user.email) {
      const existingUser = await prisma.user.findUnique({
        where: { email },
      });
      if (existingUser) {
        return NextResponse.json({ error: 'Email already in use' }, { status: 400 });
      }
    }

    // Get current user
    const currentUser = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!currentUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Validate image URL format
    if (imageUrl) {
      try {
        new URL(imageUrl);
      } catch {
        return NextResponse.json({ error: 'Invalid image URL format' }, { status: 400 });
      }
    }

    // Prepare update data
    const updateData: {
      name?: string;
      email?: string;
      image?: string;
      themePalette?: string;
      colorScheme?: string;
    } = {};
    if (formData.has('name')) updateData.name = name;
    if (formData.has('email')) updateData.email = email;
    if (formData.has('image')) updateData.image = imageUrl;
    if (themePaletteRaw !== null) updateData.themePalette = themePaletteRaw as string;
    if (colorSchemeRaw !== null) updateData.colorScheme = colorSchemeRaw as string;

    // Update user
    const user = await prisma.user.update({
      where: { email: session.user.email },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        createdAt: true,
        themePalette: true,
        colorScheme: true,
      },
    });

    // Log the action
    const changes = [];
    if (formData.has('name') && name !== currentUser.name)
      changes.push(`name: ${currentUser.name} -> ${name}`);
    if (formData.has('email') && email !== currentUser.email)
      changes.push(`email: ${currentUser.email} -> ${email}`);
    if (formData.has('image') && imageUrl !== currentUser.image)
      changes.push(`image: ${currentUser.image} -> ${imageUrl}`);
    if (themePaletteRaw !== null && themePaletteRaw !== currentUser.themePalette)
      changes.push(`themePalette: ${currentUser.themePalette} -> ${themePaletteRaw}`);
    if (colorSchemeRaw !== null && colorSchemeRaw !== currentUser.colorScheme)
      changes.push(`colorScheme: ${currentUser.colorScheme} -> ${colorSchemeRaw}`);

    await prisma.userAuditLog.create({
      data: {
        user_id: user.id,
        action: 'PROFILE_UPDATE',
        performed_by: session.user.email,
        details: changes.length > 0 ? `Updated: ${changes.join(', ')}` : 'No changes detected',
      },
    });

    return NextResponse.json({ user });
  } catch (error) {
    console.error('Error updating profile:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
