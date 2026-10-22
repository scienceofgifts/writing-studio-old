/**
 * Cloudflare Worker with Assets Entry Point
 * Routes /api/* requests to universal API router and delegates assets to env.ASSETS.
 */

import { handleApiRequest } from './server/apiRouter';

export interface Env {
  GEMINI_API_KEY?: string;
  ASSETS: {
    fetch: (request: Request | string) => Promise<Response>;
  };
  [key: string]: any;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/') || url.pathname === '/api') {
      return handleApiRequest(request, env);
    }
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }
    return new Response('Assets binding unavailable', { status: 500 });
  },
};
