# Cloudflare Worker Proxy API (WebSocket & Target Caching)

Lightweight proxy service migrated to **Cloudflare Workers**. Forwards incoming requests to upstream game servers via REST or persistent WebSockets, featuring 10-second target server HTTP response caching for high-frequency polling routes (`/api/live-stats` and `/api/top-200`).

## Features

- ⚡ **WebSocket Support**: Angular client can establish a single persistent WebSocket connection using Cloudflare's native `WebSocketPair` API.
- 🚀 **Target Server Response Caching**: 10-second in-memory isolate proxy cache for high-volume routes (`/api/live-stats` and `/api/top-200`) to minimize load on upstream game servers.
- 🛡️ **In-Flight Request Coalescing**: Prevents thundering herds by sharing active target server HTTP fetches across multiple simultaneous HTTP or WebSocket client requests.
- 🎯 **Flexible `bs-host` Specification**: Accepts target IPv4 (`192.168.1.100:8000`) via HTTP/WS query parameters (`?bs-host=...`), HTTP headers (`bs-host: ...`), or WebSocket JSON message frames.
- 🏓 **Ping Endpoint**: `/proxy-ping` health check endpoint returns `200 OK`.
- 🌐 **Comprehensive CORS Support**: Supports `OPTIONS` preflight, sets wildcard CORS headers (`Access-Control-Allow-Origin: *`), and strips upstream CORS collisions.
- ⏱️ **Fast-Fail & Timeout Handling**: Default 10-second timeout (configurable via `bs-timeout` header or WS frame) returns `504 Gateway Timeout`.

---

## Local Development & Deployment

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Locally
```bash
npm run dev
# or
npx wrangler dev
```

### 3. Deploy to Cloudflare Workers
```bash
npm run deploy
# or
npx wrangler deploy
```

---

## WebSocket Usage (Angular Web App)

Browsers cannot set custom HTTP headers like `bs-host` when initiating a WebSocket handshake. You can pass `bs-host` as a URL query parameter or inside individual WS message frames.

### Connecting via WebSocket
```typescript
const proxyWsUrl = 'wss://your-worker.your-subdomain.workers.dev/?bs-host=192.168.1.100:8000';
const socket = new WebSocket(proxyWsUrl);

socket.onopen = () => {
  console.log('Connected to Cloudflare Worker Proxy WebSocket');
};
```

### Standard Request Payload over WebSocket
```json
{
  "id": "req-001",
  "path": "/api/live-stats",
  "method": "GET"
}
```

---

## Direct HTTP Proxy Usage

### 1. Health Check
```bash
curl https://your-worker.your-subdomain.workers.dev/proxy-ping
```

### 2. Forwarding Requests
```bash
curl -H "bs-host: 192.168.1.100:8000" \
     https://your-worker.your-subdomain.workers.dev/api/live-stats
```
