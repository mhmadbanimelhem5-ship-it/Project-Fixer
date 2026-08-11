let app = null;

async function getApp() {
  if (app) return app;
  const mod = await import('../artifacts/api-server/dist/index.mjs');
  const fastifyApp = mod.app || mod.default;
  if (fastifyApp.ready) await fastifyApp.ready();
  app = fastifyApp;
  return app;
}

export default async function handler(req, res) {
  try {
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
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
}