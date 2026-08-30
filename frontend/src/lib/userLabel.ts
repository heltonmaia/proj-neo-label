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

/**
 * Can new work be assigned to this user?
 *
 * Only an account with an email can sign in — password login is gone, and
 * Google sign-in matches on the address. The pre-Google records have none,
 * so assigning to them parks the work where nobody can reach it.
 *
 * This gates the *assignment* controls only. Filter dropdowns keep listing
 * everyone on purpose: those records author thousands of existing
 * annotations, and hiding them would make that work unfilterable.
 */
export function isAssignable(u: Pick<User, 'email'>): boolean {
  return !!u.email?.trim();
}

/**
 * Options for an assignment control: assignable users, plus whoever is
 * currently selected even when they are not assignable — otherwise a video
 * already owned by a legacy account would render as blank and the UI would
 * misreport who holds it.
 */
export function assignableOptions<T extends Pick<User, 'id' | 'email'>>(
  users: T[],
  currentId?: number | null,
): T[] {
  return users.filter((u) => isAssignable(u) || u.id === currentId);
}
