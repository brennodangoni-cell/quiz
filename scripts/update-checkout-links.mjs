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

function patchRoutingScript(html, rejectUrl) {
  return html
    .replaceAll('button.setAttribute("upsell-reject-url", "/ofertaespecial/");', `button.setAttribute("upsell-reject-url", "${rejectUrl}");`)
    .replaceAll('button.setAttribute("upsell-reject-url", "https://secajejum.info/ofertaespecial");', `button.setAttribute("upsell-reject-url", "${rejectUrl}");`);
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

async function patchOfferPage(relativePath, urls) {
  const filePath = path.join(root, relativePath);
  let html = await readFile(filePath, "utf8");
  html = patchCaktoButtons(html, urls);
  if (relativePath.startsWith("acelerador/")) html = patchRoutingScript(html, urls.rejectUrl);
  html = upsertBodyScript(html, "checkout-link-override", checkoutOverrideScript(urls));
  if (relativePath.startsWith("acelerador/")) {
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

    await writeFile(indexPath, indexHtml);
    await writeFile(path.join(root, "captured", "funnel.json"), `${JSON.stringify(funnel, null, 2)}\n`);
  }

  await patchOfferPage("acelerador/index.html", {
    acceptUrl: checkoutLinks.upsell,
    rejectUrl: checkoutLinks.upsellReject,
    offerId: checkoutPath(checkoutLinks.upsell),
  });
  await patchOfferPage("ofertaespecial/index.html", {
    acceptUrl: checkoutLinks.downsell,
    rejectUrl: checkoutLinks.downsellReject,
    offerId: checkoutPath(checkoutLinks.downsell),
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
