
const NOTION_DATA_SOURCE_ID =
  "161d97d8-1140-47e6-aea3-b336999f222c";

const NOTION_API_VERSION = "2026-03-11";

const LEGAL_PACKAGE_VERSION =
  "contact-form-v1.0-2026-11-14";

const EMAIL_FROM =
  "CX-Review Formulario <formularios@send.cx-review.com.ar>";

const ALLOWED_REASONS = new Set([
  "Auditoría e-commerce",
  "Mystery shopping",
  "Compliance",
  "Operaciones",
  "Customer Experience",
  "Otro"
]);

const JOB_TABLE = "contact_submission_jobs";

const MAX_BODY_BYTES = 16000;
const LEASE_SECONDS = 45;
const JOB_RETENTION_DAYS = 30;
const CLEANUP_BATCH_SIZE = 100;


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


function isAllowedRequest(request, env, requireOrigin = false) {
  const requestUrl = new URL(request.url);
  const allowedHostnames = getAllowedHostnames(env);

  if (!allowedHostnames.includes(requestUrl.hostname.toLowerCase())) {
    return false;
  }

  const fetchSite = request.headers.get("Sec-Fetch-Site");

  if (fetchSite && fetchSite !== "same-origin") {
    return false;
  }

  if (requireOrigin) {
    const origin = request.headers.get("Origin");

    if (!origin) {
      return false;
    }

    try {
      if (new URL(origin).origin !== requestUrl.origin) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
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
    minLength = 0,
    multiline = false
  } = options;

  if (value === undefined || value === null) {
    if (required) {
      throw new PublicError(
        400,
        `El campo ${field} es obligatorio.`
      );
    }

    return "";
  }

  if (typeof value !== "string") {
    throw new PublicError(
      400,
      `El campo ${field} no tiene un formato válido.`
    );
  }

  let normalized = value.replace(/\r\n?/g, "\n").trim();

  if (!multiline) {
    if (/[\r\n]/.test(normalized)) {
      throw new PublicError(
        400,
        `El campo ${field} contiene caracteres no permitidos.`
      );
    }

    normalized = normalized.replace(/\s+/g, " ");
  }

  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) {
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


function readBoolean(value, field) {
  if (typeof value !== "boolean") {
    throw new PublicError(
      400,
      `El campo ${field} no tiene un formato válido.`
    );
  }

  return value;
}


function isUuid(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}


function normalizePayload(body) {
  const fullName = readTextField(
    body.fullName,
    "nombre",
    120,
    { required: true, minLength: 2 }
  );

  const email = readTextField(
    body.email,
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

  const company = readTextField(
    body.company,
    "empresa",
    160
  );

  const phone = readTextField(
    body.phone,
    "teléfono",
    40
  );

  if (phone && !/^[0-9+().\-\s]+$/.test(phone)) {
    throw new PublicError(
      400,
      "El teléfono contiene caracteres no permitidos."
    );
  }

  const reason = readTextField(
    body.reason,
    "motivo de consulta",
    80,
    { required: true, minLength: 2 }
  );

  if (!ALLOWED_REASONS.has(reason)) {
    throw new PublicError(
      400,
      "Seleccioná un motivo de consulta válido."
    );
  }

  const message = readTextField(
    body.message,
    "mensaje",
    3000,
    {
      required: true,
      minLength: 10,
      multiline: true
    }
  );

  const privacyNoticeRead = readBoolean(
    body.privacyNoticeRead,
    "aviso de privacidad"
  );

  const dataProcessingConsent = readBoolean(
    body.dataProcessingConsent,
    "autorización de tratamiento de datos"
  );

  const marketingConsent = readBoolean(
    body.marketingConsent,
    "consentimiento comercial"
  );

  if (!privacyNoticeRead || !dataProcessingConsent) {
    throw new PublicError(
      400,
      "Para enviar la consulta debés aceptar las declaraciones obligatorias."
    );
  }

  return {
    fullName,
    email,
    company,
    phone,
    reason,
    message,
    privacyNoticeRead,
    dataProcessingConsent,
    marketingConsent
  };
}


function normalizeErrorCode(value, fallback) {
  const code = String(value || fallback || "unknown_error")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .slice(0, 80);

  return code || "unknown_error";
}


async function fetchJson(url, options, provider, timeoutMs = 12000) {
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
      const providerCode = normalizeErrorCode(
        data.code,
        `http_${response.status}`
      );

      throw new IntegrationError(
        `${provider}_${providerCode}`,
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
    result.action === "contact" &&
    allowedHostnames.includes(verifiedHostname)
  );
}


/* =====================================================
   D1 — HUELLA DEL CONTENIDO
===================================================== */

async function createPayloadFingerprint(payload) {
  const canonicalPayload = JSON.stringify({
    fullName: payload.fullName,
    email: payload.email,
    company: payload.company,
    phone: payload.phone,
    reason: payload.reason,
    message: payload.message,
    privacyNoticeRead: payload.privacyNoticeRead,
    dataProcessingConsent: payload.dataProcessingConsent,
    marketingConsent: payload.marketingConsent
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
   D1 — LIMPIEZA DEL LEDGER TÉCNICO
===================================================== */

async function cleanupExpiredJobs(db) {
  const now = new Date().toISOString();

  try {
    const result = await db.prepare(
      `DELETE FROM ${JOB_TABLE}
       WHERE submission_id IN (
         SELECT submission_id
         FROM ${JOB_TABLE}
         WHERE expires_at <= ?
           AND notion_status = 'succeeded'
           AND email_status = 'succeeded'
           AND (
             notion_lease_until IS NULL
             OR notion_lease_until <= ?
           )
           AND (
             email_lease_until IS NULL
             OR email_lease_until <= ?
           )
         ORDER BY expires_at ASC
         LIMIT ?
       )`
    )
      .bind(
        now,
        now,
        now,
        CLEANUP_BATCH_SIZE
      )
      .run();

    const deleted = Number(
      result?.meta?.changes || 0
    );

    if (deleted > 0) {
      console.info(JSON.stringify({
        event: "contact_jobs_expired_cleanup",
        deleted
      }));
    }

  } catch (error) {
    // La limpieza es auxiliar. Su fallo no debe impedir
    // que una consulta válida pueda ser procesada.
    console.error(JSON.stringify({
      event: "contact_jobs_cleanup_failed"
    }));
  }
}


/* =====================================================
   D1 — CREACIÓN Y LECTURA DE TRABAJOS
===================================================== */

async function readJobByRequestKey(db, requestKey) {
  return db.prepare(
    `SELECT *
     FROM ${JOB_TABLE}
     WHERE request_key = ?
     LIMIT 1`
  )
    .bind(requestKey)
    .first();
}


async function readJobById(db, submissionId) {
  return db.prepare(
    `SELECT *
     FROM ${JOB_TABLE}
     WHERE submission_id = ?
     LIMIT 1`
  )
    .bind(submissionId)
    .first();
}


async function createOrLoadJob(
  db,
  requestKey,
  payloadFingerprint
) {
  let job = await readJobByRequestKey(
    db,
    requestKey
  );

  if (!job) {
    const now = new Date();

    const createdAt = now.toISOString();

    const expiresAt = new Date(
      now.getTime() +
      JOB_RETENTION_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    const submissionId = crypto.randomUUID();

    await db.prepare(
      `INSERT INTO ${JOB_TABLE} (
        submission_id,
        created_at,
        updated_at,
        expires_at,
        request_key,
        payload_fingerprint
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(request_key) DO NOTHING`
    )
      .bind(
        submissionId,
        createdAt,
        createdAt,
        expiresAt,
        requestKey,
        payloadFingerprint
      )
      .run();

    // Si otra solicitud concurrente insertó el mismo requestKey,
    // se recupera ese mismo trabajo.
    job = await readJobByRequestKey(
      db,
      requestKey
    );
  }

  if (!job) {
    throw new IntegrationError(
      "d1_job_creation_failed"
    );
  }

  if (job.payload_fingerprint !== payloadFingerprint) {
    throw new PublicError(
      409,
      "Los datos de esta solicitud cambiaron. Revisá el formulario y volvé a enviarlo."
    );
  }

  return job;
}


/* =====================================================
   D1 — BLOQUEOS Y ESTADOS POR OPERACIÓN
===================================================== */

const BRANCH_COLUMNS = {
  notion: {
    status: "notion_status",
    lease: "notion_lease_until",
    attempts: "notion_attempts",
    retry: "notion_next_retry_at",
    error: "notion_last_error_code",
    resultId: "notion_page_id"
  },

  email: {
    status: "email_status",
    lease: "email_lease_until",
    attempts: "email_attempts",
    retry: "email_next_retry_at",
    error: "email_last_error_code",
    resultId: "resend_email_id"
  }
};


async function claimBranch(db, submissionId, branch) {
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
       submission_id = ?
       AND ${columns.status} != 'succeeded'
       AND (
         ${columns.lease} IS NULL
         OR ${columns.lease} <= ?
       )`
  )
    .bind(
      leaseUntil,
      nowIso,
      submissionId,
      nowIso
    )
    .run();

  const changes = Number(
    result?.meta?.changes || 0
  );

  if (changes > 0) {
    return "claimed";
  }

  const currentJob = await readJobById(
    db,
    submissionId
  );

  if (currentJob?.[columns.status] === "succeeded") {
    return "done";
  }

  return "busy";
}


async function completeBranch(
  db,
  submissionId,
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
       ${columns.retry} = NULL,
       ${columns.error} = NULL,
       updated_at = ?
     WHERE submission_id = ?`
  )
    .bind(
      resultId,
      now,
      submissionId
    )
    .run();
}


async function recordBranchFailure(
  db,
  submissionId,
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
       ${columns.retry} = NULL,
       ${columns.error} = ?,
       updated_at = ?
     WHERE submission_id = ?`
  )
    .bind(
      normalizeErrorCode(
        errorCode,
        `${branch}_error`
      ),
      now,
      submissionId
    )
    .run();
}


async function processBranch(
  db,
  submissionId,
  branch,
  handler
) {
  const claim = await claimBranch(
    db,
    submissionId,
    branch
  );

  if (claim === "done") {
    return "succeeded";
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
      submissionId,
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
        submissionId,
        branch,
        errorCode
      );
    } catch {
      // Si D1 también está temporalmente indisponible,
      // el bloqueo vence automáticamente.
    }

    console.error(JSON.stringify({
      event: "contact_branch_failed",
      branch,
      submissionId,
      code: errorCode
    }));

    return "pending";
  }
}


/* =====================================================
   NOTION — UTILIDADES Y BÚSQUEDA
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


async function findExistingNotionPage(
  submissionId,
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
          property: "ID de envío",
          rich_text: {
            equals: submissionId
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


/* =====================================================
   NOTION — CREACIÓN DE CONSULTA
===================================================== */

async function createNotionPage(
  submissionId,
  acceptedAt,
  payload,
  env
) {
  const properties = {
    "Contacto": {
      title: richTextChunks(payload.fullName)
    },

    "Email": {
      email: payload.email
    },

    "Motivo de consulta": {
      select: {
        name: payload.reason
      }
    },

    "Mensaje": {
      rich_text: richTextChunks(payload.message)
    },

    "Canal": {
      select: {
        name: "Sitio web"
      }
    },

    "Aviso de privacidad leído": {
      checkbox: true
    },

    "Autorización de tratamiento de datos": {
      checkbox: true
    },

    "Consentimiento comercial": {
      checkbox: payload.marketingConsent
    },

    "Fecha de aceptación de declaraciones": {
      date: {
        start: acceptedAt
      }
    },

    "Versión del paquete legal aceptado": {
      rich_text: richTextChunks(
        LEGAL_PACKAGE_VERSION
      )
    },

    "ID de envío": {
      rich_text: richTextChunks(submissionId)
    }
  };

  if (payload.company) {
    properties["Empresa"] = {
      rich_text: richTextChunks(payload.company)
    };
  }

  if (payload.phone) {
    properties["Teléfono"] = {
      phone_number: payload.phone
    };
  }

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


async function ensureNotionContact(
  submissionId,
  acceptedAt,
  payload,
  env
) {
  // Antes de crear, buscar si el registro ya existe.
  // Esto evita duplicados ante respuestas perdidas.
  const existingPageId = await findExistingNotionPage(
    submissionId,
    env
  );

  if (existingPageId) {
    return existingPageId;
  }

  return createNotionPage(
    submissionId,
    acceptedAt,
    payload,
    env
  );
}


/* =====================================================
   RESEND — NOTIFICACIÓN
===================================================== */

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


function emailHtml(payload, submissionId) {
  const fields = [
    ["Nombre y apellido", payload.fullName],
    ["Correo electrónico", payload.email],
    ["Empresa", payload.company || "No informado"],
    ["Teléfono", payload.phone || "No informado"],
    ["Motivo de consulta", payload.reason],
    ["Mensaje", payload.message],
    ["Aviso de privacidad leído", "Sí"],
    ["Autorización de tratamiento de datos", "Sí"],
    [
      "Consentimiento comercial",
      payload.marketingConsent ? "Sí" : "No"
    ],
    ["Identificador de envío", submissionId]
  ];

  const rows = fields.map(([label, value]) => {
    return `
      <tr>
        <td style="padding:10px;border-bottom:1px solid #e5e7eb;font-weight:600;vertical-align:top;">
          ${escapeHtml(label)}
        </td>
        <td style="padding:10px;border-bottom:1px solid #e5e7eb;vertical-align:top;">
          ${escapeHtml(value).replace(/\n/g, "<br>")}
        </td>
      </tr>
    `;
  }).join("");

  return `
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8">
      </head>

      <body style="margin:0;padding:30px;background:#f5f7fa;font-family:Arial,sans-serif;color:#26364a;">
        <div style="max-width:720px;margin:0 auto;padding:30px;background:#ffffff;border:1px solid #e4e9ef;">

          <h1 style="margin:0 0 8px;color:#123052;font-size:22px;">
            Nueva consulta desde CX-Review
          </h1>

          <p style="margin:0 0 25px;color:#69788a;font-size:13px;">
            Se recibió una consulta mediante el formulario institucional.
          </p>

          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            ${rows}
          </table>

          <p style="margin:25px 0 0;color:#8995a3;font-size:11px;">
            Notificación automática del formulario de contacto de CX-Review.
          </p>

        </div>
      </body>
    </html>
  `;
}


function emailText(payload, submissionId) {
  return [
    "Nueva consulta desde CX-Review",
    "",
    `Nombre y apellido: ${payload.fullName}`,
    `Correo electrónico: ${payload.email}`,
    `Empresa: ${payload.company || "No informado"}`,
    `Teléfono: ${payload.phone || "No informado"}`,
    `Motivo: ${payload.reason}`,
    "",
    "Mensaje:",
    payload.message,
    "",
    "Aviso de privacidad leído: Sí",
    "Autorización de tratamiento de datos: Sí",
    `Consentimiento comercial: ${payload.marketingConsent ? "Sí" : "No"}`,
    "",
    `Identificador de envío: ${submissionId}`
  ].join("\n");
}


async function sendNotificationEmail(
  submissionId,
  payload,
  env
) {
  const apiKey = String(
    env.RESEND_API_KEY || ""
  ).trim();

  const recipient = String(
    env.CONTACT_NOTIFICATION_TO || ""
  ).trim();

  if (!apiKey) {
    throw new IntegrationError(
      "resend_not_configured"
    );
  }

  if (!isValidEmail(recipient)) {
    throw new IntegrationError(
      "notification_recipient_not_configured"
    );
  }

  const response = await fetchJson(
    "https://api.resend.com/emails",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `cxreview-contact-${submissionId}`
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [recipient],
        reply_to: payload.email,
        subject: "Nueva consulta desde el sitio web | CX-Review",
        html: emailHtml(payload, submissionId),
        text: emailText(payload, submissionId),
        tags: [
          {
            name: "source",
            value: "contact-form"
          },
          {
            name: "environment",
            value: "production"
          }
        ]
      })
    },
    "resend"
  );

  if (!response.id) {
    throw new IntegrationError(
      "resend_missing_email_id"
    );
  }

  return response.id;
}


/* =====================================================
   PROCESAMIENTO PRINCIPAL
===================================================== */

async function processContactSubmission(
  requestKey,
  payload,
  env
) {
  if (!env.CONTACT_DB) {
    throw new IntegrationError(
      "contact_db_not_configured"
    );
  }

  // Limpieza de metadatos técnicos vencidos.
  // Solo elimina trabajos completados en ambas integraciones.
  await cleanupExpiredJobs(env.CONTACT_DB);

  const fingerprint = await createPayloadFingerprint(
    payload
  );

  const job = await createOrLoadJob(
    env.CONTACT_DB,
    requestKey,
    fingerprint
  );

  const submissionId = job.submission_id;

  // La fecha original se conserva al reintentar.
  const acceptedAt = job.created_at;

  // Cada proveedor se procesa de forma independiente.
  await Promise.all([
    processBranch(
      env.CONTACT_DB,
      submissionId,
      "notion",
      () => ensureNotionContact(
        submissionId,
        acceptedAt,
        payload,
        env
      )
    ),

    processBranch(
      env.CONTACT_DB,
      submissionId,
      "email",
      () => sendNotificationEmail(
        submissionId,
        payload,
        env
      )
    )
  ]);

  const finalJob = await readJobById(
    env.CONTACT_DB,
    submissionId
  );

  if (
    finalJob &&
    finalJob.notion_status === "succeeded" &&
    finalJob.email_status === "succeeded"
  ) {
    return {
      complete: true
    };
  }

  return {
    complete: false
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
        "Allow": "POST"
      }
    );
  }

  if (!isAllowedRequest(request, env, true)) {
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

  if (!contentType.includes("application/json")) {
    return jsonResponse(
      {
        ok: false,
        message: "Formato de solicitud no válido."
      },
      415
    );
  }

  const declaredLength = Number(
    request.headers.get("Content-Length") || 0
  );

  if (declaredLength > MAX_BODY_BYTES) {
    return jsonResponse(
      {
        ok: false,
        message: "La solicitud supera el tamaño permitido."
      },
      413
    );
  }

  let rawBody;
  let body;

  try {
    rawBody = await request.text();

    const actualLength = new TextEncoder().encode(
      rawBody
    ).byteLength;

    if (actualLength > MAX_BODY_BYTES) {
      return jsonResponse(
        {
          ok: false,
          message: "La solicitud supera el tamaño permitido."
        },
        413
      );
    }

    body = JSON.parse(rawBody);

  } catch {
    return jsonResponse(
      {
        ok: false,
        message: "La solicitud no contiene datos válidos."
      },
      400
    );
  }

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return jsonResponse(
      {
        ok: false,
        message: "La solicitud no tiene un formato válido."
      },
      400
    );
  }

  // Honeypot: respuesta aparente de éxito sin procesar.
  if (
    typeof body.website === "string" &&
    body.website.trim()
  ) {
    return jsonResponse({
      ok: true,
      message: "Recibimos tu consulta. El equipo de CX-Review se pondrá en contacto."
    });
  }

  try {
    const payload = normalizePayload(body);

    const requestKey = String(
      body.requestKey || ""
    ).trim();

    if (!isUuid(requestKey)) {
      throw new PublicError(
        400,
        "No pudimos identificar esta solicitud. Recargá la página e intentá nuevamente."
      );
    }

    const turnstileToken = readTextField(
      body.turnstileToken,
      "validación de seguridad",
      2048,
      {
        required: true,
        minLength: 10
      }
    );

    let challengeValid;

    try {
      challengeValid = await verifyTurnstile(
        turnstileToken,
        env
      );

    } catch (error) {
      console.error(JSON.stringify({
        event: "contact_turnstile_unavailable",
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

    const result = await processContactSubmission(
      requestKey,
      payload,
      env
    );

    if (result.complete) {
      return jsonResponse({
        ok: true,
        message: "Recibimos tu consulta. El equipo de CX-Review se pondrá en contacto."
      });
    }

    return jsonResponse(
      {
        ok: false,
        retryable: true,
        message: "No pudimos confirmar el procesamiento completo. Tus datos permanecen en el formulario. Volvé a intentar en unos instantes."
      },
      202,
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
      : "contact_internal_error";

    console.error(JSON.stringify({
      event: "contact_submission_failed",
      code: errorCode
    }));

    return jsonResponse(
      {
        ok: false,
        retryable: true,
        message: "No pudimos procesar tu consulta en este momento. Tus datos permanecen en el formulario. Volvé a intentar."
      },
      503
    );
  }
}
