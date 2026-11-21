import { prisma } from '../prisma';
import { ROOMS_ADMIN_URL, ROOMS_BOOK_URL, ROOMS_VIEW_URL, levelFromUrls, type RoomsLevel } from './permissions';

/**
 * User's access level to the Rooms module. Having the subprocess in any of
 * their companies is enough: the rooms belong to the office and are shared by
 * every company of the group.
 */
export async function getRoomsLevel(userEmail: string): Promise<RoomsLevel | null> {
  const rows = await prisma.subprocessUserCompany.findMany({
    where: {
      companyUser: { user: { email: userEmail } },
      subprocess: { subprocess_url: { in: [ROOMS_VIEW_URL, ROOMS_BOOK_URL, ROOMS_ADMIN_URL] } },
    },
    select: { subprocess: { select: { subprocess_url: true } } },
  });
  return levelFromUrls(rows.map((r) => r.subprocess.subprocess_url));
}
