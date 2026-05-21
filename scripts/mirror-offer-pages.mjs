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

const googleTagId = "AW-18172872375";
const googleTagManagerId = "GTM-TKB3KG6W";
const facebookPixelId = "1345365947541734";
const trustBadgeImage = "334d0cf4-fe39-481c-8377-5da3b8ebe9e6";
const opaqueTrustBadgeUrl = `/offer-assets/ofertafit.com/wp-content/uploads/2025/09/${trustBadgeImage}-white.webp`;

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
    return replaceOfferActions(html, {
      acceptUrl: checkoutLinks.upsell,
      rejectUrl: checkoutLinks.upsellReject,
      acceptText: "QUERO EMAGRECER 10X MAIS RÁPIDO!",
      rejectText: "Não, não quero acelerar meu emagrecimento",
    });
  }

  if (route === "ofertaespecial") {
    return replaceOfferActions(html, {
      acceptUrl: checkoutLinks.downsell,
      rejectUrl: checkoutLinks.downsellReject,
      acceptText: "QUERO DESBLOQUEAR TUDO COM 50% DE DESCONTO!",
      rejectText: "Não, não quero aproveitar essa última oportunidade.",
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

function googleTagSnippet() {
  return `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${googleTagId}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', '${googleTagId}');
</script>`;
}

function upsertGoogleTag(html) {
  if (
    html.includes(`https://www.googletagmanager.com/gtag/js?id=${googleTagId}`) ||
    html.includes(`gtag('config', '${googleTagId}')`)
  ) {
    return html;
  }

  return html.replace(/<head>/i, `<head>\n${googleTagSnippet()}\n`);
}

function googleTagManagerHeadSnippet() {
  return `<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${googleTagManagerId}');</script>
<!-- End Google Tag Manager -->`;
}

function googleTagManagerBodySnippet() {
  return `<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${googleTagManagerId}"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->`;
}

function upsertGoogleTagManager(html) {
  const headPattern = new RegExp(
    `\\n?<!-- Google Tag Manager -->\\s*<script>\\(function\\(w,d,s,l,i\\)[\\s\\S]*?${googleTagManagerId}[\\s\\S]*?<!-- End Google Tag Manager -->\\n?`,
    "g"
  );
  const bodyPattern = new RegExp(
    `\\n?<!-- Google Tag Manager \\(noscript\\) -->\\s*<noscript><iframe src="https://www\\.googletagmanager\\.com/ns\\.html\\?id=${googleTagManagerId}"[\\s\\S]*?<!-- End Google Tag Manager \\(noscript\\) -->\\n?`,
    "g"
  );

  let output = html.replace(headPattern, "\n").replace(bodyPattern, "\n");
  output = output.replace(/<head>/i, `<head>\n${googleTagManagerHeadSnippet()}\n`);
  output = output.replace(/<body\b[^>]*>/i, (match) => `${match}\n${googleTagManagerBodySnippet()}`);
  return output;
}

function facebookPixelHeadSnippet() {
  return `<!-- Facebook Pixel Code -->
<script>
  !function(f,b,e,v,n,t,s)
  {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
  n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t,s)}(window, document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', '${facebookPixelId}');
  fbq('track', 'PageView');
</script>
<!-- End Facebook Pixel Code -->`;
}

function facebookPixelBodySnippet() {
  return `<!-- Facebook Pixel Code (noscript) -->
<noscript>
  <img height="1" width="1" style="display:none"
       src="https://www.facebook.com/tr?id=${facebookPixelId}&ev=PageView&noscript=1"/>
</noscript>
<!-- End Facebook Pixel Code (noscript) -->`;
}

function removeFacebookPixels(html) {
  return html.replace(
    /\n?[ \t]*<!--\s*(?:Meta|Facebook) Pixel Code\s*-->[\s\S]*?<!--\s*End (?:Meta|Facebook) Pixel Code\s*-->\s*/gi,
    "\n"
  );
}

function upsertFacebookPixel(html) {
  let output = removeFacebookPixels(html);
  output = output.replace(
    /\n?<!-- Facebook Pixel Code \(noscript\) -->[\s\S]*?<!-- End Facebook Pixel Code \(noscript\) -->\n?/gi,
    "\n"
  );

  if (!output.includes(`fbq('init', '${facebookPixelId}')`)) {
    if (output.includes("<!-- End Google Tag Manager -->")) {
      output = output.replace("<!-- End Google Tag Manager -->", `<!-- End Google Tag Manager -->\n${facebookPixelHeadSnippet()}`);
    } else {
      output = output.replace(/<head>/i, `<head>\n${facebookPixelHeadSnippet()}\n`);
    }
  }

  if (!output.includes(`https://www.facebook.com/tr?id=${facebookPixelId}&ev=PageView&noscript=1`)) {
    if (output.includes("<!-- End Google Tag Manager (noscript) -->")) {
      output = output.replace(
        "<!-- End Google Tag Manager (noscript) -->",
        `<!-- End Google Tag Manager (noscript) -->\n${facebookPixelBodySnippet()}`
      );
    } else {
      output = output.replace(/<body\b[^>]*>/i, (match) => `${match}\n${facebookPixelBodySnippet()}`);
    }
  }

  return output;
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
    isolation: isolate;
    margin-bottom: 24px !important;
    overflow: visible;
    padding: 8px 0 12px !important;
    position: relative;
    z-index: 3;
  }

  .elementor-690 .elementor-element.elementor-element-61f40e2::before {
    background: #fff;
    content: "";
    inset: -14px -24px -22px;
    pointer-events: none;
    position: absolute;
    z-index: -1;
  }

  .elementor-690 .elementor-element.elementor-element-61f40e2 .elementor-widget-container,
  .elementor-690 .elementor-element.elementor-element-61f40e2 img {
    background: #fff !important;
    display: block;
    position: relative;
    z-index: 1;
  }

  .elementor-690 .elementor-element.elementor-element-c747981 {
    background: #fff !important;
    margin-top: 20px !important;
    position: relative;
    z-index: 1;
  }
}
</style>`;
}

function directCheckoutStyle() {
  return `<style id="direct-checkout-style">
.offer-checkout-actions {
  display: grid;
  gap: 18px;
  margin: 0 auto;
  width: 100%;
}

.offer-checkout-accept {
  align-items: center;
  background: #348848;
  border: 1px solid #1e4e2d;
  border-radius: 4px;
  box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.22);
  color: #fff !important;
  display: flex;
  font-family: Inter, Arial, sans-serif;
  font-size: 26px;
  font-weight: 800;
  justify-content: center;
  line-height: 1.2;
  min-height: 96px;
  padding: 18px 16px;
  text-align: center;
  text-decoration: none !important;
  text-transform: uppercase;
  width: 100%;
}

.offer-checkout-reject {
  color: #111 !important;
  display: block;
  font-family: Inter, Arial, sans-serif;
  font-size: 20px;
  line-height: 1.3;
  text-align: center;
  text-decoration: underline !important;
}

@media (max-width: 767px) {
  .offer-checkout-actions {
    gap: 20px;
  }

  .offer-checkout-accept {
    font-size: 25px;
    min-height: 101px;
  }

  .offer-checkout-reject {
    font-size: 19px;
  }
}
</style>`;
}

function directCheckoutBlock({ acceptUrl, rejectUrl, acceptText, rejectText }) {
  return `<div class="offer-checkout-actions">
  <a class="offer-checkout-accept" href="${acceptUrl}">${acceptText}</a>
  <a class="offer-checkout-reject" href="${rejectUrl}">${rejectText}</a>
</div>`;
}

function replaceOfferActions(html, options) {
  let output = html
    .replace(/\n?<script id="checkout-link-override">[\s\S]*?<\/script>\n?/g, "\n")
    .replace(/\n?<script>\s*\(function \(\) \{\s*function patchRejectButtons\(\) \{[\s\S]*?patchRejectButtons\(\);\s*\}\)\(\);\s*<\/script>\n?/g, "\n")
    .replace(/\s*<script type="text\/javascript" src="https:\/\/caktoscripts\.nyc3\.cdn\.digitaloceanspaces\.com\/upsell\.js"><\/script>/g, "")
    .replace(/\s*<!-- Descomente o código abaixo para estilzar o css dos botões -->\s*<!-- <style>[\s\S]*?<\/style> -->/g, "")
    .replace(/<cakto-upsell-buttons>[\s\S]*?<\/cakto-upsell-buttons>/i, directCheckoutBlock(options));

  output = upsertHeadSnippet(output, "direct-checkout-style", directCheckoutStyle());
  return output;
}

function useOpaqueTrustBadge(html) {
  return html.replace(
    /<img\b[^>]*\bsrc="[^"]*334d0cf4-fe39-481c-8377-5da3b8ebe9e6\.webp"[^>]*>/i,
    (tag) =>
      tag
        .replace(/\bsrc="[^"]*334d0cf4-fe39-481c-8377-5da3b8ebe9e6\.webp"/i, `src="${opaqueTrustBadgeUrl}"`)
        .replace(/\s+srcset="[^"]*334d0cf4-fe39-481c-8377-5da3b8ebe9e6[^"]*"/i, "")
        .replace(/\s+sizes="[^"]*"/i, "")
  );
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
  html = upsertGoogleTag(html);
  html = upsertGoogleTagManager(html);
  html = upsertFacebookPixel(html);
  html = applyCheckoutOverrides(html, page.route);
  if (page.route === "acelerador") {
    html = useOpaqueTrustBadge(html);
    html = upsertHeadSnippet(html, "mobile-trust-badge-fix", mobileTrustBadgeFixStyle());
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
