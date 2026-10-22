/**
 * Cloudflare Pages Functions Adapter
 * Delegates all /api/* requests to the shared universal API router.
 */

import { handleApiRequest } from '../../src/server/apiRouter';

export const onRequest = async (context: {
  request: Request;
  env: { GEMINI_API_KEY?: string; [key: string]: any };
}): Promise<Response> => {
  return handleApiRequest(context.request, context.env);
};
