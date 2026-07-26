# Deno Proxy API

A lightweight Deno API proxy designed for Deno Deploy that forwards incoming HTTP requests to target IP addresses or hostnames specified in the `bs-host` request header.

## Features

- 🔀 **Dynamic Forwarding**: Reads target IP / host from the `bs-host` request header.
- 🛣️ **Path & Query Preservation**: Appends the original request path and query parameters to the target host.
- 📡 **Full HTTP Method Support**: Handles `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `OPTIONS`, `HEAD`.
- 🔄 **Streaming Support**: Body streams are forwarded for non-GET/HEAD methods.
- 🌐 **CORS Preflight**: Returns standard CORS headers to allow cross-origin requests.
- 🛡️ **Error Handling**: Graceful 400 Bad Request (missing header) and 502 Bad Gateway (upstream connection failures).

## Header Requirement

Every request to the proxy must include the `bs-host` header:

```http
bs-host: <target-ip-or-domain>[:port]
```

### Examples

- `bs-host: 192.168.1.100:8000`
- `bs-host: 10.0.0.5`
- `bs-host: https://api.example.com`

*Note: If no protocol scheme (`http://` or `https://`) is provided, `http://` is assumed by default.*

## Usage Examples

### GET Request
```bash
curl -H "bs-host: 192.168.1.100:8000" https://your-deno-proxy.deno.dev/api/v1/status
```
*Forwards to: `http://192.168.1.100:8000/api/v1/status`*

### POST Request with JSON Body
```bash
curl -X POST \
  -H "bs-host: 192.168.1.100:8000" \
  -H "Content-Type: application/json" \
  -d '{"player": "Alex", "score": 100}' \
  https://your-deno-proxy.deno.dev/game/submit
```
*Forwards POST request and body to: `http://192.168.1.100:8000/game/submit`*

## Running Locally

```bash
deno task start
# or with auto-reload:
deno task dev
```

## Deployment on Deno Deploy

1. Connect your repository to [Deno Deploy](https://dash.deno.com).
2. Set the entry point file to `main.ts`.
3. Deploy!
