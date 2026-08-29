import type { User } from '@/api/auth';

/**
 * How a user is shown in every pick-a-person control.
 *
 * The email is the identity that matters. `username` is only a display name,
 * and when an allowlist entry carries no `name` the backend derives it from
 * the address's local part — which drops the domain, and the domain is often
 * the only thing telling two people apart (`@ufrn.br` vs `@ufrn.edu.br`).
 *
 * Legacy accounts predating Google sign-in have no email at all. Those keep
 * their username, which doubles as a visual cue: no address means no way to
 * sign in.
 *
 * Compact contexts that merely report who owns something (assignee chips,
 * filter badges) deliberately keep the short username — a full address would
 * overflow them.
 */
export function userLabel(u: Pick<User, 'username' | 'email'>): string {
  return u.email?.trim() || u.username;
}
