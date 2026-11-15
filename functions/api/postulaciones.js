
const NOTION_DATA_SOURCE_ID =
  "41906916-afaf-81cb-b2de-000bd622c2a9";

const NOTION_API_VERSION = "2026-03-11";

const LEGAL_PACKAGE_VERSION =
  "postulaciones-v1.0-2026-11-14";

const EMAIL_FROM =
  "CX-Review Postulaciones <formularios@send.cx-review.com.ar>";

const EMAIL_TO =
  "postulaciones@cx-review.com.ar";

const JOB_TABLE = "job_application_submission_jobs";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES = 6 * 1024 * 1024;

const LEASE_SECONDS = 45;
const EMAIL_SAFE_RETRY_WINDOW_MS =
  23 * 60 * 60 * 1000;

const ALLOWED_AREAS = new Set([
  "Auditoría y calidad",
  "Customer Experience",
  "Compliance",
  "Operaciones",
  "Tecnología y datos",
  "Comercial",
  "Administración",
  "Otra"
]);


class PublicError extends Error {
  constructor(status, message, retryable = false) {
    super(message);
    this.name = "PublicError";
    this.status = status;
    this.retryable = retryable;
  }
}


class IntegrationError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.name = "IntegrationError";
    this.code = code;
    this.status = status;
  }
}


function jsonResponse(data, status = 200, additionalHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      ...additionalHeaders
    }
  });
}


function getAllowedHostnames(env) {
  return String(env.CONTACT_ALLOWED_HOSTNAMES || "")
    .split(/[,;\s]+/)
    .map((hostname) => hostname.trim().toLowerCase())
    .filter(Boolean);
}


function isAllowedRequest(request, env) {
  const requestUrl = new URL(request.url);
  const allowedHostnames = getAllowedHostnames(env);

  if (!allowedHostnames.includes(requestUrl.hostname.toLowerCase())) {
    return false;
  }

  const fetchSite = request.headers.get("Sec-Fetch-Site");

  if (fetchSite && fetchSite !== "same-origin") {
    return false;
  }

  const origin = request.headers.get("Origin");

  if (!origin) {
    return false;
  }

  try {
    return new URL(origin).origin === requestUrl.origin;
  } catch {
    return false;
  }
}


function isValidEmail(value) {
  if (typeof value !== "string") {
    return false;
  }

  if (value.length > 254 || /[\r\n<>]/.test(value)) {
    return false;
  }

  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/u.test(value);
}


function readTextField(value, field, maxLength, options = {}) {
  const {
    required = false,
    minLength = 0
  } = options;

  if (typeof value !== "string") {
    if (required) {
      throw new PublicError(
        400,
        `El campo ${field} es obligatorio.`
      );
    }

    return "";
  }

  const normalized = value
    .replace(/\r\n?/g, "\n")
    .trim()
    .replace(/\s+/g, " ");

  if (/[\u0000-\u001F\u007F]/.test(normalized)) {
    throw new PublicError(
      400,
      `El campo ${field} contiene caracteres no permitidos.`
    );
  }

  if (normalized.length > maxLength) {
    throw new PublicError(
      400,
      `El campo ${field} supera la longitud permitida.`
    );
  }

  if (required && normalized.length < minLength) {
    throw new PublicError(
      400,
      `El campo ${field} debe tener al menos ${minLength} caracteres.`
    );
  }

  return normalized;
}


function isUuid(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}


function normalizeApplicationPayload(formData) {
  const fullName = readTextField(
    formData.get("fullName"),
    "nombre y apellido",
    120,
    { required: true, minLength: 2 }
  );

  const email = readTextField(
    formData.get("email"),
    "correo electrónico",
    254,
    { required: true, minLength: 5 }
  ).toLowerCase();

  if (!isValidEmail(email)) {
    throw new PublicError(
      400,
      "Ingresá una dirección de correo electrónico válida."
    );
  }

  const phone = readTextField(
    formData.get("phone"),
    "teléfono",
    40
  );

  if (phone && !/^[0-9+().\-\s]+$/.test(phone)) {
    throw new PublicError(
      400,
      "El teléfono contiene caracteres no permitidos."
    );
  }

  const area = readTextField(
    formData.get("area"),
    "área de interés",
    80,
    { required: true, minLength: 2 }
  );

  if (!ALLOWED_AREAS.has(area)) {
    throw new PublicError(
      400,
      "Seleccioná un área de interés válida."
    );
  }

  const profileUrl = readTextField(
    formData.get("profileUrl"),
    "perfil profesional",
    2048
  );

  if (profileUrl) {
    try {
      const parsedUrl = new URL(profileUrl);

      if (
        parsedUrl.protocol !== "https:" ||
        parsedUrl.username ||
        parsedUrl.password
      ) {
        throw new Error("Invalid URL");
      }
    } catch {
      throw new PublicError(
        400,
        "El enlace al perfil profesional no es válido. Utilizá una dirección HTTPS."
      );
    }
  }

  const privacyNoticeRead =
    formData.get("privacyNoticeRead") === "true";

  const applicationConsent =
    formData.get("applicationConsent") === "true";

  const futureOpportunitiesConsent =
    formData.get("futureOpportunitiesConsent") === "true";

  if (!privacyNoticeRead || !applicationConsent) {
    throw new PublicError(
      400,
      "Para enviar tu postulación debés aceptar las declaraciones obligatorias."
    );
  }

  return {
    fullName,
    email,
    phone,
    area,
    profileUrl,
    privacyNoticeRead,
    applicationConsent,
    futureOpportunitiesConsent
  };
}


function normalizeFileName(value) {
  let name = String(value || "CV.pdf")
    .normalize("NFKC")
    .replace(/[\/\\\r\n\u0000-\u001F]/g, "_")
    .replace(/[^\p{L}\p{N} ._()-]/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  if (!name.toLowerCase().endsWith(".pdf")) {
    name = "CV.pdf";
  }

  return name || "CV.pdf";
}


async function preparePdfFile(file) {
  if (
    !file ||
    typeof file.arrayBuffer !== "function" ||
    file.size === 0
  ) {
    throw new PublicError(
      400,
      "Adjuntá tu currículum en formato PDF."
    );
  }

  if (file.size > MAX_FILE_BYTES) {
    throw new PublicError(
      413,
      "El PDF supera el límite de 5 MB."
    );
  }

  const fileName = normalizeFileName(file.name);

  if (
    !String(file.name || "").toLowerCase().endsWith(".pdf")
  ) {
    throw new PublicError(
      400,
      "El archivo debe tener extensión .pdf."
    );
  }

  const contentType = String(file.type || "").toLowerCase();

  if (
    contentType &&
    contentType !== "application/pdf" &&
    contentType !== "application/octet-stream"
  ) {
    throw new PublicError(
      400,
      "El archivo seleccionado no parece ser un PDF."
    );
  }

  const bytes = new Uint8Array(
    await file.arrayBuffer()
  );

  if (bytes.length !== file.size) {
    throw new PublicError(
      400,
      "No pudimos leer correctamente el archivo adjunto."
    );
  }

  // Firma inicial de un documento PDF: %PDF-
  const pdfSignature = [0x25, 0x50, 0x44, 0x46, 0x2D];

  const isPdf = pdfSignature.every(
    (byte, index) => bytes[index] === byte
  );

  if (!isPdf) {
    throw new PublicError(
      400,
      "El contenido del archivo no corresponde a un PDF válido."
    );
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes
  );

  const fileHash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return {
    fileName,
    bytes,
    fileHash
  };
}


async function readLimitedRequestBody(request) {
  const reader = request.body?.getReader();

  if (!reader) {
    throw new PublicError(
      400,
      "La solicitud no contiene un archivo válido."
    );
  }

  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      totalBytes += value.byteLength;

      if (totalBytes > MAX_REQUEST_BYTES) {
        await reader.cancel();

        throw new PublicError(
          413,
          "La solicitud supera el tamaño máximo permitido."
        );
      }

      chunks.push(value);
    }

  } catch (error) {
    if (error instanceof PublicError) {
      throw error;
    }

    throw new PublicError(
      400,
      "No pudimos procesar los datos enviados."
    );
  }

  const result = new Uint8Array(totalBytes);

  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
}


async function parseMultipartRequest(request) {
  const declaredLength = Number(
    request.headers.get("Content-Length") || 0
  );

  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_REQUEST_BYTES
  ) {
    throw new PublicError(
      413,
      "La solicitud supera el tamaño máximo permitido."
    );
  }

  const bytes = await readLimitedRequestBody(request);

  const headers = new Headers(request.headers);

  headers.delete("Content-Length");
  headers.delete("Transfer-Encoding");

  try {
    const parsedRequest = new Request(request.url, {
      method: "POST",
      headers,
      body: bytes
    });

    return await parsedRequest.formData();

  } catch {
    throw new PublicError(
      400,
      "No pudimos interpretar los datos del formulario."
    );
  }
}


function normalizeErrorCode(value, fallback) {
  const code = String(value || fallback || "unknown_error")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .slice(0, 80);

  return code || "unknown_error";
}


async function fetchJson(url, options, provider, timeoutMs = 15000) {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    const rawBody = await response.text();

    let data = {};

    try {
      data = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      throw new IntegrationError(
        `${provider}_invalid_json`,
        response.status
      );
    }

    if (!response.ok) {
      throw new IntegrationError(
        `${provider}_${normalizeErrorCode(
          data.code,
          `http_${response.status}`
        )}`,
        response.status
      );
    }

    return data;

  } catch (error) {
    if (error instanceof IntegrationError) {
      throw error;
    }

    throw new IntegrationError(
      `${provider}_network_or_timeout`,
      0
    );

  } finally {
    clearTimeout(timeout);
  }
}


/* =====================================================
   TURNSTILE
===================================================== */

async function verifyTurnstile(token, env) {
  const secret = String(
    env.TURNSTILE_SECRET_KEY || ""
  ).trim();

  if (!secret) {
    throw new IntegrationError(
      "turnstile_not_configured"
    );
  }

  const formData = new FormData();

  formData.set("secret", secret);
  formData.set("response", token);
  formData.set("idempotency_key", crypto.randomUUID());

  const result = await fetchJson(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      body: formData
    },
    "turnstile",
    10000
  );

  const allowedHostnames = getAllowedHostnames(env);

  const verifiedHostname = String(
    result.hostname || ""
  ).toLowerCase();

  return (
    result.success === true &&
    result.action === "postulaciones" &&
    allowedHostnames.includes(verifiedHostname)
  );
}


/* =====================================================
   HUELLA DE CONTENIDO
===================================================== */

async function createPayloadFingerprint(payload, fileHash) {
  const canonicalPayload = JSON.stringify({
    fullName: payload.fullName,
    email: payload.email,
    phone: payload.phone,
    area: payload.area,
    profileUrl: payload.profileUrl,
    privacyNoticeRead: payload.privacyNoticeRead,
    applicationConsent: payload.applicationConsent,
    futureOpportunitiesConsent: payload.futureOpportunitiesConsent,
    fileHash
  });

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalPayload)
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}


/* =====================================================
   D1 — LEDGER TÉCNICO
===================================================== */

async function readJob(db, requestKey) {
  return db.prepare(
    `SELECT *
     FROM ${JOB_TABLE}
     WHERE request_key = ?
     LIMIT 1`
  )
    .bind(requestKey)
    .first();
}


async function createOrLoadJob(
  db,
  requestKey,
  fingerprint
) {
  const now = new Date().toISOString();

  await db.prepare(
    `INSERT INTO ${JOB_TABLE} (
      request_key,
      payload_fingerprint,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?)
    ON CONFLICT(request_key) DO NOTHING`
  )
    .bind(
      requestKey,
      fingerprint,
      now,
      now
    )
    .run();

  const job = await readJob(db, requestKey);

  if (!job) {
    throw new IntegrationError(
      "d1_application_job_not_created"
    );
  }

  if (job.payload_fingerprint !== fingerprint) {
    throw new PublicError(
      409,
      "Los datos o el archivo de esta postulación cambiaron respecto de un envío anterior. Verificá que la postulación previa no se haya recibido antes de generar un nuevo envío."
    );
  }

  return job;
}


const BRANCH_COLUMNS = {
  notion: {
    status: "notion_status",
    lease: "notion_lease_until",
    attempts: "notion_attempts",
    lastError: "notion_last_error_code",
    resultId: "notion_page_id"
  },

  email: {
    status: "email_status",
    lease: "email_lease_until",
    attempts: "email_attempts",
    lastError: "email_last_error_code",
    resultId: "resend_email_id"
  }
};


async function claimBranch(db, requestKey, branch) {
  const columns = BRANCH_COLUMNS[branch];

  const now = new Date();

  const nowIso = now.toISOString();

  const leaseUntil = new Date(
    now.getTime() + LEASE_SECONDS * 1000
  ).toISOString();

  const result = await db.prepare(
    `UPDATE ${JOB_TABLE}
     SET
       ${columns.lease} = ?,
       ${columns.attempts} = ${columns.attempts} + 1,
       updated_at = ?
     WHERE
       request_key = ?
       AND ${columns.status} NOT IN ('succeeded', 'manual_review')
       AND (
         ${columns.lease} IS NULL
         OR ${columns.lease} <= ?
       )`
  )
    .bind(
      leaseUntil,
      nowIso,
      requestKey,
      nowIso
    )
    .run();

  const changes = Number(
    result?.meta?.changes || 0
  );

  if (changes > 0) {
    return "claimed";
  }

  const currentJob = await readJob(db, requestKey);

  if (currentJob?.[columns.status] === "succeeded") {
    return "done";
  }

  if (currentJob?.[columns.status] === "manual_review") {
    return "manual_review";
  }

  return "busy";
}


async function completeBranch(
  db,
  requestKey,
  branch,
  resultId
) {
  const columns = BRANCH_COLUMNS[branch];

  const now = new Date().toISOString();

  await db.prepare(
    `UPDATE ${JOB_TABLE}
     SET
       ${columns.status} = 'succeeded',
       ${columns.resultId} = ?,
       ${columns.lease} = NULL,
       ${columns.lastError} = NULL,
       updated_at = ?
     WHERE request_key = ?`
  )
    .bind(
      resultId,
      now,
      requestKey
    )
    .run();
}


async function recordBranchFailure(
  db,
  requestKey,
  branch,
  errorCode
) {
  const columns = BRANCH_COLUMNS[branch];

  const now = new Date().toISOString();

  await db.prepare(
    `UPDATE ${JOB_TABLE}
     SET
       ${columns.status} = 'pending',
       ${columns.lease} = NULL,
       ${columns.lastError} = ?,
       updated_at = ?
     WHERE request_key = ?`
  )
    .bind(
      normalizeErrorCode(
        errorCode,
        `${branch}_error`
      ),
      now,
      requestKey
    )
    .run();
}


async function runBranch(
  db,
  requestKey,
  branch,
  handler
) {
  const claim = await claimBranch(
    db,
    requestKey,
    branch
  );

  if (claim === "done") {
    return "succeeded";
  }

  if (claim === "manual_review") {
    return "manual_review";
  }

  if (claim === "busy") {
    return "busy";
  }

  try {
    const resultId = await handler();

    if (!resultId || typeof resultId !== "string") {
      throw new IntegrationError(
        `${branch}_missing_result_id`
      );
    }

    await completeBranch(
      db,
      requestKey,
      branch,
      resultId
    );

    return "succeeded";

  } catch (error) {
    const errorCode = error instanceof IntegrationError
      ? error.code
      : `${branch}_internal_error`;

    try {
      await recordBranchFailure(
        db,
        requestKey,
        branch,
        errorCode
      );
    } catch {
      // El lease vence automáticamente si D1 falla.
    }

    console.error(JSON.stringify({
      event: "application_branch_failed",
      branch,
      code: errorCode
    }));

    return "pending";
  }
}


/* =====================================================
   NOTION
===================================================== */

function richTextChunks(value) {
  if (!value) {
    return [];
  }

  const chunks = [];

  for (let start = 0; start < value.length; start += 1800) {
    chunks.push({
      type: "text",
      text: {
        content: value.slice(start, start + 1800)
      }
    });
  }

  return chunks;
}


async function findExistingNotionApplication(
  requestKey,
  env
) {
  const apiKey = String(
    env.NOTION_API_KEY || ""
  ).trim();

  if (!apiKey) {
    throw new IntegrationError(
      "notion_not_configured"
    );
  }

  const result = await fetchJson(
    `https://api.notion.com/v1/data_sources/${NOTION_DATA_SOURCE_ID}/query`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_API_VERSION
      },
      body: JSON.stringify({
        filter: {
          property: "ID de postulación",
          rich_text: {
            equals: requestKey
          }
        },
        page_size: 1
      })
    },
    "notion"
  );

  if (
    Array.isArray(result.results) &&
    result.results.length > 0
  ) {
    return result.results[0].id;
  }

  return null;
}


async function createNotionApplication(
  requestKey,
  payload,
  fileName,
  env
) {
  const properties = {
    "Postulante": {
      title: richTextChunks(payload.fullName)
    },

    "Email": {
      email: payload.email
    },

    "Área de interés": {
      select: {
        name: payload.area
      }
    },

    "Canal": {
      select: {
        name: "Sitio web"
      }
    },

    "Estado": {
      status: {
        name: "Recibido"
      }
    },

    "Aviso de privacidad leído": {
      checkbox: true
    },

    "Autorización para evaluar postulación": {
      checkbox: true
    },

    "Autorización para futuras oportunidades": {
      checkbox: payload.futureOpportunitiesConsent
    },

    "ID de postulación": {
      rich_text: richTextChunks(requestKey)
    },

    "Nombre del CV": {
      rich_text: richTextChunks(fileName)
    },

    "Versión del aviso de privacidad": {
      rich_text: richTextChunks(LEGAL_PACKAGE_VERSION)
    },

    "Perfil profesional": {
      url: payload.profileUrl || null
    },

    "Teléfono": {
      phone_number: payload.phone || null
    }
  };

  const response = await fetchJson(
    "https://api.notion.com/v1/pages",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.NOTION_API_KEY}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_API_VERSION
      },
      body: JSON.stringify({
        parent: {
          type: "data_source_id",
          data_source_id: NOTION_DATA_SOURCE_ID
        },
        properties
      })
    },
    "notion"
  );

  if (!response.id) {
    throw new IntegrationError(
      "notion_missing_page_id"
    );
  }

  return response.id;
}


async function ensureNotionApplication(
  requestKey,
  payload,
  fileName,
  env
) {
  const existingPageId = await findExistingNotionApplication(
    requestKey,
    env
  );

  if (existingPageId) {
    return existingPageId;
  }

  return createNotionApplication(
    requestKey,
    payload,
    fileName,
    env
  );
}


/* =====================================================
   RESEND — CORREO CON CV ADJUNTO
===================================================== */

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


function buildApplicationEmailHtml(
  payload,
  fileName,
  requestKey
) {
  const fields = [
    ["Nombre y apellido", payload.fullName],
    ["Correo electrónico", payload.email],
    ["Teléfono", payload.phone || "No informado"],
    ["Área de interés", payload.area],
    ["Perfil profesional", payload.profileUrl || "No informado"],
    ["CV adjunto", fileName],
    ["Aviso de privacidad leído", "Sí"],
    ["Autorización para evaluar la postulación", "Sí"],
    [
      "Autorización para futuras oportunidades",
      payload.futureOpportunitiesConsent ? "Sí" : "No"
    ],
    ["ID de postulación", requestKey]
  ];

  const rows = fields.map(([label, value]) => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;font-weight:600;vertical-align:top;">
        ${escapeHtml(label)}
      </td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;vertical-align:top;">
        ${escapeHtml(value)}
      </td>
    </tr>
  `).join("");

  return `
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8">
      </head>

      <body style="margin:0;padding:30px;background:#f5f7fa;font-family:Arial,sans-serif;color:#26364a;">
        <div style="max-width:720px;margin:0 auto;padding:30px;background:#ffffff;border:1px solid #e4e9ef;">

          <h1 style="margin:0 0 8px;color:#123052;font-size:22px;">
            Nueva postulación laboral
          </h1>

          <p style="margin:0 0 25px;color:#69788a;font-size:13px;">
            Se recibió una postulación mediante el sitio institucional de CX-Review.
          </p>

          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            ${rows}
          </table>

          <p style="margin:25px 0 0;color:#8995a3;font-size:11px;">
            El currículum se encuentra adjunto a este correo.
          </p>

        </div>
      </body>
    </html>
  `;
}


function buildApplicationEmailText(
  payload,
  fileName,
  requestKey
) {
  return [
    "Nueva postulación laboral | CX-Review",
    "",
    `Nombre y apellido: ${payload.fullName}`,
    `Correo electrónico: ${payload.email}`,
    `Teléfono: ${payload.phone || "No informado"}`,
    `Área de interés: ${payload.area}`,
    `Perfil profesional: ${payload.profileUrl || "No informado"}`,
    `CV adjunto: ${fileName}`,
    "",
    "Declaraciones:",
    "Aviso de privacidad leído: Sí",
    "Autorización para evaluar la postulación: Sí",
    `Autorización para futuras oportunidades: ${payload.futureOpportunitiesConsent ? "Sí" : "No"}`,
    "",
    `ID de postulación: ${requestKey}`,
    "",
    "El CV se encuentra adjunto a este correo."
  ].join("\n");
}


function bytesToBase64(bytes) {
  // 32766 es divisible por 3; esto permite concatenar
  // segmentos Base64 sin introducir padding intermedio.
  const chunkSize = 32766;

  let result = "";

  for (
    let offset = 0;
    offset < bytes.length;
    offset += chunkSize
  ) {
    const chunk = bytes.subarray(
      offset,
      Math.min(offset + chunkSize, bytes.length)
    );

    let binary = "";

    for (let index = 0; index < chunk.length; index++) {
      binary += String.fromCharCode(chunk[index]);
    }

    result += btoa(binary);
  }

  return result;
}


async function sendApplicationEmail(
  requestKey,
  payload,
  file,
  env
) {
  const apiKey = String(
    env.RESEND_API_KEY || ""
  ).trim();

  if (!apiKey) {
    throw new IntegrationError(
      "resend_not_configured"
    );
  }

  const attachmentContent = bytesToBase64(file.bytes);

  const response = await fetchJson(
    "https://api.resend.com/emails",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `cxreview-postulacion-${requestKey}`
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [EMAIL_TO],
        reply_to: payload.email,
        subject: "Nueva postulación laboral | CX-Review",
        html: buildApplicationEmailHtml(
          payload,
          file.fileName,
          requestKey
        ),
        text: buildApplicationEmailText(
          payload,
          file.fileName,
          requestKey
        ),
        attachments: [
          {
            filename: file.fileName,
            content: attachmentContent,
            content_type: "application/pdf"
          }
        ],
        tags: [
          {
            name: "source",
            value: "job-application"
          },
          {
            name: "form",
            value: "cx-review"
          }
        ]
      })
    },
    "resend",
    25000
  );

  if (!response.id) {
    throw new IntegrationError(
      "resend_missing_email_id"
    );
  }

  return response.id;
}


/* =====================================================
   REENVÍOS — VENTANA SEGURA DE IDEMPOTENCIA
===================================================== */

async function runEmailBranch(
  db,
  job,
  requestKey,
  payload,
  file,
  env
) {
  if (job.email_status === "succeeded") {
    return "succeeded";
  }

  if (job.email_status === "manual_review") {
    return "manual_review";
  }

  const previousAttempts = Number(
    job.email_attempts || 0
  );

  const createdAt = Date.parse(job.created_at);

  const elapsed = Date.now() - createdAt;

  // Si ya hubo un intento y pasó la ventana segura,
  // no volver a llamar a Resend: un envío anterior
  // podría haber sido aceptado aunque se perdiera la respuesta.
  if (
    previousAttempts > 0 &&
    Number.isFinite(createdAt) &&
    elapsed >= EMAIL_SAFE_RETRY_WINDOW_MS
  ) {
    const now = new Date().toISOString();

    await db.prepare(
      `UPDATE ${JOB_TABLE}
       SET
         email_status = 'manual_review',
         email_lease_until = NULL,
         email_last_error_code = 'resend_idempotency_window_expired',
         updated_at = ?
       WHERE
         request_key = ?
         AND email_status != 'succeeded'`
    )
      .bind(now, requestKey)
      .run();

    return "manual_review";
  }

  return runBranch(
    db,
    requestKey,
    "email",
    () => sendApplicationEmail(
      requestKey,
      payload,
      file,
      env
    )
  );
}


/* =====================================================
   PROCESAMIENTO PRINCIPAL
===================================================== */

async function processApplication(
  requestKey,
  payload,
  file,
  fingerprint,
  env
) {
  if (!env.CONTACT_DB) {
    throw new IntegrationError(
      "application_db_not_configured"
    );
  }

  const job = await createOrLoadJob(
    env.CONTACT_DB,
    requestKey,
    fingerprint
  );

  await Promise.all([
    runBranch(
      env.CONTACT_DB,
      requestKey,
      "notion",
      () => ensureNotionApplication(
        requestKey,
        payload,
        file.fileName,
        env
      )
    ),

    runEmailBranch(
      env.CONTACT_DB,
      job,
      requestKey,
      payload,
      file,
      env
    )
  ]);

  const finalJob = await readJob(
    env.CONTACT_DB,
    requestKey
  );

  if (
    finalJob &&
    finalJob.notion_status === "succeeded" &&
    finalJob.email_status === "succeeded"
  ) {
    return {
      complete: true,
      manualReview: false
    };
  }

  if (
    finalJob &&
    finalJob.notion_status === "succeeded" &&
    finalJob.email_status === "manual_review"
  ) {
    return {
      complete: false,
      manualReview: true
    };
  }

  return {
    complete: false,
    manualReview: false
  };
}


/* =====================================================
   ENDPOINT PÚBLICO
===================================================== */

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return jsonResponse(
      {
        ok: false,
        message: "Método no permitido."
      },
      405,
      {
        Allow: "POST"
      }
    );
  }

  if (!isAllowedRequest(request, env)) {
    return jsonResponse(
      {
        ok: false,
        message: "Solicitud no permitida."
      },
      403
    );
  }

  const contentType = String(
    request.headers.get("Content-Type") || ""
  ).toLowerCase();

  if (!contentType.includes("multipart/form-data")) {
    return jsonResponse(
      {
        ok: false,
        message: "El formulario debe enviarse con un archivo adjunto."
      },
      415
    );
  }

  try {
    const formData = await parseMultipartRequest(request);

    // Honeypot: respuesta aparente de éxito sin procesamiento.
    const honeypot = formData.get("website");

    if (
      typeof honeypot === "string" &&
      honeypot.trim()
    ) {
      return jsonResponse({
        ok: true,
        message: "Recibimos tu postulación."
      });
    }

    const payload = normalizeApplicationPayload(formData);

    const requestKey = readTextField(
      formData.get("requestKey"),
      "identificador de postulación",
      80,
      {
        required: true,
        minLength: 36
      }
    );

    if (!isUuid(requestKey)) {
      throw new PublicError(
        400,
        "No pudimos identificar esta postulación. Recargá la página e intentá nuevamente."
      );
    }

    const turnstileToken = readTextField(
      formData.get("turnstileToken"),
      "validación de seguridad",
      2048,
      {
        required: true,
        minLength: 10
      }
    );

    const file = await preparePdfFile(
      formData.get("cv")
    );

    let challengeValid = false;

    try {
      challengeValid = await verifyTurnstile(
        turnstileToken,
        env
      );

    } catch (error) {
      console.error(JSON.stringify({
        event: "application_turnstile_unavailable",
        code: error instanceof IntegrationError
          ? error.code
          : "turnstile_internal_error"
      }));

      return jsonResponse(
        {
          ok: false,
          retryable: true,
          message: "No pudimos completar la validación de seguridad. Volvé a intentarlo."
        },
        503
      );
    }

    if (!challengeValid) {
      throw new PublicError(
        400,
        "La validación de seguridad no fue aceptada. Volvé a completarla."
      );
    }

    const fingerprint = await createPayloadFingerprint(
      payload,
      file.fileHash
    );

    const result = await processApplication(
      requestKey,
      payload,
      file,
      fingerprint,
      env
    );

    if (result.complete) {
      return jsonResponse({
        ok: true,
        message: "Recibimos tu postulación correctamente."
      });
    }

    if (result.manualReview) {
      return jsonResponse(
        {
          ok: true,
          manualReview: true,
          message: "Registramos los datos de tu postulación, pero no pudimos confirmar la notificación interna con el CV. No vuelvas a enviar el formulario."
        },
        202
      );
    }

    return jsonResponse(
      {
        ok: false,
        retryable: true,
        message: "No pudimos confirmar el procesamiento completo. Tus datos y el archivo permanecen en el formulario. Volvé a intentar utilizando exactamente los mismos datos y el mismo PDF."
      },
      503,
      {
        "Retry-After": "5"
      }
    );

  } catch (error) {
    if (error instanceof PublicError) {
      return jsonResponse(
        {
          ok: false,
          retryable: error.retryable,
          message: error.message
        },
        error.status
      );
    }

    const errorCode = error instanceof IntegrationError
      ? error.code
      : "application_internal_error";

    console.error(JSON.stringify({
      event: "application_submission_failed",
      code: errorCode
    }));

    return jsonResponse(
      {
        ok: false,
        retryable: true,
        message: "No pudimos procesar tu postulación en este momento. Conservá los datos y el archivo en el formulario e intentá nuevamente."
      },
      503
    );
  }
}
