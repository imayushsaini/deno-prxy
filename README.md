# Deno Proxy API (WebSocket & Target Server Caching)

Lightweight Deno API proxy designed for Deno Deploy. Forwards incoming requests to upstream game servers via REST or persistent WebSockets, featuring 10-second target server HTTP response caching for high-frequency polling routes (`/api/live-stats` and `/api/top-200`).

## Features

- ⚡ **WebSocket Support**: Angular client can establish a single persistent WebSocket connection to avoid HTTP overhead during polling.
- 🚀 **Target Server Response Caching**: 10-second in-memory proxy cache for high-volume routes (`/api/live-stats` and `/api/top-200`) to minimize load on upstream game servers.
- 🛡️ **In-Flight Request Coalescing**: Prevents thundering herds by sharing active target server HTTP fetches across multiple simultaneous HTTP or WebSocket client requests.
- 🎯 **Flexible `bs-host` Specification**: Accepts target IPv4 (`192.168.1.100:8000`) via HTTP/WS query parameters (`?bs-host=...`), HTTP headers (`bs-host: ...`), or WebSocket JSON message frames.
- 🏓 **Ping Endpoint**: `/proxy-ping` health check endpoint returns `200 OK`.
- 🌐 **Comprehensive CORS Support**: Supports `OPTIONS` preflight, sets wildcard CORS headers (`Access-Control-Allow-Origin: *`), and strips upstream CORS collisions.
- ⏱️ **Fast-Fail & Timeout Handling**: Default 10-second timeout (configurable via `bs-timeout` header or WS frame) returns `504 Gateway Timeout`.

---

## WebSocket Usage (Angular Web App)

Browsers cannot set custom HTTP headers like `bs-host` when initiating a WebSocket handshake. You can pass `bs-host` as a URL query parameter or inside individual WS message frames.

### 1. Establishing Connection

```typescript
// Angular Service example
const proxyWsUrl = 'wss://your-proxy.deno.dev/?bs-host=192.168.1.100:8000';
const socket = new WebSocket(proxyWsUrl);

socket.onopen = () => {
  console.log('Connected to Deno Proxy WebSocket');
};
```

### 2. Standard Request / Response over WebSocket

Send a request payload over WebSocket:

```json
{
  "id": "req-001",
  "path": "/api/live-stats",
  "method": "GET"
}
```

Proxy response frame received over WebSocket:

```json
{
  "id": "req-001",
  "path": "/api/live-stats",
  "status": 200,
  "ok": true,
  "headers": {
    "content-type": "application/json"
  },
  "data": {
    "onlinePlayers": 1420,
    "activeMatches": 85
  },
  "cached": true,
  "timestamp": 1727351400000
}
```

*Note: You can also send a plain path string e.g. `"/api/live-stats"` over WebSocket for quick GET requests.*

### 3. Subscription / Auto-Polling over WebSocket

Instead of sending periodic GET messages manually, Angular can instruct the proxy to push updates on an interval:

```json
{
  "action": "subscribe",
  "id": "sub-live-stats",
  "path": "/api/live-stats",
  "intervalMs": 2000
}
```

The proxy will execute target server requests (leveraging the 10-second cache) and push update frames:

```json
{
  "id": "sub-live-stats",
  "event": "subscription_data",
  "path": "/api/live-stats",
  "status": 200,
  "ok": true,
  "data": { ... },
  "cached": true,
  "timestamp": 1727351400000
}
```

To stop auto-polling:

```json
{
  "action": "unsubscribe",
  "id": "sub-live-stats"
}
```

---

## Target Server HTTP Caching

To reduce high-volume request load on the upstream game server, the proxy automatically caches 200 OK responses for the following GET routes for **10 seconds**:
- `/api/live-stats`
- `/api/top-200`

- Cache key is scoped per target host and path (`host:pathname?query`).
- Shared by both HTTP and WebSocket proxy clients.
- Includes in-flight request deduplication (request coalescing): concurrent requests during cache expiration execute only a single HTTP fetch to the game server.
- HTTP responses served from cache include the header `X-Proxy-Cached: true`.

---

## Standard HTTP Proxy Usage

### 1. `/proxy-ping` Health Check
```bash
curl https://your-proxy.deno.dev/proxy-ping
```

### 2. Forwarding Requests
Target host can be passed via header or query parameter:

```bash
# Using Header
curl -H "bs-host: 192.168.1.100:8000" \
     https://your-proxy.deno.dev/api/live-stats

# Using Query Parameter
curl "https://your-proxy.deno.dev/api/top-200?bs-host=192.168.1.100:8000"
```

---

## Error Responses

Errors return JSON formatted responses with CORS headers:
- **Missing `bs-host`**: `400 Bad Request`
- **Invalid IPv4 format**: `400 Bad Request`
- **Upstream timeout**: `504 Gateway Timeout`
- **Upstream network error**: `502 Bad Gateway`
