// Deno Proxy API
// Customized based on your exact proxy handler specifications

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, bs-host, secret-key",
};

// Regex to validate IPv4 format with optional or required port (e.g. 192.168.1.1:8000 or 192.168.1.1)
const ipv4PortRegex = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/;

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
    return new Response("Host header not found", {
      status: 400,
      headers: corsHeaders,
    });
  }

  // Validate the host header for IPv4 and port
  const trimmedHost = hostHeader.trim();
  if (!ipv4PortRegex.test(trimmedHost)) {
    return new Response("Invalid IP:Port format", {
      status: 400,
      headers: corsHeaders,
    });
  }

  const targetUrl = `http://${trimmedHost}${path}`;

  try {
    const body = method !== "GET" && method !== "HEAD" ? await req.text() : undefined;

    const forwardHeaders = new Headers(req.headers);
    // Remove host / bs-host to avoid header conflicts with upstream server
    forwardHeaders.delete("bs-host");
    forwardHeaders.delete("host");

    const response = await fetch(targetUrl, {
      method: method,
      body: body,
      headers: forwardHeaders,
    });

    const newHeaders = new Headers(response.headers);
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
  } catch (err) {
    console.error(`Proxy error forwarding to ${targetUrl}:`, err);
    return new Response(`Proxy error: ${err instanceof Error ? err.message : String(err)}`, {
      status: 502,
      headers: corsHeaders,
    });
  }
});
