/**
 * Science of Gifts Writing Studio - Centralized API URL Configuration
 * Forces all API calls to resolve to relative same-origin paths (/api/...) on the same domain.
 */

export const API_BASE_URL = '';

/**
 * Resolves a given API endpoint to a relative same-origin path (/api/...).
 */
export function getApiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (!cleanPath.startsWith('/api/') && !cleanPath.startsWith('/api')) {
    return `/api${cleanPath}`;
  }
  return cleanPath;
}


