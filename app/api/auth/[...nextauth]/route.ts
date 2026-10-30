import { PrismaAdapter } from '@next-auth/prisma-adapter';
import bcrypt from 'bcryptjs';
import NextAuth, { AuthOptions, Session, User } from 'next-auth';
import { JWT } from 'next-auth/jwt';
import AzureADProvider from 'next-auth/providers/azure-ad';
import CredentialsProvider from 'next-auth/providers/credentials';
import { prisma } from '../../../../lib/prisma';
import { normalizeNit, SUPPLIER_ROLE } from '../../../../lib/proveedor/isolation';
import { noteLoginAttempt, withLoginAudit } from '../../../../lib/auth/login-audit/recorder';
import { resolveAuthRedirect } from '../../../../lib/auth/safe-redirect';
import { sessionUserCache, type SessionUserRow } from '../../../../lib/auth/sessionUserCache';

const azureConfigured =
  Boolean(process.env.AZURE_AD_CLIENT_ID) &&
  process.env.AZURE_AD_CLIENT_ID !== 'your-client-id' &&
  Boolean(process.env.AZURE_AD_CLIENT_SECRET) &&
  process.env.AZURE_AD_CLIENT_SECRET !== 'your-client-secret' &&
  Boolean(process.env.AZURE_AD_TENANT_ID) &&
  process.env.AZURE_AD_TENANT_ID !== 'your-tenant-id';

/**
 * El callback jwt corre en CADA getServerSession (cada API) y antes consultaba [user] siempre.
 * Se guarda la fila por correo unos segundos: rol, tema y foto siguen al día (máx. 60 s de
 * retraso; inmediato con update() o cuando /api/profile la olvida) y la BD deja de recibir
 * una consulta por llamada.
 */
const SESSION_USER_TTL_MS = 60_000;

async function loadSessionUser(email: string, fresh: boolean): Promise<SessionUserRow | undefined> {
  const key = email.trim().toLowerCase();
  const cached = sessionUserCache.get(key);
  if (!fresh && cached && Date.now() - cached.at < SESSION_USER_TTL_MS) return cached.row;

  const rows = await prisma.$queryRaw<SessionUserRow[]>`
    SELECT TOP 1 id, role, image, themePalette, colorScheme, uiFont, nit
    FROM [user]
    WHERE LOWER(LTRIM(RTRIM(email))) = LOWER(LTRIM(RTRIM(${email})))
  `;
  const row = rows[0];
  sessionUserCache.set(key, { row, at: Date.now() });
  return row;
}

export const authOptions: AuthOptions = {
  adapter: PrismaAdapter(prisma),
  secret: process.env.NEXTAUTH_SECRET,
  debug: process.env.NEXTAUTH_DEBUG === 'true',
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        // Auditoría de inicios de sesión: cada salida anota el resultado (sin la
        // contraseña). La escritura la hace withLoginAudit después de responder.
        if (!credentials?.email || !credentials?.password) {
          noteLoginAttempt({ identifier: credentials?.email ?? null, success: false, reason: 'DATOS_INCOMPLETOS' });
          return null;
        }
        const emailInput = credentials.email.trim();
        // Búsqueda case-insensitive (SQL Server): evita fallos por mayúsculas en el correo.
        const rows = await prisma.$queryRaw<
          Array<{
            id: string;
            name: string | null;
            email: string;
            password: string | null;
            role: string;
            isActive: boolean;
            image: string | null;
          }>
        >`
          SELECT TOP 1 id, name, email, password, role, isActive, image
          FROM [user]
          WHERE LOWER(LTRIM(RTRIM(email))) = LOWER(LTRIM(RTRIM(${emailInput})))
        `;
        const user = rows[0];
        const attempt = { identifier: emailInput, userId: user?.id ?? null, userName: user?.name ?? null };
        if (!user || !user.password) {
          noteLoginAttempt({ ...attempt, success: false, reason: user ? 'SIN_CONTRASENA' : 'USUARIO_NO_EXISTE' });
          return null;
        }
        // AISLAMIENTO: un proveedor NUNCA entra por el login interno (correo),
        // aunque tenga correo registrado. El proveedor solo entra por /proveedor/login.
        if (user.role === SUPPLIER_ROLE) {
          noteLoginAttempt({ ...attempt, success: false, reason: 'PROVEEDOR_EN_LOGIN_INTERNO' });
          return null;
        }
        if (!user.isActive) {
          noteLoginAttempt({ ...attempt, success: false, reason: 'USUARIO_INACTIVO' });
          return null;
        }
        const isPasswordValid = await bcrypt.compare(credentials.password, user.password);
        if (!isPasswordValid) {
          noteLoginAttempt({ ...attempt, success: false, reason: 'CONTRASENA_INCORRECTA' });
          return null;
        }
        noteLoginAttempt({ ...attempt, success: true });
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
    // Provider EXCLUSIVO de proveedores: autentica por NIT + contraseña hasheada.
    // Solo autoriza a usuarios con role = 'supplier'; los internos no pueden entrar
    // por aquí (nunca tienen ese rol). El NIT es el identificador del proveedor.
    CredentialsProvider({
      id: 'supplier-nit',
      name: 'proveedor-nit',
      credentials: {
        nit: { label: 'NIT', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const nit = normalizeNit(credentials?.nit);
        if (!nit || !credentials?.password) {
          noteLoginAttempt({ identifier: nit || credentials?.nit || null, success: false, reason: 'DATOS_INCOMPLETOS' });
          return null;
        }
        // La columna nit tiene índice único filtrado: a lo sumo un proveedor por NIT.
        const user = await prisma.user.findFirst({
          where: { nit, role: SUPPLIER_ROLE, isActive: true },
        });
        const attempt = { identifier: nit, userId: user?.id ?? null, userName: user?.name ?? null };
        if (!user || !user.password) {
          noteLoginAttempt({ ...attempt, success: false, reason: user ? 'SIN_CONTRASENA' : 'NIT_NO_REGISTRADO' });
          return null;
        }
        const isPasswordValid = await bcrypt.compare(credentials.password, user.password);
        if (!isPasswordValid) {
          noteLoginAttempt({ ...attempt, success: false, reason: 'CONTRASENA_INCORRECTA' });
          return null;
        }
        noteLoginAttempt({ ...attempt, success: true });
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
    ...(azureConfigured
      ? [
          AzureADProvider({
            clientId: process.env.AZURE_AD_CLIENT_ID!,
            clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
            tenantId: process.env.AZURE_AD_TENANT_ID!,
          }),
        ]
      : []),
  ],
  session: {
    strategy: 'jwt' as const,
  },
  callbacks: {
    async jwt({ token, user, trigger }: { token: JWT; user?: User; trigger?: string }) {
      const email = (user?.email ?? token.email) as string | undefined;

      if (email) {
        try {
          // Al iniciar sesión o con update() (cambio de perfil/tema) se lee siempre de la BD;
          // en el resto de llamadas (cada getServerSession) se reutiliza la lectura reciente.
          const fresh = Boolean(user) || trigger === 'update';
          const dbUser = await loadSessionUser(email, fresh);
          token.email = email;
          // Id Kronos (cuid), no el sub de Azure/OIDC.
          if (dbUser?.id) {
            token.kronosUserId = dbUser.id;
            token.sub = dbUser.id;
          }
          token.role = dbUser?.role;
          token.nit = dbUser?.nit ?? undefined;
          token.themePalette = dbUser?.themePalette ?? undefined;
          token.uiFont = dbUser?.uiFont ?? undefined;
          token.colorScheme = dbUser?.colorScheme ?? undefined;
          if (dbUser?.image) {
            token.image = dbUser.image;
          } else if (user?.image) {
            token.image = user.image;
          }
        } catch (err) {
          console.error('[nextauth] jwt callback error:', err);
        }
      }

      return token;
    },
    // Solo redirige dentro del mismo sitio (OWASP H-05): rechaza `//`, `/\`, esquemas y otros hosts.
    async redirect({ url, baseUrl }: { url: string; baseUrl: string }) {
      return resolveAuthRedirect(url, baseUrl);
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      if (token && session.user) {
        const kronosId =
          (token.kronosUserId as string | undefined) ||
          (typeof token.sub === 'string' ? token.sub : undefined);
        if (kronosId) session.user.id = kronosId;
        session.user.image = token.image as string;
        session.user.role = token.role as string | undefined;
        session.user.nit = token.nit as string | undefined;
        session.user.themePalette = token.themePalette as string | undefined;
        session.user.uiFont = token.uiFont as string | undefined;
        session.user.colorScheme = token.colorScheme as string | undefined;
      }
      return session;
    },
  },
  events: {
    // Microsoft (Entra ID): el éxito se anota aquí; si Microsoft rechaza o se
    // cancela, NextAuth responde con ?error= y withLoginAudit lo registra como fallo.
    // Para credenciales/NIT ya lo anotó authorize (no se sobrescribe).
    async signIn({ user, account }) {
      if (account?.provider === 'azure-ad') {
        noteLoginAttempt({
          identifier: user?.email ?? null,
          userId: user?.id ?? null,
          userName: user?.name ?? null,
          success: true,
        });
      }
    },
  },
  pages: {
    signIn: '/login',
  },
};

// withLoginAudit: registra cada intento de inicio de sesión (auditoría de seguridad)
// sin frenar ni romper el login. Ver lib/auth/login-audit/recorder.ts.
const handler = withLoginAudit(NextAuth(authOptions));

export { handler as GET, handler as POST };
