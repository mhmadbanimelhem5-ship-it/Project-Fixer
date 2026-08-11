let app = null;

async function getApp() {
  if (app) return app;
  try {
    const mod = await import('../artifacts/api-server/dist/index.js');
    app = mod.app || mod.default || mod;
    if (app.ready) await app.ready();
    return app;
  } catch (e) {
    console.log('Failed to load real app, using fallback', e.message);
    const Fastify = (await import('fastify')).default;
    const fastify = Fastify({ logger: false });
    fastify.get('/', async () => ({ status: 'ok', fallback: true, error: e.message }));
    fastify.get('/api/health', async () => ({ status: 'ok', fallback: true }));
    await fastify.ready();
    app = fastify;
    return app;
  }
}

export default async function handler(req, res) {
  const fApp = await getApp();
  const response = await fApp.inject({
    method: req.method,
    url: req.url,
    headers: req.headers,
    payload: req.body,
  });
  res.statusCode = response.statusCode;
  for (const [k, v] of Object.entries(response.headers)) res.setHeader(k, v);
  res.end(response.payload);
}