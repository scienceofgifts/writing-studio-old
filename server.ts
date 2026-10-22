/**
 * Science of Gifts Writing Studio - Backend Server
 * Express + Vite Middleware integrating shared universal API Router.
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { handleApiRequest } from './worker';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(express.json({ limit: '50mb' }));

// Delegate all /api/* routes to the universal API Router
app.all('/api/*', async (req, res) => {
  try {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers.host || `localhost:${PORT}`;
    const webReq = new Request(`${protocol}://${host}${req.url}`, {
      method: req.method,
      headers: req.headers as any,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
    });

    const webRes = await handleApiRequest(webReq, { GEMINI_API_KEY: process.env.GEMINI_API_KEY });
    res.status(webRes.status);
    webRes.headers.forEach((v, k) => res.setHeader(k, v));
    res.send(await webRes.text());
  } catch (err: any) {
    console.error('Server error handling API route:', err);
    res.status(500).json({ ok: false, error: err?.message || 'Server error' });
  }
});

// Vite dev server middleware or static serve in production
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Science of Gifts Writing Studio running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
