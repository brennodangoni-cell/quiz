import { readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

const root = process.cwd();

const checkoutLinks = {
  front: "https://pay.cakto.com.br/zxwkisn_890004",
  upsell: "https://pay.cakto.com.br/354fsst_890464",
  upsellReject: "https://secajejum.info/ofertaespecial",
  downsell: "https://pay.cakto.com.br/34x5vvy",
  downsellReject: "https://www.cakto.com.br/",
};

const googleTagId = "AW-18172872375";
const trustBadgeImage = "334d0cf4-fe39-481c-8377-5da3b8ebe9e6";
const opaqueTrustBadgeUrl = `/offer-assets/ofertafit.com/wp-content/uploads/2025/09/${trustBadgeImage}-white.webp`;

const oldFrontCheckout = "https://pay.cakto.com.br/xfdgzcm_556067";

function checkoutPath(checkoutUrl) {
  return new URL(checkoutUrl).pathname.replace(/^\/+/, "");
}

function md5(buffer) {
  return crypto.createHash("md5").update(buffer).digest();
}

function evpBytesToKey(password, salt, keyLength, ivLength) {
  let derived = Buffer.alloc(0);
  let block = Buffer.alloc(0);
  const passwordBuffer = Buffer.from(password, "utf8");

  while (derived.length < keyLength + ivLength) {
    block = md5(Buffer.concat([block, passwordBuffer, salt]));
    derived = Buffer.concat([derived, block]);
  }

  return {
    key: derived.subarray(0, keyLength),
    iv: derived.subarray(keyLength, keyLength + ivLength),
  };
}

function decryptCryptoJsPassphrase(cipherTextBase64, password) {
  const raw = Buffer.from(cipherTextBase64, "base64");
  if (raw.subarray(0, 8).toString("utf8") !== "Salted__") {
    throw new Error("Payload does not use the expected CryptoJS/OpenSSL salt header.");
  }

  const salt = raw.subarray(8, 16);
  const encrypted = raw.subarray(16);
  const { key, iv } = evpBytesToKey(password, salt, 32, 16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function encryptCryptoJsPassphrase(plainText, password) {
  const salt = crypto.randomBytes(8);
  const { key, iv } = evpBytesToKey(password, salt, 32, 16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  cipher.setAutoPadding(true);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from("Salted__", "utf8"), salt, encrypted]).toString("base64");
}

function extractFunnelPayload(indexHtml) {
  const match = indexHtml.match(/"f":"([^"]+)"/);
  if (!match) throw new Error("Could not find the encrypted funnel payload in index.html.");
  return match[1];
}

function payloadKey(encryptedPayload) {
  const keyOffset = Number.parseInt(encryptedPayload.charAt(8), 10);
  const keyWindow = encryptedPayload.slice(9, 35);
  if (!Number.isFinite(keyOffset)) throw new Error("Could not read funnel payload key offset.");
  return keyWindow.slice(keyOffset, keyOffset + 6);
}

function decodeFunnelPayload(encryptedPayload) {
  return JSON.parse(decryptCryptoJsPassphrase(encryptedPayload.slice(35), payloadKey(encryptedPayload)));
}

function encodeFunnelPayload(funnel, previousPayload) {
  const prefix = previousPayload.slice(0, 35);
  return `${prefix}${encryptCryptoJsPassphrase(JSON.stringify(funnel), payloadKey(previousPayload))}`;
}

function walk(value, visitor) {
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visitor));
    return;
  }

  if (!value || typeof value !== "object") return;

  visitor(value);
  Object.values(value).forEach((item) => walk(item, visitor));
}

function replaceFrontCheckout(funnel) {
  let replacements = 0;
  let alreadyCurrent = 0;
  walk(funnel, (node) => {
    if (node.content?.type === "redirect" && node.content.destination === oldFrontCheckout) {
      node.content.destination = checkoutLinks.front;
      replacements += 1;
    } else if (node.content?.type === "redirect" && node.content.destination === checkoutLinks.front) {
      alreadyCurrent += 1;
    }
  });
  return { replacements, alreadyCurrent };
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

async function patchOfferPage(relativePath, urls) {
  const filePath = path.join(root, relativePath);
  let html = await readFile(filePath, "utf8");
  html = upsertGoogleTag(html);
  html = replaceOfferActions(html, urls);
  if (relativePath.startsWith("acelerador/")) {
    html = useOpaqueTrustBadge(html);
    html = upsertHeadSnippet(html, "mobile-trust-badge-fix", mobileTrustBadgeFixStyle());
  }
  await writeFile(filePath, html);
}

async function main() {
  const indexPath = path.join(root, "index.html");
  let indexHtml = await readFile(indexPath, "utf8");
  const currentPayload = extractFunnelPayload(indexHtml);
  const funnel = decodeFunnelPayload(currentPayload);
  const { replacements, alreadyCurrent } = replaceFrontCheckout(funnel);

  if (replacements === 0 && alreadyCurrent === 0) {
    throw new Error(`Could not find ${oldFrontCheckout} in the funnel redirect buttons.`);
  }

  if (replacements > 0) {
    const nextPayload = encodeFunnelPayload(funnel, currentPayload);
    indexHtml = indexHtml.replace(/("f":")[^"]+(")/, `$1${nextPayload}$2`);

    await writeFile(path.join(root, "captured", "funnel.json"), `${JSON.stringify(funnel, null, 2)}\n`);
  }

  const taggedIndexHtml = upsertGoogleTag(indexHtml);
  if (taggedIndexHtml !== indexHtml || replacements > 0) {
    indexHtml = taggedIndexHtml;
    await writeFile(indexPath, indexHtml);
  }

  await patchOfferPage("acelerador/index.html", {
    acceptUrl: checkoutLinks.upsell,
    rejectUrl: checkoutLinks.upsellReject,
    acceptText: "QUERO EMAGRECER 10X MAIS RÁPIDO!",
    rejectText: "Não, não quero acelerar meu emagrecimento",
  });
  await patchOfferPage("ofertaespecial/index.html", {
    acceptUrl: checkoutLinks.downsell,
    rejectUrl: checkoutLinks.downsellReject,
    acceptText: "QUERO DESBLOQUEAR TUDO COM 50% DE DESCONTO!",
    rejectText: "Não, não quero aproveitar essa última oportunidade.",
  });

  console.log(JSON.stringify({
    frontRedirectsUpdated: replacements,
    frontRedirectsAlreadyCurrent: alreadyCurrent,
    links: checkoutLinks,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
