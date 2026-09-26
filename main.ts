// Deno Proxy API with WebSocket & Target Server Caching Support

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

// Regex to validate IPv4 format with optional or required port (e.g. 192.168.1.1:8000 or 192.168.1.1)
const ipv4PortRegex = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/;

// Cache settings for target game server HTTP requests
const CACHE_TTL_MS = 10000; // 10 seconds
const CACHED_ROUTES = new Set([
  "/api/live-stats",
  "/api/top-200",
]);

interface CacheEntry {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyText: string;
  bodyJson?: unknown;
  timestamp: number;
}

interface TargetResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyText: string;
  bodyJson?: unknown;
  cached: boolean;
}

interface WsIncomingMessage {
  action?: "request" | "subscribe" | "unsubscribe";
  id?: string;
  path?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  "bs-host"?: string;
  host?: string;
  timeoutMs?: number;
  intervalMs?: number;
}

// In-memory response cache & in-flight fetch deduplication map
const responseCache = new Map<string, CacheEntry>();
const inflightRequests = new Map<string, Promise<TargetResponse>>();

/**
 * Validates and sanitizes IPv4 host format (e.g., 192.168.1.100:8000 or 192.168.1.100)
 */
function sanitizeAndValidateHost(rawHost: string | null | undefined): string | null {
  if (!rawHost) return null;
  const trimmedHost = rawHost.trim().replace(/^https?:\/\//i, "");
  if (!ipv4PortRegex.test(trimmedHost)) return null;
  return trimmedHost;
}

/**
 * Extracts target host from request headers or query parameters (?bs-host=... or ?host=...)
 */
function extractHostFromReq(req: Request, urlObj: URL): string | null {
  const hostHeader = req.headers.get("bs-host");
  const hostQuery = urlObj.searchParams.get("bs-host") || urlObj.searchParams.get("host");
  return sanitizeAndValidateHost(hostHeader || hostQuery);
}

/**
 * Creates JSON HTTP response with full CORS headers
 */
function createJsonResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

/**
 * Fetches data from target game server with caching & request coalescing for cacheable endpoints
 */
async function getOrFetchTarget(
  host: string,
  path: string,
  method = "GET",
  headers?: Record<string, string> | Headers,
  body?: string | ArrayBuffer,
  timeoutMs = 10000,
): Promise<TargetResponse> {
  const urlObj = new URL(path, `http://${host}`);
  const pathname = urlObj.pathname;
  const fullPath = urlObj.pathname + urlObj.search;
  const upperMethod = method.toUpperCase();
  const isCacheable = upperMethod === "GET" && CACHED_ROUTES.has(pathname);
  const cacheKey = `${host}${fullPath}`;

  if (isCacheable) {
    const cachedEntry = responseCache.get(cacheKey);
    if (cachedEntry && Date.now() - cachedEntry.timestamp < CACHE_TTL_MS) {
      return {
        status: cachedEntry.status,
        statusText: cachedEntry.statusText,
        headers: cachedEntry.headers,
        bodyText: cachedEntry.bodyText,
        bodyJson: cachedEntry.bodyJson,
        cached: true,
      };
    }

    const inflight = inflightRequests.get(cacheKey);
    if (inflight) {
      const result = await inflight;
      return { ...result, cached: true };
    }
  }

  const fetchPromise = (async (): Promise<TargetResponse> => {
    const targetUrl = `http://${host}${fullPath}`;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);

    const forwardHeaders = new Headers(headers || {});
    forwardHeaders.delete("bs-host");
    forwardHeaders.delete("bs-timeout");
    forwardHeaders.delete("host");
    forwardHeaders.delete("connection");

    // Ensure Content-Type header is set when body is present for POST/PUT/PATCH/DELETE
    if (upperMethod !== "GET" && upperMethod !== "HEAD" && body) {
      let hasContentType = false;
      forwardHeaders.forEach((_, key) => {
        if (key.toLowerCase() === "content-type") {
          hasContentType = true;
        }
      });
      if (!hasContentType) {
        forwardHeaders.set("Content-Type", "application/json");
      }
    }

    const response = await fetch(targetUrl, {
      method: upperMethod,
      headers: forwardHeaders,
      body: upperMethod !== "GET" && upperMethod !== "HEAD" ? body : undefined,
      signal: timeoutSignal,
    });

    const resHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      resHeaders[key] = value;
    });

    const bodyText = await response.text();
    let bodyJson: unknown = undefined;
    try {
      bodyJson = JSON.parse(bodyText);
    } catch {
      // Body is not JSON
    }

    const result: TargetResponse = {
      status: response.status,
      statusText: response.statusText,
      headers: resHeaders,
      bodyText,
      bodyJson,
      cached: false,
    };

    if (isCacheable && response.status >= 200 && response.status < 300) {
      responseCache.set(cacheKey, {
        status: result.status,
        statusText: result.statusText,
        headers: result.headers,
        bodyText: result.bodyText,
        bodyJson: result.bodyJson,
        timestamp: Date.now(),
      });
    }

    return result;
  })();

  if (isCacheable) {
    inflightRequests.set(cacheKey, fetchPromise);
    try {
      return await fetchPromise;
    } finally {
      inflightRequests.delete(cacheKey);
    }
  } else {
    return await fetchPromise;
  }
}

/**
 * Handles incoming WebSocket upgrade requests
 */
function handleWebSocketUpgrade(req: Request, urlObj: URL): Response {
  const defaultHost = extractHostFromReq(req, urlObj);
  const { socket, response } = Deno.upgradeWebSocket(req);
  const subscriptions = new Map<string, number>();

  const cleanup = () => {
    for (const timerId of subscriptions.values()) {
      clearInterval(timerId);
    }
    subscriptions.clear();
  };

  socket.addEventListener("open", () => {
    console.log("WebSocket connected. Default target host:", defaultHost || "none");
  });

  socket.addEventListener("close", cleanup);
  socket.addEventListener("error", (err) => {
    console.error("WebSocket connection error:", err);
    cleanup();
  });

  socket.addEventListener("message", async (event: MessageEvent) => {
    if (typeof event.data !== "string") return;

    let msg: WsIncomingMessage;
    try {
      const parsed = JSON.parse(event.data);
      if (typeof parsed === "string") {
        msg = { action: "request", path: parsed };
      } else {
        msg = parsed;
      }
    } catch {
      // Handle plain text path string (e.g. "/api/live-stats")
      msg = { action: "request", path: event.data.trim() };
    }

    const msgId = msg.id;

    if (msg.action === "unsubscribe") {
      if (msgId && subscriptions.has(msgId)) {
        clearInterval(subscriptions.get(msgId));
        subscriptions.delete(msgId);
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ id: msgId, action: "unsubscribed", ok: true }));
        }
      }
      return;
    }

    const targetHost = sanitizeAndValidateHost(msg["bs-host"] || msg.host) || defaultHost;
    if (!targetHost) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          id: msgId,
          ok: false,
          error: "Invalid or missing host",
          message: "Target host must be provided via URL query param (?bs-host=IP:PORT), header, or message payload field",
        }));
      }
      return;
    }

    if (!msg.path) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          id: msgId,
          ok: false,
          error: "Missing path",
          message: "Field 'path' is required (e.g. /api/live-stats)",
        }));
      }
      return;
    }

    if (msg.action === "subscribe") {
      const subId = msgId || msg.path;
      if (subscriptions.has(subId)) {
        clearInterval(subscriptions.get(subId));
      }

      const intervalMs = Math.max(1000, msg.intervalMs || 5000);

      const fetchAndSend = async () => {
        try {
          const res = await getOrFetchTarget(
            targetHost,
            msg.path!,
            "GET",
            msg.headers,
            undefined,
            msg.timeoutMs || 10000,
          );
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
              id: subId,
              event: "subscription_data",
              path: msg.path,
              status: res.status,
              ok: res.status >= 200 && res.status < 300,
              headers: res.headers,
              data: res.bodyJson !== undefined ? res.bodyJson : res.bodyText,
              cached: res.cached,
              timestamp: Date.now(),
            }));
          }
        } catch (err: unknown) {
          const error = err as Error;
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
              id: subId,
              event: "subscription_error",
              path: msg.path,
              status: 502,
              ok: false,
              error: error?.message || "Failed to fetch target data",
            }));
          }
        }
      };

      await fetchAndSend();
      const timer = setInterval(fetchAndSend, intervalMs);
      subscriptions.set(subId, timer);
      return;
    }

    // Default: One-time request/response over WebSocket
    try {
      let bodyPayload: string | undefined = undefined;
      if (msg.body !== undefined && msg.body !== null) {
        bodyPayload = typeof msg.body === "string" ? msg.body : JSON.stringify(msg.body);
      }

      const res = await getOrFetchTarget(
        targetHost,
        msg.path,
        msg.method || "GET",
        msg.headers,
        bodyPayload,
        msg.timeoutMs || 10000,
      );

      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          id: msgId,
          path: msg.path,
          status: res.status,
          ok: res.status >= 200 && res.status < 300,
          headers: res.headers,
          data: res.bodyJson !== undefined ? res.bodyJson : res.bodyText,
          cached: res.cached,
          timestamp: Date.now(),
        }));
      }
    } catch (err: unknown) {
      const error = err as Error;
      const isTimeout = error?.name === "TimeoutError" ||
        error?.message?.toLowerCase().includes("timed out") ||
        error?.message?.toLowerCase().includes("timeout");

      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          id: msgId,
          path: msg.path,
          status: isTimeout ? 504 : 502,
          ok: false,
          error: isTimeout ? "Gateway Timeout" : "Bad Gateway",
          message: error?.message || "Failed to reach target server",
          target: `http://${targetHost}${msg.path}`,
        }));
      }
    }
  });

  return response;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const method = req.method;

  // Handle preflight OPTIONS request
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  const urlObj = new URL(req.url);

  // Check for WebSocket Upgrade request
  if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
    return handleWebSocketUpgrade(req, urlObj);
  }

  const path = urlObj.pathname + urlObj.search;

  // Health check endpoint
  if (path === "/proxy-ping") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  // Extract bs-host header or query parameter
  const targetHost = extractHostFromReq(req, urlObj);
  if (!targetHost) {
    return createJsonResponse(
      {
        error: "Host header not found or invalid",
        message: "Missing or invalid 'bs-host' header/query parameter. Expected IPv4:Port (e.g. 192.168.1.1:8080)",
      },
      400,
    );
  }

  // Timeout configuration (default 10s, configurable via bs-timeout header in ms)
  const customTimeout = Number(req.headers.get("bs-timeout"));
  const timeoutMs = !isNaN(customTimeout) && customTimeout > 0 ? customTimeout : 10000;

  // Check if GET request is cacheable (/api/live-stats or /api/top-200)
  if (method === "GET" && CACHED_ROUTES.has(urlObj.pathname)) {
    try {
      const res = await getOrFetchTarget(
        targetHost,
        path,
        "GET",
        req.headers,
        undefined,
        timeoutMs,
      );

      const newHeaders = new Headers();
      for (const [key, value] of Object.entries(res.headers)) {
        newHeaders.set(key, value);
      }

      // Cleanup upstream CORS headers
      newHeaders.delete("access-control-allow-origin");
      newHeaders.delete("access-control-allow-methods");
      newHeaders.delete("access-control-allow-headers");
      newHeaders.delete("access-control-allow-credentials");
      newHeaders.delete("access-control-expose-headers");

      for (const [key, value] of Object.entries(corsHeaders)) {
        newHeaders.set(key, value);
      }
      newHeaders.set("X-Proxy-Cached", res.cached ? "true" : "false");
      newHeaders.delete("content-length");

      return new Response(res.bodyText, {
        status: res.status,
        statusText: res.statusText,
        headers: newHeaders,
      });
    } catch (err: unknown) {
      const error = err as Error;
      const isTimeout = error?.name === "TimeoutError" ||
        error?.message?.toLowerCase().includes("timed out") ||
        error?.message?.toLowerCase().includes("timeout");

      console.error(`Proxy error forwarding to http://${targetHost}${path}:`, error);

      return createJsonResponse(
        {
          error: isTimeout ? "Gateway Timeout" : "Bad Gateway",
          message: isTimeout
            ? `Target server at ${targetHost} timed out after ${timeoutMs}ms`
            : error?.message || "Failed to reach target server",
          target: `http://${targetHost}${path}`,
        },
        isTimeout ? 504 : 502,
      );
    }
  }

  // Direct HTTP proxy for non-cached requests (streaming safe)
  const targetUrl = `http://${targetHost}${path}`;
  try {
    const body = method !== "GET" && method !== "HEAD" ? await req.arrayBuffer() : undefined;

    const forwardHeaders = new Headers(req.headers);
    forwardHeaders.delete("bs-host");
    forwardHeaders.delete("bs-timeout");
    forwardHeaders.delete("host");
    forwardHeaders.delete("connection");

    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = req.signal ? AbortSignal.any([req.signal, timeoutSignal]) : timeoutSignal;

    const response = await fetch(targetUrl, {
      method: method,
      body: body,
      headers: forwardHeaders,
      signal,
    });

    const newHeaders = new Headers(response.headers);
    newHeaders.delete("access-control-allow-origin");
    newHeaders.delete("access-control-allow-methods");
    newHeaders.delete("access-control-allow-headers");
    newHeaders.delete("access-control-allow-credentials");
    newHeaders.delete("access-control-expose-headers");

    for (const [key, value] of Object.entries(corsHeaders)) {
      newHeaders.set(key, value);
    }
    newHeaders.delete("content-length");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  } catch (err: unknown) {
    const error = err as Error;
    const isTimeout = error?.name === "TimeoutError" ||
      error?.message?.toLowerCase().includes("timed out") ||
      error?.message?.toLowerCase().includes("timeout");

    console.error(`Proxy error forwarding to ${targetUrl}:`, error);

    return createJsonResponse(
      {
        error: isTimeout ? "Gateway Timeout" : "Bad Gateway",
        message: isTimeout
          ? `Target server at ${targetHost} timed out after ${timeoutMs}ms`
          : error?.message || "Failed to reach target server",
        target: targetUrl,
      },
      isTimeout ? 504 : 502,
    );
  }
});
