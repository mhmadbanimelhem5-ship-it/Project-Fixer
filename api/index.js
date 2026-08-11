let cachedApp = null;
async function getApp() {
  if (cachedApp) return cachedApp;
  const mod = await import('../artifacts/api-server/dist/index.mjs');
  const app = mod.app || mod.default || mod;
  await app.ready();
  cachedApp = app;
  return app;
}
export default async function handler(req, res) {
  const app = await getApp();
  const response = await app.inject({
    method: req.method,
    url: req.url,
    headers: req.headers,
    payload: req.body,
  });
  res.statusCode = response.statusCode;
  for (const [k,v] of Object.entries(response.headers)) res.setHeader(k,v);
  res.end(response.payload);
}