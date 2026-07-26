# Deno Proxy API

Lightweight Deno API proxy for Deno Deploy, customized to validate and forward requests to IPv4 target hosts specified in the `bs-host` header.

## Features

- 🎯 **IPv4 Validation**: Validates target IP:Port in `bs-host` header against IPv4 pattern.
- 🏓 **Ping Endpoint**: `/proxy-ping` health check endpoint returns 200 OK.
- 🌐 **CORS Configuration**: Handles OPTIONS preflight and sets CORS headers (`Access-Control-Allow-Headers: Content-Type, Authorization, bs-host, secret-key`).
- 🛣️ **Path & Query Preservation**: Preserves request paths and query parameters.
- ⚡ **Modern Deno Native Server**: Uses built-in `Deno.serve` (no external `std/http` dependency needed).

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

#### Example cURL
```bash
curl -H "bs-host: 192.168.1.100:8000" \
     -H "secret-key: mysecret" \
     https://your-proxy.deno.dev/api/data
```
*Forwards request to `http://192.168.1.100:8000/api/data`*

### 3. Error Responses
- **Missing `bs-host`**: Returns `400 Bad Request` with message `"Host header not found"`.
- **Invalid IPv4 format**: Returns `400 Bad Request` with message `"Invalid IP:Port format"`.
- **Upstream connection failure**: Returns `502 Bad Gateway` with proxy error message.

## Running Locally

```bash
deno task start
# or with auto-reload:
deno task dev
```
