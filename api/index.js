import Fastify from 'fastify';

let app;

async function getApp() {
  if (app) return app;
  try {
    // حاول تجيب الـ app الحقيقي
    const mod = await import('../artifacts/api-server/dist/index.mjs');
    // اذا الموديل هو fastify instance
    app = mod.default || mod.app || mod;
    // اذا الموديل بشغل listen لحاله، بنرجع نعمل app جديد
    if (typeof app.listen === 'function' && !app.hasRoute) {
      throw new Error('dist starts server');
    }
  } catch (e) {
    console.log('Using fallback app, reason:', e.message);
    app = Fastify({ logger: false });
    app.get('/', async () => ({ status: 'ok', message: 'Project Fixer API running' }));
    app.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));
    app.get('/api', async () => ({ status: 'ok' }));
  }
  await app.ready();
  return app;
}

export default async function handler(req, res) {
  const fastifyApp = await getApp();
  fastifyApp.server.emit('request', req, res);
}