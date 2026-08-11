export default async function handler(req, res) {
  try {
    // بنجرب نجيب الـ app من الـ dist
    let app;
    try {
      const mod = await import('../artifacts/api-server/dist/app.mjs');
      app = mod.default || mod.app || mod;
    } catch (e) {
      const mod = await import('../artifacts/api-server/dist/index.mjs');
      app = mod.default || mod.app || mod;
    }
    
    await app.ready();
    app.server.emit('request', req, res);
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.end('Server error: ' + err.message);
  }
}