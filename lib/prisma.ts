import 'server-only';
import { PrismaClient } from '../app/generated/prisma';
import dbconfig from '../dbconfig';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaDatabaseUrl: string | undefined;
};

function getDatabaseUrl(): string {
  const build = (dbconfig as { buildDatabaseUrl?: () => string }).buildDatabaseUrl;
  if (typeof build === 'function') {
    return build();
  }
  return process.env.DATABASE_URL ?? '';
}

const databaseUrl = getDatabaseUrl();

if (globalForPrisma.prisma && globalForPrisma.prismaDatabaseUrl !== databaseUrl) {
  void globalForPrisma.prisma.$disconnect().catch(() => undefined);
  globalForPrisma.prisma = undefined;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: { url: databaseUrl },
    },
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaDatabaseUrl = databaseUrl;
}
