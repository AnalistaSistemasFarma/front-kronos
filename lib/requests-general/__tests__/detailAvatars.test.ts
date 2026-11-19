import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The request and task detail screens show the profile picture (`user.image`)
// next to every person; these routes must keep returning those columns.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (rel: string) => readFileSync(`${root}${rel}`, 'utf8');

describe('detail routes return user avatars', () => {
  it('view-request returns requester, assignee and executor images', () => {
    const src = read('app/api/requests-general/view-request/route.js');
    expect(src).toMatch(/urq\.image as requester_image/);
    expect(src).toMatch(/assignedUser\.image as assigned_image/);
    expect(src).toMatch(/uex\.image as executor_final_image/);
  });

  it('view-tasks_request-general returns the task assignee image', () => {
    const src = read('app/api/requests-general/view-tasks_request-general/route.js');
    expect(src).toMatch(/u\.image AS assigned_image/);
  });

  it('view-activities returns requester, assignee and executor images', () => {
    const src = read('app/api/requests-general/view-activities/route.js');
    expect(src).toMatch(/urq\.image as requester_image/);
    expect(src).toMatch(/u\.image as assigned_image/);
    expect(src).toMatch(/uex\.image as executor_final_image/);
  });
});
