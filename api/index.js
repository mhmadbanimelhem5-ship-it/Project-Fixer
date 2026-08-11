export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(200).json({
    status: 'ok',
    message: 'API is running!',
    url: req.url,
    timestamp: new Date().toISOString()
  });
}