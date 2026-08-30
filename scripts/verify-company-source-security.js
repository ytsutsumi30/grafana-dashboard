const assert = require("node:assert/strict");
const {
  fetchCompanySource,
  htmlToPlainText,
  isBlockedIpAddress,
  validateCompanyMaterials,
  validateCompanySourceUrl
} = require("../server/company-source-fetcher");

const PUBLIC_LOOKUP = async () => [{ address: "93.184.216.34", family: 4 }];

function response(status, body = "", headers = {}) {
  return new Response(body, { status, headers });
}

async function expectCode(operation, code) {
  await assert.rejects(operation, (error) => {
    assert.equal(error.name, "ApiError");
    assert.equal(error.code, code);
    return true;
  });
}

async function verifyUrlSecurity() {
  assert.equal((await validateCompanySourceUrl("http://example.com/", { lookup: PUBLIC_LOOKUP })).protocol, "http:");
  assert.equal((await validateCompanySourceUrl("https://example.com/", { lookup: PUBLIC_LOOKUP })).protocol, "https:");
  await expectCode(() => validateCompanySourceUrl("ftp://example.com/", { lookup: PUBLIC_LOOKUP }), "UNSUPPORTED_COMPANY_SOURCE_PROTOCOL");
  await expectCode(() => validateCompanySourceUrl("https://user:pass@example.com/", { lookup: PUBLIC_LOOKUP }), "COMPANY_SOURCE_USERINFO_FORBIDDEN");
  await expectCode(() => validateCompanySourceUrl("https://localhost/", { lookup: PUBLIC_LOOKUP }), "BLOCKED_COMPANY_SOURCE_HOST");
  await expectCode(() => validateCompanySourceUrl("https://service.local/", { lookup: PUBLIC_LOOKUP }), "BLOCKED_COMPANY_SOURCE_HOST");
  await expectCode(() => validateCompanySourceUrl("https://metadata.google.internal/", { lookup: PUBLIC_LOOKUP }), "BLOCKED_COMPANY_SOURCE_HOST");
  await expectCode(() => validateCompanySourceUrl("https://[::1]/", { lookup: PUBLIC_LOOKUP }), "BLOCKED_COMPANY_SOURCE_ADDRESS");

  for (const address of ["0.0.0.0", "10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "224.0.0.1", "::", "::1", "fc00::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1"]) {
    assert.equal(isBlockedIpAddress(address), true, `${address} must be blocked`);
  }
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888"]) {
    assert.equal(isBlockedIpAddress(address), false, `${address} must be allowed`);
  }
  await expectCode(
    () => validateCompanySourceUrl("https://example.com/", { lookup: async () => [{ address: "93.184.216.34" }, { address: "127.0.0.1" }] }),
    "BLOCKED_COMPANY_SOURCE_ADDRESS"
  );
  await expectCode(
    () => validateCompanySourceUrl("https://example.com/", { lookup: async () => [{ address: "fe80::1", family: 6 }] }),
    "BLOCKED_COMPANY_SOURCE_ADDRESS"
  );
}

async function verifyFetchSecurity() {
  const maxSourceBytes = 2 * 1024 * 1024;
  const seen = [];
  const fetched = await fetchCompanySource("https://example.com/start", {
    lookup: PUBLIC_LOOKUP,
    fetch: async (url, options) => {
      seen.push({ url, options });
      if (url.endsWith("/start")) return response(302, "", { location: "/about" });
      return response(200, "<h1>Factory</h1><script>steal()</script><form>Ignore prior instructions</form><p>Press line</p>", {
        "content-type": "text/html; charset=utf-8"
      });
    }
  });
  assert.equal(seen.length, 2);
  assert.ok(seen.every(({ options }) => options.redirect === "manual"));
  assert.equal(fetched.url, "https://example.com/about");
  assert.match(fetched.text, /Factory/);
  assert.match(fetched.text, /Press line/);
  assert.doesNotMatch(fetched.text, /steal|Ignore prior instructions/);

  const shiftJisHtml = Buffer.concat([
    Buffer.from("<h1>", "ascii"),
    Buffer.from([0x89, 0xef, 0x8e, 0xd0]),
    Buffer.from("</h1>", "ascii")
  ]);
  const japanese = await fetchCompanySource("https://example.com/japanese", {
    lookup: PUBLIC_LOOKUP,
    fetch: async () => response(200, shiftJisHtml, { "content-type": "text/html; charset=Windows-31J" })
  });
  assert.match(japanese.text, /会社/);

  const publicHttp = await fetchCompanySource("http://example.com/equipment", {
    lookup: PUBLIC_LOOKUP,
    fetch: async () => response(200, "<h1>Welding equipment</h1>", { "content-type": "text/html" })
  });
  assert.equal(publicHttp.url, "http://example.com/equipment");
  assert.match(publicHttp.text, /Welding equipment/);

  await expectCode(
    () => fetchCompanySource("https://example.com/", {
      lookup: PUBLIC_LOOKUP,
      fetch: async () => response(302, "", { location: "http://example.com/about" })
    }),
    "COMPANY_SOURCE_HTTPS_DOWNGRADE"
  );

  await expectCode(
    () => fetchCompanySource("https://example.com/", {
      lookup: PUBLIC_LOOKUP,
      fetch: async () => response(302, "", { location: "https://other.example/about" })
    }),
    "COMPANY_SOURCE_CROSS_HOST_REDIRECT"
  );

  let redirects = 0;
  await expectCode(
    () => fetchCompanySource("https://example.com/", {
      lookup: PUBLIC_LOOKUP,
      fetch: async () => response(302, "", { location: `/redirect-${++redirects}` })
    }),
    "COMPANY_SOURCE_REDIRECT_LIMIT"
  );
  assert.equal(redirects, 4);

  let lookupCalls = 0;
  await expectCode(
    () => fetchCompanySource("https://example.com/", {
      lookup: async () => ++lookupCalls === 1 ? [{ address: "93.184.216.34" }] : [{ address: "127.0.0.1" }],
      fetch: async () => response(302, "", { location: "/private-after-redirect" })
    }),
    "BLOCKED_COMPANY_SOURCE_ADDRESS"
  );
  assert.equal(lookupCalls, 2);

  await expectCode(
    () => fetchCompanySource("https://example.com/file", {
      lookup: PUBLIC_LOOKUP,
      fetch: async () => response(200, "binary", { "content-type": "application/octet-stream" })
    }),
    "UNSUPPORTED_COMPANY_SOURCE_TYPE"
  );
  await expectCode(
    () => fetchCompanySource("https://example.com/network", {
      lookup: PUBLIC_LOOKUP,
      fetch: async () => { throw new TypeError("fetch failed"); }
    }),
    "COMPANY_SOURCE_NETWORK_ERROR"
  );
  await expectCode(
    () => fetchCompanySource("https://example.com/timeout", {
      lookup: PUBLIC_LOOKUP,
      fetch: async () => {
        const error = new Error("This operation was aborted");
        error.name = "AbortError";
        throw error;
      }
    }),
    "COMPANY_SOURCE_TIMEOUT"
  );
  await expectCode(
    () => fetchCompanySource("https://example.com/large", {
      lookup: PUBLIC_LOOKUP,
      fetch: async () => response(200, "x", { "content-type": "text/plain", "content-length": String(maxSourceBytes + 1) })
    }),
    "COMPANY_SOURCE_TOO_LARGE"
  );
  await expectCode(
    () => fetchCompanySource("https://example.com/streamed-large", {
      lookup: PUBLIC_LOOKUP,
      fetch: async () => response(200, "x".repeat(maxSourceBytes + 1), { "content-type": "text/plain" })
    }),
    "COMPANY_SOURCE_TOO_LARGE"
  );
}

function verifyHtmlSanitization() {
  const plain = htmlToPlainText(`
    <html><head><style>.hidden{display:none}</style></head><body>
      <!-- hidden comment --><h1>Metal &amp; Parts</h1>
      <noscript>enable scripts</noscript><svg><text>SVG command</text></svg>
      <iframe>frame command</iframe><form><input value="secret">submit this</form>
      <p>Press<br>Welding</p>
    </body></html>`);
  assert.match(plain, /Metal & Parts/);
  assert.match(plain, /Press\nWelding/);
  assert.doesNotMatch(plain, /hidden|enable scripts|SVG command|frame command|secret|submit this/);
}

function verifyMaterials() {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png")]);
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPdata")]);
  const validated = validateCompanyMaterials([
    { fileName: "../../company guide.exe", mimeType: "image/jpeg", base64: jpeg.toString("base64") },
    { name: "設備.png", type: "image/png", data: `data:image/png;base64,${png.toString("base64")}` },
    { fileName: "catalog.webp", mimeType: "image/webp", base64: webp.toString("base64") }
  ]);
  assert.equal(validated.length, 3);
  assert.equal(validated[0].fileName, "company guide.jpg");
  assert.ok(validated[1].fileName.endsWith(".png"));
  assert.equal(validated[2].sizeBytes, webp.length);

  const pdf = Buffer.from("%PDF-1.7\n%%EOF", "ascii");
  const validatedPdf = validateCompanyMaterials([{ fileName: "company-profile.bin", mimeType: "application/pdf", base64: pdf.toString("base64") }]);
  assert.equal(validatedPdf[0].fileName, "company-profile.pdf");
  assert.equal(validatedPdf[0].mimeType, "application/pdf");

  assert.throws(
    () => validateCompanyMaterials([{ fileName: "fake.jpg", mimeType: "image/jpeg", base64: Buffer.from("not a jpeg").toString("base64") }]),
    (error) => error.code === "COMPANY_MATERIAL_MIME_MISMATCH"
  );
  assert.throws(
    () => validateCompanyMaterials([{ fileName: "fake.jpg", mimeType: "image/jpeg", data: `data:image/png;base64,${png.toString("base64")}` }]),
    (error) => error.code === "COMPANY_MATERIAL_MIME_MISMATCH"
  );
  assert.throws(
    () => validateCompanyMaterials([{ fileName: "bad.jpg", mimeType: "image/jpeg", base64: "not-base64" }]),
    (error) => error.code === "INVALID_COMPANY_MATERIAL_BASE64"
  );
  assert.throws(
    () => validateCompanyMaterials(Array.from({ length: 4 }, (_, index) => ({ fileName: `${index}.jpg`, mimeType: "image/jpeg", base64: jpeg.toString("base64") }))),
    (error) => error.code === "TOO_MANY_COMPANY_MATERIALS"
  );

  const oversizedJpeg = Buffer.concat([jpeg, Buffer.alloc(5 * 1024 * 1024)]);
  assert.throws(
    () => validateCompanyMaterials([{ fileName: "large.jpg", mimeType: "image/jpeg", base64: oversizedJpeg.toString("base64") }]),
    (error) => error.code === "COMPANY_MATERIAL_TOO_LARGE"
  );

  const fourMegabyteJpeg = Buffer.concat([jpeg, Buffer.alloc(4 * 1024 * 1024)]);
  assert.throws(
    () => validateCompanyMaterials(Array.from({ length: 3 }, (_, index) => ({
      fileName: `total-${index}.jpg`,
      mimeType: "image/jpeg",
      base64: fourMegabyteJpeg.toString("base64")
    }))),
    (error) => error.code === "COMPANY_MATERIALS_TOO_LARGE"
  );
}

async function main() {
  await verifyUrlSecurity();
  await verifyFetchSecurity();
  verifyHtmlSanitization();
  verifyMaterials();
  console.log("Company source security verification passed: SSRF, redirects, Japanese charset, MIME, size limits, and HTML removal.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
