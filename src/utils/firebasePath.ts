export function buildFirebaseUrl(
  databaseUrl: string,
  basePath: string,
  ...segments: string[]
): string {
  const normalizedBase = trimSlashes(basePath);
  const pathSegments = [normalizedBase, ...segments]
    .filter(Boolean)
    .flatMap((segment) => trimSlashes(segment).split('/').filter(Boolean));

  const encodedPath = pathSegments.map(encodeURIComponent).join('/');
  const base = databaseUrl.replace(/\/$/, '');
  const suffix = encodedPath ? `/${encodedPath}.json` : '/.json';

  return `${base}${suffix}`;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}
