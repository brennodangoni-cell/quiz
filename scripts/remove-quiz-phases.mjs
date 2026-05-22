import { readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

const root = process.cwd();

const desktopRemovedStepIds = [
  "651If0",
  "CxtF8R",
  "xaVGE5",
  "sV2RJs",
  "5AvHhn",
  "MDi7hR",
  "oT4UxL",
  "nBfwBa",
  "g7riaG",
  "8Psouk",
  "3So4u7",
  "gvWJlf",
  "YX3wkS",
  "7y8EOF",
  "11h5FZ",
  "ytkkSo",
  "tAupaA",
  "NjN3qp",
  "RxqG2O",
  "Pn4ays",
  "HqHptw",
  "sE035g",
  "zTPnWg",
  "HRk8VN",
];

const mobileRemovedStepIds = [
  "orKHyQ",
  "hWcWcI",
  "6JkSIT",
  "tJklkD",
  "BF2gTw",
  "tTDmcn",
  "jWqfRD",
  "XJKl7w",
  "cD2NT6",
  "fjVTUg",
  "TxNd0U",
  "EeIzDp",
  "WRuttf",
  "2kNHPp",
  "Yxj96W",
  "zaExRz",
  "UUNCx8",
  "U6DEHb",
  "GsBXtj",
  "sfA5i9",
  "wkFvDa",
  "aJS9Sf",
  "s7NbFM",
  "HHwovV",
];

const eventStepIds = [
  "PREcpy",
  "OOlfmF",
];

const removedStepIds = new Set([...desktopRemovedStepIds, ...mobileRemovedStepIds, ...eventStepIds]);
const replacementDestinations = new Map([
  ...desktopRemovedStepIds.map((id) => [id, "zMVOi8"]),
  ...mobileRemovedStepIds.map((id) => [id, "Dxvvj1"]),
  ["PREcpy", "cFrEoi"],
  ["OOlfmF", "3Akgkd"],
]);

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

function removeQuizPhases(funnel) {
  const beforeCount = funnel.steps.length;
  const removedTitles = [];
  funnel.steps = funnel.steps.filter((step) => {
    if (!removedStepIds.has(step.id)) return true;
    removedTitles.push(`${step.title} (${step.id})`);
    return false;
  });

  let destinationRewrites = 0;
  walk(funnel, (node) => {
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "string" && replacementDestinations.has(value)) {
        node[key] = replacementDestinations.get(value);
        destinationRewrites += 1;
      }
    }
  });

  let performanceEntriesRemoved = 0;
  const performance = funnel.metadata?.performance;
  if (performance && typeof performance === "object") {
    for (const id of removedStepIds) {
      if (Object.hasOwn(performance, id)) {
        delete performance[id];
        performanceEntriesRemoved += 1;
      }
    }
  }

  const remainingReferences = [];
  walk(funnel, (node) => {
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "string" && removedStepIds.has(value)) {
        remainingReferences.push(`${key}:${value}`);
      }
    }
  });

  if (remainingReferences.length > 0) {
    throw new Error(`Removed step IDs are still referenced: ${remainingReferences.join(", ")}`);
  }

  return {
    beforeCount,
    afterCount: funnel.steps.length,
    removedCount: removedTitles.length,
    removedTitles,
    destinationRewrites,
    performanceEntriesRemoved,
  };
}

async function main() {
  const indexPath = path.join(root, "index.html");
  const capturedFunnelPath = path.join(root, "captured", "funnel.json");
  let indexHtml = await readFile(indexPath, "utf8");
  const currentPayload = extractFunnelPayload(indexHtml);
  const funnel = decodeFunnelPayload(currentPayload);

  const result = removeQuizPhases(funnel);
  const changed =
    result.removedCount > 0 ||
    result.destinationRewrites > 0 ||
    result.performanceEntriesRemoved > 0;

  if (changed) {
    const nextPayload = encodeFunnelPayload(funnel, currentPayload);
    indexHtml = indexHtml.replace(/("f":")[^"]+(")/, `$1${nextPayload}$2`);
    await writeFile(capturedFunnelPath, `${JSON.stringify(funnel, null, 2)}\n`);
    await writeFile(indexPath, indexHtml);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
