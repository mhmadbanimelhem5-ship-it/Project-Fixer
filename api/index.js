let cachedApp = null;

async function getApp() {
  if (cachedApp) return cachedApp;
  
  // جرب كل الاحتمالات
  const paths = [
    '../artifacts/api-server/dist/index.mjs',
    '../artifacts/api-server/dist/index.js',
    '../artifacts/api-server/dist/app.mjs',
    '../artifacts/api-server/dist/app.js'
  ];
  
  for (const p of paths) {
    try {
      const mod = await import(p);
      const app = mod.app || mod.default || mod;
      if (app && (app.inject || app.server)) {
        // اذا في ready استخدمه، اذا لا تخطاه
        if (typeof app.ready === 'function') {
          await app.ready();
        }
        cachedApp = app;
        console.log('Loaded app from', p);
        return app;
      }
    } catch (e) {
      console.log('Failed', p, e.message);
    }
  }
  throw new Error('Could not load Fastify app');
}

export default async function handler(req, res) {
  try {
    const app = await getApp();
    const response = await app.inject({
      method: req.method,
      url: req.url,
      headers: req.headers,
      payload: req.body,
    });

    res.statusCode = response.statusCode;
    for (const [k, v] of Object.entries(response.headers)) {
      res.setHeader(k, v);
    }
    return res.end(response.payload);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}