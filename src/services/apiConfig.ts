/**
 * Science of Gifts Writing Studio - Centralized API URL Configuration
 */

// Uses explicit VITE_GEMINI_API_URL override if supplied; otherwise defaults to relative same-origin paths.
export const API_BASE_URL = import.meta.env.VITE_GEMINI_API_URL || '';

/**
 * Resolves a given API endpoint with the configured base URL.
 * Defaults to relative paths (/api/...) on the same origin.
 */
export function getApiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (API_BASE_URL) {
    const base = API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
    return `${base}${cleanPath}`;
  }
  return cleanPath;
}

