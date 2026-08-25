// Deno Proxy API
// Customized based on your exact proxy handler specifications

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

// Regex to validate IPv4 format with optional or required port (e.g. 192.168.1.1:8000 or 192.168.1.1)
const ipv4PortRegex = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/;

function createJsonResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  const method = req.method;

  // Handle preflight request
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // Robust path & query string extraction (works locally and on .dev domains)
  const urlObj = new URL(req.url);
  const path = urlObj.pathname + urlObj.search;

  // Health check endpoint
  if (path === "/proxy-ping") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  // Extract bs-host header
  const hostHeader = req.headers.get("bs-host");
  if (!hostHeader) {
    return createJsonResponse(
      { error: "Host header not found", message: "Missing required 'bs-host' header" },
      400,
    );
  }

  // Sanitize: strip http:// or https:// if provided in bs-host
  const trimmedHost = hostHeader.trim().replace(/^https?:\/\//i, "");

  // Validate the host header for IPv4 and port
  if (!ipv4PortRegex.test(trimmedHost)) {
    return createJsonResponse(
      {
        error: "Invalid IP:Port format",
        message: "Invalid 'bs-host' format. Expected IPv4:Port (e.g. 192.168.1.1:8080)",
      },
      400,
    );
  }

  const targetUrl = `http://${trimmedHost}${path}`;

  // Timeout configuration (default 10s, configurable via bs-timeout header in ms)
  const customTimeout = Number(req.headers.get("bs-timeout"));
  const timeoutMs = !isNaN(customTimeout) && customTimeout > 0 ? customTimeout : 10000;

  try {
    const body = method !== "GET" && method !== "HEAD" ? await req.arrayBuffer() : undefined;

    const forwardHeaders = new Headers(req.headers);
    // Remove host / bs-host to avoid header conflicts with upstream server
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
    // Remove upstream CORS headers to avoid collisions or duplicate values
    newHeaders.delete("access-control-allow-origin");
    newHeaders.delete("access-control-allow-methods");
    newHeaders.delete("access-control-allow-headers");
    newHeaders.delete("access-control-allow-credentials");
    newHeaders.delete("access-control-expose-headers");

    for (const [key, value] of Object.entries(corsHeaders)) {
      newHeaders.set(key, value);
    }
    // Delete content-length to prevent chunk mismatch issues
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

    const statusCode = isTimeout ? 504 : 502;
    const statusTitle = isTimeout ? "Gateway Timeout" : "Bad Gateway";

    return createJsonResponse(
      {
        error: statusTitle,
        message: isTimeout
          ? `Target server at ${trimmedHost} timed out after ${timeoutMs}ms`
          : error?.message || "Failed to reach target server",
        target: targetUrl,
      },
      statusCode,
    );
  }
});
