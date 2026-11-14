
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    }
  });
}

function getAllowedHostnames(env) {
  return String(env.CONTACT_ALLOWED_HOSTNAMES || "")
    .split(/[,;\s]+/)
    .map((hostname) => hostname.trim().toLowerCase())
    .filter(Boolean);
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "GET") {
    return jsonResponse(
      { ok: false, message: "Método no permitido." },
      405
    );
  }

  const hostname = new URL(request.url).hostname.toLowerCase();
  const allowedHostnames = getAllowedHostnames(env);

  if (!allowedHostnames.includes(hostname)) {
    return jsonResponse(
      { ok: false, message: "Solicitud no permitida." },
      403
    );
  }

  const siteKey = String(env.TURNSTILE_SITE_KEY || "").trim();

  if (!siteKey) {
    return jsonResponse(
      {
        ok: false,
        message: "La configuración de seguridad no está disponible."
      },
      503
    );
  }

  return jsonResponse({
    ok: true,
    siteKey,
    action: "contact"
  });
}
