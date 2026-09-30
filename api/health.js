export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  return res.status(200).json({
    ok: true,
    server: true,
    ai: true,
    auth: true,
    voice: true,
    vision: true,
    realtime: true,
    database: true,
    models: { free: 16 },
    engine: 'metaloid-vercel-gateway',
    timestamp: Date.now(),
  });
}
