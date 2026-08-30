const dns = require("node:dns");
const net = require("node:net");
const path = require("node:path");
const { ApiError } = require("./api-safety");

const MAX_REDIRECTS = 3;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_MATERIALS = 3;
const MAX_MATERIAL_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_MATERIAL_BYTES = 10 * 1024 * 1024;

const MATERIAL_TYPES = Object.freeze({
  "image/jpeg": { extension: ".jpg", matches: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  "image/png": {
    extension: ".png",
    matches: (buffer) => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  },
  "image/webp": {
    extension: ".webp",
    matches: (buffer) => buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP"
  },
  "application/pdf": { extension: ".pdf", matches: (buffer) => buffer.length >= 5 && buffer.toString("ascii", 0, 5) === "%PDF-" }
});

function sourceError(statusCode, code, message) {
  return new ApiError(statusCode, code, message);
}

function ipv4ToNumber(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts.reduce((value, part) => ((value << 8) | part) >>> 0, 0);
}

function ipv6ToBigInt(address) {
  let normalized = String(address).toLowerCase().split("%")[0];
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    const ipv4 = ipv4ToNumber(normalized.slice(lastColon + 1));
    if (ipv4 === null) return null;
    normalized = `${normalized.slice(0, lastColon)}:${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  if ((normalized.match(/::/g) || []).length > 1) return null;
  const halves = normalized.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const omitted = 8 - left.length - right.length;
  if ((halves.length === 1 && omitted !== 0) || omitted < 0) return null;
  const parts = halves.length === 2 ? [...left, ...Array(omitted).fill("0"), ...right] : left;
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.reduce((value, part) => (value << 16n) | BigInt(parseInt(part, 16)), 0n);
}

function ipv6InRange(value, prefix, bits) {
  const shift = 128n - BigInt(bits);
  return value >> shift === prefix >> shift;
}

function isBlockedIpv4(address) {
  const value = ipv4ToNumber(address);
  if (value === null) return true;
  const inRange = (base, bits) => {
    const baseValue = ipv4ToNumber(base);
    return bits === 0 || value >>> (32 - bits) === baseValue >>> (32 - bits);
  };
  return [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4]
  ].some(([base, bits]) => inRange(base, bits));
}

function isBlockedIpv6(address) {
  const value = ipv6ToBigInt(address);
  if (value === null) return true;
  const prefix = (text) => ipv6ToBigInt(text);

  if (ipv6InRange(value, prefix("::ffff:0:0"), 96)) {
    return isBlockedIpv4([
      Number((value >> 24n) & 0xffn),
      Number((value >> 16n) & 0xffn),
      Number((value >> 8n) & 0xffn),
      Number(value & 0xffn)
    ].join("."));
  }
  if (ipv6InRange(value, prefix("64:ff9b::"), 96)) {
    return isBlockedIpv4([
      Number((value >> 24n) & 0xffn),
      Number((value >> 16n) & 0xffn),
      Number((value >> 8n) & 0xffn),
      Number(value & 0xffn)
    ].join("."));
  }

  return [
    ["::", 128],
    ["::1", 128],
    ["64:ff9b:1::", 48],
    ["100::", 64],
    ["2001::", 32],
    ["2001:2::", 48],
    ["2001:10::", 28],
    ["2001:20::", 28],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8]
  ].some(([base, bits]) => ipv6InRange(value, prefix(base), bits));
}

function isBlockedIpAddress(address) {
  const family = net.isIP(String(address || "").split("%")[0]);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
}

function normalizeLookupResults(result) {
  const values = Array.isArray(result) ? result : [result];
  return values
    .map((entry) => typeof entry === "string" ? entry : entry?.address)
    .filter(Boolean);
}

async function validateCompanySourceUrl(value, { lookup = dns.promises.lookup } = {}) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw sourceError(400, "INVALID_COMPANY_SOURCE_URL", "Company source URL must be a valid HTTP or HTTPS URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw sourceError(400, "UNSUPPORTED_COMPANY_SOURCE_PROTOCOL", "Company source URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw sourceError(400, "COMPANY_SOURCE_USERINFO_FORBIDDEN", "Company source URL must not include user information.");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "local" ||
    hostname.endsWith(".local") ||
    hostname === "metadata.google.internal" ||
    hostname.endsWith(".metadata.google.internal")
  ) {
    throw sourceError(400, "BLOCKED_COMPANY_SOURCE_HOST", "Company source host is not allowed.");
  }

  if (net.isIP(hostname)) {
    if (isBlockedIpAddress(hostname)) {
      throw sourceError(400, "BLOCKED_COMPANY_SOURCE_ADDRESS", "Company source resolves to a non-public address.");
    }
    return url;
  }

  let lookupResult;
  try {
    lookupResult = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw sourceError(400, "COMPANY_SOURCE_DNS_FAILED", "Company source host could not be resolved.");
  }
  const addresses = normalizeLookupResults(lookupResult);
  if (!addresses.length) {
    throw sourceError(400, "COMPANY_SOURCE_DNS_FAILED", "Company source host did not resolve to an address.");
  }
  if (addresses.some(isBlockedIpAddress)) {
    throw sourceError(400, "BLOCKED_COMPANY_SOURCE_ADDRESS", "Company source resolves to a non-public address.");
  }
  return url;
}

async function readLimitedBody(response, maxBytes) {
  const chunks = [];
  let bytes = 0;
  const append = (chunk) => {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) {
      throw sourceError(413, "COMPANY_SOURCE_TOO_LARGE", `Company source body must not exceed ${maxBytes} bytes.`);
    }
    chunks.push(buffer);
  };

  if (response.body?.getReader) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        append(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    }
  } else if (response.body?.[Symbol.asyncIterator]) {
    for await (const chunk of response.body) append(chunk);
  } else {
    append(await response.arrayBuffer());
  }
  return { buffer: Buffer.concat(chunks), bytes };
}

async function fetchCompanySource(value, {
  fetch: fetchImpl = globalThis.fetch,
  lookup = dns.promises.lookup,
  maxRedirects = MAX_REDIRECTS,
  maxBytes = MAX_SOURCE_BYTES,
  fetchOptions = {}
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw sourceError(500, "COMPANY_SOURCE_FETCH_UNAVAILABLE", "A fetch implementation is required.");
  }
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > MAX_REDIRECTS) {
    throw sourceError(500, "INVALID_COMPANY_SOURCE_CONFIGURATION", `maxRedirects must be between 0 and ${MAX_REDIRECTS}.`);
  }

  let currentUrl = await validateCompanySourceUrl(value, { lookup });
  const normalizedHostname = (url) => url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const originalHostname = normalizedHostname(currentUrl);
  let redirects = 0;

  while (true) {
    let response;
    try {
      response = await fetchImpl(currentUrl.toString(), {
        ...fetchOptions,
        method: "GET",
        redirect: "manual",
        headers: {
          Accept: "text/html, text/plain;q=0.9",
          "User-Agent": "Grafana-Dashboard-Builder-Company-Analyzer/1.0",
          ...(fetchOptions.headers || {})
        }
      });
    } catch (error) {
      const timedOut = error?.name === "AbortError" || /timed?\s*out|aborted/i.test(String(error?.message || ""));
      throw sourceError(
        502,
        timedOut ? "COMPANY_SOURCE_TIMEOUT" : "COMPANY_SOURCE_NETWORK_ERROR",
        timedOut
          ? "Company source request timed out. Check the site response and outbound network settings."
          : "Company source could not be reached. Check outbound network, proxy, firewall, and TLS settings."
      );
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw sourceError(502, "COMPANY_SOURCE_INVALID_REDIRECT", "Company source redirect is missing a Location header.");
      if (redirects >= maxRedirects) {
        throw sourceError(502, "COMPANY_SOURCE_REDIRECT_LIMIT", `Company source exceeded ${maxRedirects} redirects.`);
      }
      const nextUrl = await validateCompanySourceUrl(new URL(location, currentUrl).toString(), { lookup });
      if (normalizedHostname(nextUrl) !== originalHostname) {
        throw sourceError(400, "COMPANY_SOURCE_CROSS_HOST_REDIRECT", "Company source redirects must remain on the original host.");
      }
      if (currentUrl.protocol === "https:" && nextUrl.protocol === "http:") {
        throw sourceError(400, "COMPANY_SOURCE_HTTPS_DOWNGRADE", "Company source must not redirect from HTTPS to HTTP.");
      }
      currentUrl = nextUrl;
      redirects += 1;
      continue;
    }

    if (!response.ok) {
      throw sourceError(502, "COMPANY_SOURCE_FETCH_FAILED", `Company source returned HTTP ${response.status}.`);
    }
    const contentTypeHeader = String(response.headers.get("content-type") || "");
    const contentType = contentTypeHeader.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "text/html" && contentType !== "text/plain") {
      throw sourceError(415, "UNSUPPORTED_COMPANY_SOURCE_TYPE", "Company source must be text/html or text/plain.");
    }
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw sourceError(413, "COMPANY_SOURCE_TOO_LARGE", `Company source body must not exceed ${maxBytes} bytes.`);
    }
    const { buffer, bytes } = await readLimitedBody(response, maxBytes);
    const rawText = decodeTextBuffer(buffer, contentTypeHeader);
    return {
      url: currentUrl.toString(),
      contentType,
      bytes,
      text: contentType === "text/html" ? htmlToPlainText(rawText) : rawText.replace(/\s+/g, " ").trim()
    };
  }
}

function decodeTextBuffer(buffer, contentTypeHeader) {
  const charsetMatch = String(contentTypeHeader || "").match(/charset\s*=\s*["']?([^;\s"']+)/i);
  const declared = String(charsetMatch?.[1] || "utf-8").toLowerCase();
  const aliases = {
    "utf8": "utf-8",
    "shift-jis": "shift_jis",
    "shift_jis": "shift_jis",
    "sjis": "shift_jis",
    "windows-31j": "shift_jis",
    "ms932": "shift_jis",
    "cp932": "shift_jis",
    "euc_jp": "euc-jp"
  };
  try {
    return new TextDecoder(aliases[declared] || declared).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

function decodeHtmlEntities(value) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, (match, entity) => {
    if (entity[0] !== "#") return named[entity.toLowerCase()] ?? match;
    const radix = entity[1].toLowerCase() === "x" ? 16 : 10;
    const digits = radix === 16 ? entity.slice(2) : entity.slice(1);
    const codePoint = Number.parseInt(digits, radix);
    return Number.isInteger(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : "";
  });
}

function htmlToPlainText(html) {
  let text = String(html || "");
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/<(script|style|noscript|form|svg|template|iframe|object|embed|canvas)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  text = text.replace(/<(script|style|noscript|form|svg|template|iframe|object|embed|canvas)\b[^>]*\/?>/gi, " ");
  text = text.replace(/<(br|hr)\b[^>]*\/?>/gi, "\n");
  text = text.replace(/<\/(p|div|section|article|header|footer|main|aside|nav|h[1-6]|li|tr|table|ul|ol)>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(text)
    .replace(/\r/g, "")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeStrictBase64(value) {
  const compact = String(value || "").replace(/\r?\n/g, "");
  const paddingStart = compact.indexOf("=");
  const dataPart = paddingStart === -1 ? compact : compact.slice(0, paddingStart);
  const padding = paddingStart === -1 ? "" : compact.slice(paddingStart);
  if (
    !compact ||
    compact.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*$/.test(dataPart) ||
    (padding !== "=" && padding !== "==" && padding !== "")
  ) {
    throw sourceError(400, "INVALID_COMPANY_MATERIAL_BASE64", "Company material data must be valid base64.");
  }
  const buffer = Buffer.from(compact, "base64");
  if (buffer.toString("base64") !== compact) {
    throw sourceError(400, "INVALID_COMPANY_MATERIAL_BASE64", "Company material data must be canonical base64.");
  }
  return { buffer, base64: compact };
}

function safeMaterialFileName(value, extension, index) {
  const original = path.basename(String(value || `material-${index + 1}`)).normalize("NFKC");
  let stem = original.replace(/\.[^.]*$/, "").replace(/[^\p{L}\p{N}._ -]+/gu, "-").replace(/[ ._-]+$/g, "").slice(0, 72);
  if (!stem || stem === "." || stem === "..") stem = `material-${index + 1}`;
  return `${stem}${extension}`;
}

function validateCompanyMaterials(materials) {
  if (materials === undefined || materials === null) return [];
  if (!Array.isArray(materials)) {
    throw sourceError(400, "INVALID_COMPANY_MATERIALS", "Company materials must be an array.");
  }
  if (materials.length > MAX_MATERIALS) {
    throw sourceError(400, "TOO_MANY_COMPANY_MATERIALS", `At most ${MAX_MATERIALS} company materials are allowed.`);
  }

  let totalBytes = 0;
  return materials.map((material, index) => {
    if (!material || typeof material !== "object" || Array.isArray(material)) {
      throw sourceError(400, "INVALID_COMPANY_MATERIAL", `Company material ${index + 1} must be an object.`);
    }
    let mimeType = String(material.mimeType || material.type || "").split(";", 1)[0].trim().toLowerCase();
    let encoded = material.base64 ?? material.dataBase64 ?? material.data;
    const dataUrlMatch = typeof encoded === "string" ? encoded.match(/^data:([^;,]+);base64,(.*)$/s) : null;
    if (dataUrlMatch) {
      const dataUrlType = dataUrlMatch[1].toLowerCase();
      if (mimeType && mimeType !== dataUrlType) {
        throw sourceError(400, "COMPANY_MATERIAL_MIME_MISMATCH", `Company material ${index + 1} MIME type does not match its data URL.`);
      }
      mimeType = dataUrlType;
      encoded = dataUrlMatch[2];
    }
    const type = MATERIAL_TYPES[mimeType];
    if (!type) {
      throw sourceError(415, "UNSUPPORTED_COMPANY_MATERIAL_TYPE", `Company material ${index + 1} must be JPEG, PNG, WebP, or PDF.`);
    }
    const { buffer, base64 } = decodeStrictBase64(encoded);
    if (buffer.length > MAX_MATERIAL_BYTES) {
      throw sourceError(413, "COMPANY_MATERIAL_TOO_LARGE", `Each company material must not exceed ${MAX_MATERIAL_BYTES} bytes.`);
    }
    totalBytes += buffer.length;
    if (totalBytes > MAX_TOTAL_MATERIAL_BYTES) {
      throw sourceError(413, "COMPANY_MATERIALS_TOO_LARGE", `Company materials must not exceed ${MAX_TOTAL_MATERIAL_BYTES} bytes in total.`);
    }
    if (!type.matches(buffer)) {
      throw sourceError(400, "COMPANY_MATERIAL_MIME_MISMATCH", `Company material ${index + 1} content does not match ${mimeType}.`);
    }
    return {
      fileName: safeMaterialFileName(material.fileName || material.name, type.extension, index),
      mimeType,
      base64,
      sizeBytes: buffer.length
    };
  });
}

module.exports = {
  validateCompanySourceUrl,
  isBlockedIpAddress,
  fetchCompanySource,
  validateCompanyMaterials,
  htmlToPlainText,
  decodeTextBuffer
};
