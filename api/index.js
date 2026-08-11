export default async function handler(req, res) {
  const url = req.url || '';
  
  if (url.includes('/health') || url.includes('health')) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).end(JSON.stringify({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      message: 'API is running!',
      path: url
    }));
  }
  
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).end(JSON.stringify({
    status: 'ok',
    message: 'Project Fixer API',
    path: url,
    endpoints: ['/api/health', '/api']
  }));
}