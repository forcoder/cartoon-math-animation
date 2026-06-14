/**
 * Invite code validation (MVP-grade).
 *
 * Source of truth: `process.env.ALLOWED_INVITE_CODES` (comma-separated).
 * Distribution plan says: 0 budget, 6-week MVP, serving only the founder +
 * 5 friend families. A simple list match is sufficient for that audience.
 *
 * Security note: this is NOT constant-time. Constant-time is overkill at the
 * current scale (single-digit users) and would obscure intent. Add rate
 * limiting + constant-time compare in v2 if we ever open the gate wider.
 *
 * Failure modes are silent: returning `false` is fine here because the caller
 * is the API route, which already maps `false` to a friendly error message.
 */

const ALLOWED_ENV_KEY = "ALLOWED_INVITE_CODES";

/**
 * Returns true iff `code` is present in the allow-list env var.
 *
 * Accepts codes case-sensitively and trims surrounding whitespace on both
 * the input and the env var entries, so deployment-time accidental spaces
 * ("abc, def" vs "abc,def") don't lock out real users.
 *
 * Returns false (rather than throwing) when the env var is missing —
 * the route handler should treat that as "no invites issued" and refuse
 * all requests with a clear configuration error.
 */
export function validateInviteCode(code: string): boolean {
  if (typeof code !== "string" || code.length === 0) {
    return false;
  }

  const raw = process.env[ALLOWED_ENV_KEY];
  if (!raw || typeof raw !== "string") {
    // No allow-list configured → no access. This is intentional fail-closed.
    return false;
  }

  const normalizedInput = code.trim();
  if (normalizedInput.length === 0) {
    return false;
  }

  const allowed = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return allowed.includes(normalizedInput);
}

/**
 * Helper for tests + future "remaining invite count" admin views.
 * Returns the current allow-list size, or 0 if none configured.
 */
export function getAllowedInviteCount(): number {
  const raw = process.env[ALLOWED_ENV_KEY];
  if (!raw) return 0;
  return raw
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.length > 0).length;
}