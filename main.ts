Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // Extract 'bs-host' header (case-insensitive)
  const bsHostHeader = req.headers.get("bs-host") || req.headers.get("BS-HOST") || req.headers.get("Bs-Host");

  // Handle CORS preflight if no bs-host header is present
  if (req.method === "OPTIONS" && !bsHostHeader) {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  // Handle root landing / health check or missing header error
  if (!bsHostHeader) {
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          status: "online",
          service: "Deno Proxy API",
          usage: "Include 'bs-host' header in your request specifying the target IP or hostname.",
          examples: {
            curl: `curl -H "bs-host: 192.168.1.100:8000" ${url.origin}/api/v1/status`,
            fetch: `fetch("${url.origin}/api/v1/status", { headers: { "bs-host": "192.168.1.100:8000" } })`
          }
        }, null, 2),
        {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    return new Response(
      JSON.stringify({
        error: "Missing required 'bs-host' header",
        message: "Please specify target IP or hostname in 'bs-host' request header (e.g. 'bs-host: 192.168.1.100:8000')",
      }, null, 2),
      {
        status: 400,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  // Sanitize target host
  let rawHost = bsHostHeader.trim();
  // Default to http:// if no protocol scheme is provided
  if (!/^https?:\/\//i.test(rawHost)) {
    rawHost = `http://${rawHost}`;
  }

  // Strip trailing slashes from target host URL
  const targetBase = rawHost.replace(/\/+$/, "");

  // Construct final target URL preserving pathname and query parameters
  const targetUrlString = `${targetBase}${url.pathname}${url.search}`;

  // Prepare headers to forward to target host
  const forwardHeaders = new Headers();
  for (const [key, value] of req.headers.entries()) {
    const lowerKey = key.toLowerCase();
    // Omit hop-by-hop and bs-host headers
    if (
      lowerKey === "bs-host" ||
      lowerKey === "host" ||
      lowerKey === "connection" ||
      lowerKey === "keep-alive" ||
      lowerKey === "transfer-encoding" ||
      lowerKey === "content-length"
    ) {
      continue;
    }
    forwardHeaders.set(key, value);
  }

  // Prepare body (GET and HEAD requests must not contain a body)
  const body = (req.method === "GET" || req.method === "HEAD") ? null : req.body;

  const fetchOptions: RequestInit & { duplex?: string } = {
    method: req.method,
    headers: forwardHeaders,
    body: body,
    redirect: "manual",
  };

  if (body) {
    fetchOptions.duplex = "half";
  }

  try {
    const upstreamRes = await fetch(targetUrlString, fetchOptions);

    // Copy upstream response headers
    const resHeaders = new Headers(upstreamRes.headers);

    // Enable CORS for clients if not explicitly defined by upstream
    if (!resHeaders.has("Access-Control-Allow-Origin")) {
      resHeaders.set("Access-Control-Allow-Origin", "*");
    }

    // Remove content-length to prevent chunk mismatch issues when streaming
    resHeaders.delete("content-length");
    resHeaders.delete("content-encoding");

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: resHeaders,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[Proxy Error] Failed forwarding to ${targetUrlString}:`, errorMessage);

    return new Response(
      JSON.stringify({
        error: "Bad Gateway",
        message: `Failed to connect to target host at ${targetUrlString}`,
        details: errorMessage,
      }, null, 2),
      {
        status: 502,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
});
