export function normalizeFirebaseDatabaseUrl(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return '';
  }

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase();
    const isFirebaseHost = host.endsWith('.firebaseio.com') || host.endsWith('.firebasedatabase.app');

    if (url.protocol !== 'https:' || !isFirebaseHost) {
      return '';
    }

    return `${url.origin}/`;
  } catch {
    return '';
  }
}
