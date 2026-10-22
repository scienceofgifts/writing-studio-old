/**
 * Science of Gifts Writing Studio - Centralized API URL Configuration
 * Forces all API calls to resolve to clean, same-origin relative paths (/api/...) on the same domain.
 */

export const API_BASE_URL = '';

/**
 * Resolves a given API endpoint to a clean, same-origin relative path (/api/...).
 * Strips any trailing or double slashes and removes reliance on external domains.
 */
export function getApiUrl(path: string): string {
  if (!path) return '/api';
  // Strip any protocol and domain if present
  let clean = path.replace(/^https?:\/\/[^/]+/i, '');
  // Replace multiple slashes with a single slash
  clean = clean.replace(/\/+/g, '/');
  // Ensure starts with /
  if (!clean.startsWith('/')) {
    clean = `/${clean}`;
  }
  // Ensure starts with /api
  if (!clean.startsWith('/api/') && clean !== '/api') {
    clean = `/api${clean}`;
  }
  // Strip trailing slash unless it's just /api
  if (clean.length > 4 && clean.endsWith('/')) {
    clean = clean.slice(0, -1);
  }
  return clean;
}
