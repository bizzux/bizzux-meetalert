import { useAuthStore } from './store/authStore';

/**
 * Derived from whichever Firebase account is signed in (see
 * src/store/authStore.ts) — Meetera moved from a single hardcoded profile
 * to real accounts, so this is a hook now instead of a plain object.
 * `role` shows the identity the account signed in with (email or phone)
 * since there's no separate job-title field to show.
 */
export function useProfile() {
  const user = useAuthStore((s) => s.user);

  const displayName = user?.displayName?.trim() || emailLocalPart(user?.email) || user?.phoneNumber || 'there';
  const firstName = displayName.split(/\s+/)[0];

  return {
    firstName,
    fullName: displayName,
    initials: initialsFromName(displayName),
    role: user?.email ?? user?.phoneNumber ?? '',
  };
}

function emailLocalPart(email?: string | null): string | null {
  if (!email) return null;
  return email.split('@')[0];
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function greeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
