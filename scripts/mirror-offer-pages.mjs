import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const root = process.cwd();
const sourceOrigin = "https://ofertafit.com";
const sourceHost = new URL(sourceOrigin).hostname;
const capturedDir = path.join(root, "captured", "offer-pages");
const originalsDir = path.join(capturedDir, "originals");
const assetsDir = path.join(root, "offer-assets");

const pages = [
  {
    route: "acelerador",
    sourceUrl: "https://ofertafit.com/sjt-upsell-1-b/",
    originalFile: "acelerador.html",
  },
  {
    route: "ofertaespecial",
    sourceUrl: "https://ofertafit.com/sjt-downsell-1-b/",
    originalFile: "ofertaespecial.html",
  },
];

const checkoutLinks = {
  upsell: "https://pay.cakto.com.br/354fsst_890464",
  upsellReject: "https://secajejum.info/ofertaespecial",
  downsell: "https://pay.cakto.com.br/34x5vvy",
  downsellReject: "https://www.cakto.com.br/",
};

const assetMap = new Map();
const assetRecords = new Map();
const pendingAssets = [];
const seenAssets = new Set();

function sha1(input) {
  return createHash("sha1").update(input).digest("hex").slice(0, 10);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function checkoutPath(checkoutUrl) {
  return new URL(checkoutUrl).pathname.replace(/^\/+/, "");
}

function decodeHtmlEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&#038;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#039;", "'")
    .replaceAll("&apos;", "'");
}

function normalizeText(text) {
  return text.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "");
}

function normalizeAssetUrl(raw, baseUrl) {
  if (!raw) return null;
  const cleaned = decodeHtmlEntities(String(raw).trim()).replace(/^["']|["']$/g, "");
  if (
    !cleaned ||
    cleaned.startsWith("#") ||
    cleaned.startsWith("data:") ||
    cleaned.startsWith("blob:") ||
    cleaned.startsWith("mailto:") ||
    cleaned.startsWith("tel:") ||
    cleaned.startsWith("javascript:")
  ) {
    return null;
  }

  try {
    const url = new URL(cleaned, baseUrl);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function isSameSiteAsset(assetUrl) {
  const url = new URL(assetUrl);
  if (url.hostname !== sourceHost && url.hostname !== `www.${sourceHost}`) return false;

  const pathname = url.pathname;
  if (pathname.startsWith("/wp-content/") || pathname.startsWith("/wp-includes/")) return true;
  return /\.(css|js|mjs|png|jpe?g|webp|gif|svg|ico|woff2?|ttf|otf|eot|json|mp4|webm)$/i.test(pathname);
}

function localAssetInfo(assetUrl) {
  const url = new URL(assetUrl);
  const pathname = url.pathname.replace(/^\/+/, "") || "index";
  const ext = path.extname(pathname);
  const withQueryHash = url.search && ext
    ? pathname.slice(0, -ext.length) + `.${sha1(url.search)}` + ext
    : pathname + (url.search ? `.${sha1(url.search)}` : "");
  const filePath = path.join(assetsDir, url.hostname, ...withQueryHash.split("/"));
  const publicPath = `/${path.relative(root, filePath).replaceAll(path.sep, "/")}`;
  return { filePath, publicPath };
}

function enqueueAsset(raw, baseUrl, from) {
  const assetUrl = normalizeAssetUrl(raw, baseUrl);
  if (!assetUrl || !isSameSiteAsset(assetUrl) || seenAssets.has(assetUrl)) return null;

  const info = localAssetInfo(assetUrl);
  seenAssets.add(assetUrl);
  assetMap.set(assetUrl, info.publicPath);
  pendingAssets.push({ assetUrl, ...info, from });
  return assetUrl;
}

function extractUrlsFromSrcset(srcset) {
  return srcset
    .split(",")
    .map((item) => item.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function enqueueHtmlAssets(html, pageUrl) {
  const attrRe = /\b(?:src|href|poster|content|data-src|data-lazy-src|data-background|data-bg)=["']([^"']+)["']/gi;
  const srcsetRe = /\b(?:srcset|data-srcset)=["']([^"']+)["']/gi;
  const urlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  let match;

  while ((match = attrRe.exec(html))) enqueueAsset(match[1], pageUrl, pageUrl);
  while ((match = srcsetRe.exec(html))) {
    for (const src of extractUrlsFromSrcset(match[1])) enqueueAsset(src, pageUrl, pageUrl);
  }
  while ((match = urlRe.exec(html))) enqueueAsset(match[2], pageUrl, pageUrl);
}

function enqueueCssAssets(css, cssUrl) {
  const urlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  const importRe = /@import\s+(?:url\()?["']?([^"')\s]+)["']?\)?/gi;
  let match;

  while ((match = urlRe.exec(css))) enqueueAsset(match[2], cssUrl, cssUrl);
  while ((match = importRe.exec(css))) enqueueAsset(match[1], cssUrl, cssUrl);
}

function replaceAllVariants(text, originalUrl, replacement) {
  const url = new URL(originalUrl);
  const variants = unique([
    originalUrl,
    originalUrl.replaceAll("&", "&amp;"),
    originalUrl.replaceAll("&", "&#038;"),
    `${url.origin}${url.pathname}`,
    `${url.origin}${url.pathname}`.replaceAll("/", "\\/"),
  ]).sort((a, b) => b.length - a.length);

  let output = text;
  for (const variant of variants) {
    if (!variant) continue;
    output = output.split(variant).join(replacement);
  }

  const rootVariants = unique([
    `${url.pathname}${url.search}`,
    `${url.pathname}${url.search}`.replaceAll("&", "&amp;"),
    `${url.pathname}${url.search}`.replaceAll("&", "&#038;"),
  ]).sort((a, b) => b.length - a.length);

  for (const variant of rootVariants) {
    if (!variant) continue;
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    output = output.replace(new RegExp(`(^|["'(=\\s,])${escaped}`, "g"), `$1${replacement}`);
  }

  return output;
}

function rewriteAssets(text) {
  let output = text;
  const entries = [...assetMap.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [assetUrl, localPath] of entries) output = replaceAllVariants(output, assetUrl, localPath);
  return output;
}

function rewriteRoutes(html) {
  const routePairs = [
    ["https://ofertafit.com/sjt-upsell-1-b/", "/acelerador/"],
    ["https://ofertafit.com/sjt-upsell-1-b", "/acelerador/"],
    ["https:\\/\\/ofertafit.com\\/sjt-upsell-1-b\\/", "\\/acelerador\\/"],
    ["https:\\/\\/ofertafit.com\\/sjt-upsell-1-b", "\\/acelerador\\/"],
    ["/sjt-upsell-1-b/", "/acelerador/"],
    ["/sjt-upsell-1-b", "/acelerador/"],
    ["https://ofertafit.com/sjt-downsell-1-b/", "/ofertaespecial/"],
    ["https://ofertafit.com/sjt-downsell-1-b", "/ofertaespecial/"],
    ["https:\\/\\/ofertafit.com\\/sjt-downsell-1-b\\/", "\\/ofertaespecial\\/"],
    ["https:\\/\\/ofertafit.com\\/sjt-downsell-1-b", "\\/ofertaespecial\\/"],
    ["/sjt-downsell-1-b/", "/ofertaespecial/"],
    ["/sjt-downsell-1-b", "/ofertaespecial/"],
  ];

  let output = html;
  for (const [from, to] of routePairs) output = output.split(from).join(to);

  output = output.replace(
    /(<cakto-upsell-reject\b[^>]*\bupsell-reject-url=)["'][^"']*["']([^>]*>\s*Não,\s*não\s*quero\s*acelerar\s*meu\s*emagrecimento)/i,
    `$1"${checkoutLinks.upsellReject}"$2`,
  );

  return output;
}

function setAttr(tag, name, value) {
  const escaped = value.replaceAll("&", "&amp;");
  const attrRe = new RegExp(`\\b${name}=(["'])[^"']*\\1`, "i");
  if (attrRe.test(tag)) return tag.replace(attrRe, `${name}="${escaped}"`);
  return tag.replace(/>$/, ` ${name}="${escaped}">`);
}

function patchCaktoButtons(html, { acceptUrl, rejectUrl, offerId }) {
  return html
    .replace(/<cakto-upsell-accept\b[^>]*>/gi, (tag) => {
      let patched = setAttr(tag, "upsell-accept-url", acceptUrl);
      patched = setAttr(patched, "upsell-reject-url", rejectUrl);
      patched = setAttr(patched, "offer-id", offerId);
      return patched;
    })
    .replace(/<cakto-upsell-reject\b[^>]*>/gi, (tag) => setAttr(tag, "upsell-reject-url", rejectUrl));
}

function applyCheckoutOverrides(html, route) {
  if (route === "acelerador") {
    return patchCaktoButtons(html, {
      acceptUrl: checkoutLinks.upsell,
      rejectUrl: checkoutLinks.upsellReject,
      offerId: checkoutPath(checkoutLinks.upsell),
    });
  }

  if (route === "ofertaespecial") {
    return patchCaktoButtons(html, {
      acceptUrl: checkoutLinks.downsell,
      rejectUrl: checkoutLinks.downsellReject,
      offerId: checkoutPath(checkoutLinks.downsell),
    });
  }

  return html;
}

function upsertHeadSnippet(html, id, snippet) {
  const pattern = new RegExp(`\\n?<style id="${id}">[\\s\\S]*?<\\/style>\\n?`, "g");
  const cleaned = html.replace(pattern, "\n");
  return cleaned.includes("</head>")
    ? cleaned.replace("</head>", `${snippet}\n</head>`)
    : `${snippet}\n${cleaned}`;
}

function upsertBodyScript(html, id, script) {
  const pattern = new RegExp(`\\n?<script id="${id}">[\\s\\S]*?<\\/script>\\n?`, "g");
  const cleaned = html.replace(pattern, "\n");
  return cleaned.includes("</body>")
    ? cleaned.replace("</body>", `${script}\n</body>`)
    : `${cleaned}\n${script}\n`;
}

function checkoutOverrideScript({ acceptUrl, rejectUrl }) {
  return `<script id="checkout-link-override">
(function () {
  var acceptUrl = "${acceptUrl}";
  var rejectUrl = "${rejectUrl}";

  function findCaktoHost(event, tagName) {
    var path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (var index = 0; index < path.length; index += 1) {
      var node = path[index];
      if (node && node.tagName === tagName) return node;
    }
    return event.target && event.target.closest ? event.target.closest(tagName.toLowerCase()) : null;
  }

  document.addEventListener("click", function (event) {
    var accept = findCaktoHost(event, "CAKTO-UPSELL-ACCEPT");
    var reject = findCaktoHost(event, "CAKTO-UPSELL-REJECT");
    var nextUrl = accept ? acceptUrl : reject ? rejectUrl : "";
    if (!nextUrl) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    window.location.href = nextUrl;
  }, true);
})();
</script>`;
}

function mobileTrustBadgeFixStyle() {
  return `<style id="mobile-trust-badge-fix">
@media (max-width: 767px) {
  .elementor-690 .elementor-element.elementor-element-61f40e2 {
    background: #fff !important;
    margin-bottom: 16px !important;
    position: relative;
    z-index: 2;
  }

  .elementor-690 .elementor-element.elementor-element-61f40e2 .elementor-widget-container,
  .elementor-690 .elementor-element.elementor-element-61f40e2 img {
    background: #fff !important;
  }

  .elementor-690 .elementor-element.elementor-element-c747981 {
    margin-top: 8px !important;
    position: relative;
    z-index: 1;
  }
}
</style>`;
}

function injectLocalRoutingPatch(html, route) {
  if (route !== "acelerador") return html;
  const patch = `
<script>
(function () {
  function patchRejectButtons() {
    document.querySelectorAll("cakto-upsell-reject").forEach(function (button) {
      var text = (button.textContent || "").toLowerCase();
      if (text.indexOf("não, não quero acelerar") !== -1) {
        button.setAttribute("upsell-reject-url", "${checkoutLinks.upsellReject}");
      }
    });
  }

  document.addEventListener("DOMContentLoaded", patchRejectButtons);
  patchRejectButtons();
})();
</script>`;

  return html.includes("</body>")
    ? html.replace("</body>", `${patch}\n</body>`)
    : `${html}\n${patch}\n`;
}

async function fetchBuffer(url) {
  const response = await fetch(url, {
    headers: {
      accept: "*/*",
      "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "",
    finalUrl: response.url,
  };
}

async function downloadQueuedAssets() {
  for (let index = 0; index < pendingAssets.length; index += 1) {
    const item = pendingAssets[index];
    const record = {
      url: item.assetUrl,
      localPath: path.relative(root, item.filePath).replaceAll(path.sep, "/"),
      from: item.from,
      ok: false,
      contentType: null,
      bytes: 0,
      error: null,
    };

    try {
      const { buffer, contentType } = await fetchBuffer(item.assetUrl);
      await mkdir(path.dirname(item.filePath), { recursive: true });

      let body = buffer;
      const ext = path.extname(new URL(item.assetUrl).pathname).toLowerCase();
      const isCss = contentType.includes("text/css") || ext === ".css";
      if (isCss) {
        const css = buffer.toString("utf8");
        enqueueCssAssets(css, item.assetUrl);
        body = Buffer.from(rewriteAssets(css), "utf8");
      }

      await writeFile(item.filePath, body);
      record.ok = true;
      record.contentType = contentType;
      record.bytes = body.length;
    } catch (error) {
      record.error = error.message;
    }

    assetRecords.set(item.assetUrl, record);
  }
}

async function writePage(page, originalHtml) {
  let html = rewriteRoutes(originalHtml);
  html = rewriteAssets(html);
  html = applyCheckoutOverrides(html, page.route);
  html = injectLocalRoutingPatch(html, page.route);
  if (page.route === "acelerador") {
    html = upsertHeadSnippet(html, "mobile-trust-badge-fix", mobileTrustBadgeFixStyle());
    html = upsertBodyScript(html, "checkout-link-override", checkoutOverrideScript({
      acceptUrl: checkoutLinks.upsell,
      rejectUrl: checkoutLinks.upsellReject,
    }));
  }
  if (page.route === "ofertaespecial") {
    html = upsertBodyScript(html, "checkout-link-override", checkoutOverrideScript({
      acceptUrl: checkoutLinks.downsell,
      rejectUrl: checkoutLinks.downsellReject,
    }));
  }
  html = normalizeText(html);
  const outFile = path.join(root, page.route, "index.html");
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, html);
}

async function main() {
  await mkdir(originalsDir, { recursive: true });

  const fetchedPages = [];
  for (const page of pages) {
    const { buffer, finalUrl } = await fetchBuffer(page.sourceUrl);
    const html = normalizeText(buffer.toString("utf8"));
    await writeFile(path.join(originalsDir, page.originalFile), html);
    enqueueHtmlAssets(html, finalUrl);
    fetchedPages.push({ page, html, finalUrl });
  }

  await downloadQueuedAssets();

  for (const { page, html } of fetchedPages) await writePage(page, html);

  const manifest = {
    capturedAt: new Date().toISOString(),
    pages: fetchedPages.map(({ page, finalUrl, html }) => ({
      route: `/${page.route}/`,
      sourceUrl: page.sourceUrl,
      finalUrl,
      originalPath: path.relative(root, path.join(originalsDir, page.originalFile)).replaceAll(path.sep, "/"),
      outputPath: `${page.route}/index.html`,
      bytes: html.length,
    })),
    assets: [...assetRecords.values()],
    rewrites: [
      "Rewrote ofertafit.com WordPress/Elementor asset URLs to /offer-assets/.",
      "Rewrote upsell/downsell page links to /acelerador/ and /ofertaespecial/.",
      "Forced the upsell rejection button for accelerating weight loss to /ofertaespecial/.",
    ],
  };

  await writeFile(path.join(capturedDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(JSON.stringify({
    pages: manifest.pages.length,
    assets: manifest.assets.length,
    downloaded: manifest.assets.filter((asset) => asset.ok).length,
    failed: manifest.assets.filter((asset) => !asset.ok).length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
