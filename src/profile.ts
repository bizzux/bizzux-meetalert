// Static profile shown in the header/Settings — Meetera is single-user
// (Thilak's own device), so this isn't backed by an account system.
export const profile = {
  firstName: 'Thilak',
  fullName: 'Rajthilak',
  initials: 'RT',
  role: 'AVP, Data Security',
};

export function greeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
