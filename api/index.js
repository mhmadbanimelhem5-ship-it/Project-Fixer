export default async function handler(req, res) {
  try {
    // جرب نجيب الـ app من كل مكان ممكن
    let app;
    let lastError = null;
    
    const tries = [
      () => import('../artifacts/api-server/dist/index.mjs'),
      () => import('../artifacts/api-server/dist/index.js'),
      () => import('../artifacts/api-server/dist/app.mjs'),
      () => import('../artifacts/api-server/dist/app.js'),
    ];
    
    for (const fn of tries) {
      try {
        const mod = await fn();
        const candidate = mod.app || mod.default || mod;
        if (candidate && candidate.inject) {
          app = candidate;
          if (typeof app.ready === 'function') await app.ready();
          break;
        }
      } catch (e) {
        lastError = e.message + ' | ' + e.stack?.slice(0,200);
      }
    }
    
    // اذا ما لقينا الـ app، شغل سيرفر مؤقت بس عشان ما يعطيك 500
    // وبنفس الوقت بنطبع الايرور الحقيقي
    if (!app) {
      return res.status(200).json({
        status: "debug",
        error: "Could not load Fastify app",
        lastError: lastError,
        hint: "Check build.mjs output folder - dist not found",
        url: req.url
      });
    }

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
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
}