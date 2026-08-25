# Deno Proxy API

Lightweight Deno API proxy for Deno Deploy, customized to validate and forward requests to IPv4 target hosts specified in the `bs-host` header with full CORS support and timeout handling.

## Features

- 🎯 **IPv4 Validation**: Validates target IP:Port in `bs-host` header against IPv4 pattern (e.g. `192.168.1.1:8000`).
- 🏓 **Ping Endpoint**: `/proxy-ping` health check endpoint returns `200 OK`.
- 🌐 **Comprehensive CORS Support**: Handles `OPTIONS` preflight, sets wildcard CORS headers (`Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: *`, `Access-Control-Expose-Headers: *`), and strips upstream CORS collisions.
- ⏱️ **Fast-Fail & Timeout Handling**: Built-in 10-second timeout (configurable via `bs-timeout` header) prevents hanging connections and returns standard `504 Gateway Timeout` with CORS headers.
- 🛣️ **Path & Query Preservation**: Preserves request paths and query parameters.
- 📦 **Binary & JSON Safe**: Uses `arrayBuffer()` streaming to preserve binary payloads, forms, and JSON without corruption.
- ⚡ **Modern Deno Native Server**: Uses built-in `Deno.serve`.

## Endpoints & Behavior

### 1. `/proxy-ping`
Returns HTTP 200 OK with CORS headers.
```bash
curl https://your-proxy.deno.dev/proxy-ping
```

### 2. Forwarding Requests (`bs-host: IP:PORT`)
Header format required:
```http
bs-host: 192.168.1.100:8000
```

Optional timeout override (in milliseconds):
```http
bs-timeout: 5000
```

#### Example cURL
```bash
curl -H "bs-host: 192.168.1.100:8000" \
     -H "bs-timeout: 10000" \
     -H "Authorization: Bearer mytoken" \
     https://your-proxy.deno.dev/api/data
```
*Forwards request to `http://192.168.1.100:8000/api/data`*

### 3. Error Responses (All with CORS headers & JSON body)
- **Missing `bs-host`**: Returns `400 Bad Request` with message `Missing required 'bs-host' header`.
- **Invalid IPv4 format**: Returns `400 Bad Request` with message `Invalid 'bs-host' format`.
- **Upstream timeout**: Returns `504 Gateway Timeout` when target fails to respond in time.
- **Upstream connection failure**: Returns `502 Bad Gateway` on connection refused / network error.

## Running Locally

```bash
deno task start
# or with auto-reload:
deno task dev
```
