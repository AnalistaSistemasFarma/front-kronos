import { describe, expect, it } from 'vitest';
import {
  MY_TICKETS_EMAIL_SEARCH_SQL,
  MY_TICKETS_REQUESTER_EMAIL_SQL,
  MY_TICKETS_SCOPE_PRELUDE_SQL,
} from '../requesterSql';

// Regression guard for the 2026-11-23 timeout of GET /api/help-desk/my-tickets:
// the list must not run per-row scans of [user] again.
describe('my tickets fast scope', () => {
  it('resolves the user identity once into table variables', () => {
    for (const name of ['@my_tickets_me', '@my_tickets_cu', '@my_tickets_suc', '@my_tickets_ids', '@my_tickets_name_email']) {
      expect(MY_TICKETS_SCOPE_PRELUDE_SQL).toContain(`DECLARE ${name} TABLE`);
    }
  });

  it('computes requester_email without a correlated [user] subquery', () => {
    expect(MY_TICKETS_REQUESTER_EMAIL_SQL).not.toContain('[user]');
    expect(MY_TICKETS_EMAIL_SEARCH_SQL).not.toContain('FROM [user]');
  });
});
