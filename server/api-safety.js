class ApiError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

async function fetchWithTimeout(url, options = {}, defaultTimeoutMs = 15000) {
  const { timeoutMs: requestedTimeout, signal: parentSignal, ...fetchOptions } = options;
  const timeoutMs = Math.max(1, Number(requestedTimeout) || Number(defaultTimeoutMs) || 15000);
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal) {
    if (parentSignal.aborted) abortFromParent();
    else parentSignal.addEventListener("abort", abortFromParent, { once: true });
  }
  let timedOut = false;
  let finalized = false;
  const finalize = () => {
    if (finalized) return;
    finalized = true;
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abortFromParent);
  };
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("upstream timeout"));
  }, timeoutMs);
  try {
    const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
    for (const method of ["arrayBuffer", "blob", "formData", "json", "text"]) {
      const consume = response[method].bind(response);
      response[method] = async (...args) => {
        try {
          return await consume(...args);
        } catch (error) {
          if (timedOut) {
            throw new ApiError(504, "UPSTREAM_TIMEOUT", `Upstream response timed out after ${timeoutMs} ms.`);
          }
          throw error;
        } finally {
          finalize();
        }
      };
    }
    if (!response.body) finalize();
    return response;
  } catch (error) {
    finalize();
    if (timedOut && !parentSignal?.aborted) {
      throw new ApiError(504, "UPSTREAM_TIMEOUT", `Upstream request timed out after ${timeoutMs} ms.`);
    }
    throw error;
  }
}

function readJsonBody(req, { maxBytes = 1_000_000 } = {}) {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers["content-type"] || "").toLowerCase();
    if (!contentType.startsWith("application/json")) {
      reject(new ApiError(415, "CONTENT_TYPE_REQUIRED", "Content-Type must be application/json."));
      req.resume();
      return;
    }
    const contentLength = Number(req.headers["content-length"] || 0);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      reject(new ApiError(413, "REQUEST_BODY_TOO_LARGE", `Request body must not exceed ${maxBytes} bytes.`));
      req.resume();
      return;
    }

    const chunks = [];
    let bytes = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        settled = true;
        reject(new ApiError(413, "REQUEST_BODY_TOO_LARGE", `Request body must not exceed ${maxBytes} bytes.`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const parsed = raw ? JSON.parse(raw) : {};
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new ApiError(400, "JSON_OBJECT_REQUIRED", "Request JSON must be an object.");
        }
        resolve(parsed);
      } catch (error) {
        reject(error instanceof ApiError ? error : new ApiError(400, "INVALID_JSON", "Request body is not valid JSON."));
      }
    });
    req.on("error", (error) => {
      if (!settled) reject(error);
    });
  });
}

function validateIdempotencyKey(value, { required = false } = {}) {
  const key = String(value || "").trim();
  if (!key && !required) return "";
  if (!key) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required.");
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new ApiError(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must be 8-128 safe ASCII characters.");
  }
  return key;
}

class IdempotencyStore {
  constructor({ ttlMs = 10 * 60 * 1000, maxEntries = 1000 } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  async run(scope, key, fingerprint, operation) {
    const now = Date.now();
    this.prune(now);
    const storageKey = `${scope}:${key}`;
    const existing = this.entries.get(storageKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency-Key was already used with a different request.");
      }
      return { value: await existing.promise, replayed: true };
    }
    const promise = Promise.resolve().then(operation);
    this.entries.set(storageKey, { fingerprint, promise, expiresAt: now + this.ttlMs });
    try {
      return { value: await promise, replayed: false };
    } catch (error) {
      this.entries.delete(storageKey);
      throw error;
    }
  }

  prune(now = Date.now()) {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
  }
}

module.exports = {
  ApiError,
  IdempotencyStore,
  fetchWithTimeout,
  readJsonBody,
  validateIdempotencyKey
};
