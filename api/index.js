let cachedApp = null;

async function getApp() {
  if (cachedApp) return cachedApp;
  const mod = await import('../artifacts/api-server/dist/index.mjs');
  const app = mod.app || mod.default || mod;
  if (app.ready) await app.ready();
  cachedApp = app;
  return app;
}

export default async function handler(req, res) {
  const app = await getApp();
  // مهم جدا لـ Vercel
  app.server.emit('request', req, res);
}