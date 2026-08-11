export default async function handler(req, res) {
  try {
    const mod = await import('../artifacts/api-server/dist/index.mjs');
    return res.status(200).json({
      keys: Object.keys(mod),
      hasDefault: !!mod.default,
      defaultKeys: mod.default ? Object.keys(mod.default) : null
    });
  } catch (e) {
    return res.status(500).json({ error: e.message, stack: e.stack });
  }
}