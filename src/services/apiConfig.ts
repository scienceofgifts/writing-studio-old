/**
 * Science of Gifts Writing Studio - Centralized API URL Configuration
 */

// Targets the Cloudflare API Worker in production, falls back to local host during development.
export const API_BASE_URL = import.meta.env.VITE_GEMINI_API_URL || '';

/**
 * Resolves a given API endpoint with the configured base URL.
 */
export function getApiUrl(path: string): string {
  if (API_BASE_URL) {
    const base = API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${base}${cleanPath}`;
  }
  return path;
}
