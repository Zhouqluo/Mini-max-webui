const http = require('http');
const https = require('https');
const { parse } = require('url');
const crypto = require('crypto');

const PORT = 8787;

// ============================================
// 认证配置
// ============================================

// Master API Key (用于管理SK的密钥)
const MASTER_API_KEY = '';

// SK列表配置 (key: sk密钥, value: {expiresAt: 过期时间戳, name: 名称})
// 生成SK: crypto.randomBytes(32).toString('hex')
// Date.now() + 30 * 24 * 60 * 60 * 1000
const skList = new Map([
  ['4ad4ab5d-537c-4cca-905a-0b72f9ca7854', {
    expiresAt: 1775725644177,
    name: '密钥1'
  }]
]);

// ============================================
// 认证函数
// ============================================

function verifySK(sk) {
  if (!sk) return { valid: false, error: '缺少SK' };

  const skInfo = skList.get(sk);
  if (!skInfo) return { valid: false, error: 'SK无效' };

  if (Date.now() > skInfo.expiresAt) {
    return { valid: false, error: 'SK已过期', expired: true };
  }

  return { valid: true, name: skInfo.name };
}

function verifyMasterKey(key) {
  return key === MASTER_API_KEY;
}

// ============================================
// SK管理API
// ============================================

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-target-url, x-api-key, x-sk, Accept');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = req.url;
  const authHeader = req.headers['authorization'] || '';
  const masterKey = authHeader.replace('Bearer ', '');
  const sk = req.headers['x-sk'];

  handleRequest(req, res, url, masterKey, sk);
});

function handleRequest(req, res, url, masterKey, sk) {
  // SK状态查询接口
  if (url === '/api/sk/status' && req.method === 'GET') {
    const result = verifySK(sk);
    const skInfo = sk ? skList.get(sk) : null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      valid: result.valid,
      error: result.error,
      expired: result.expired || false,
      expiresAt: skInfo ? skInfo.expiresAt : null,
      daysLeft: skInfo ? Math.ceil((skInfo.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)) : null
    }));
    return;
  }

  // 连接检测
  if (url === '/?check=1' || url === '/check') {
    const skStatus = verifySK(sk);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      sk: skStatus
    }));
    return;
  }

  // API代理请求 - 需要验证SK
  console.log(`[DEBUG] Received proxy request: ${req.method} ${url}`);
  console.log(`[DEBUG] x-sk: ${sk}`);
  console.log(`[DEBUG] x-target-url: ${req.headers['x-target-url']}`);

  const targetUrl = req.headers['x-target-url'];
  if (!targetUrl) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing x-target-url header' }));
    return;
  }

  // 验证SK
  const skVerify = verifySK(sk);
  console.log(`[DEBUG] SK verify result:`, skVerify);
  if (!skVerify.valid) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: skVerify.error,
      code: 'SK_INVALID',
      expired: skVerify.expired || false
    }));
    return;
  }

  console.log(`Proxying ${req.method} to: ${targetUrl} (SK: ${skVerify.name})`);

  const parsedUrl = parse(targetUrl);
  const isHttps = parsedUrl.protocol === 'https:';
  const client = isHttps ? https : http;

  const options = {
    method: req.method || 'GET',
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (isHttps ? 443 : 80),
    path: parsedUrl.path,
    headers: {}
  };

  // Copy headers
  Object.keys(req.headers).forEach(key => {
    if (key !== 'host' && key !== 'x-target-url' && key !== 'x-api-key' && key !== 'x-sk') {
      options.headers[key] = req.headers[key];
    }
  });

  // Use Master API Key for MiniMax API authorization
  options.headers['Authorization'] = `Bearer ${MASTER_API_KEY}`;

  options.headers['Host'] = parsedUrl.host;

  const proxyReq = client.request(options, (proxyRes) => {
    console.log(`Response status: ${proxyRes.statusCode}`);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');

    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`Proxy request error: ${err.message}`);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  });

  req.pipe(proxyReq);
}

server.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`Proxy server running at http://localhost:${PORT}`);
  console.log(`Master Key: ${MASTER_API_KEY}`);
  console.log(`Current SKs: ${skList.size}`);
  console.log(`========================================`);
  console.log(`SK Management APIs:`);
  console.log(`  GET  /api/sk/status     - Check SK status`);
  console.log(`========================================`);
});
