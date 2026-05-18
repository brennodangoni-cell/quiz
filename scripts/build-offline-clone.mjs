import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

const root = process.cwd();
const sourceOrigin = "https://inlead.digital";
const capturedDir = path.join(root, "captured");
const manifestPath = path.join(capturedDir, "manifest.json");

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
  const salted = raw.subarray(0, 8).toString("utf8") === "Salted__";
  if (!salted) throw new Error("Payload does not use the expected CryptoJS/OpenSSL salt header.");

  const salt = raw.subarray(8, 16);
  const encrypted = raw.subarray(16);
  const { key, iv } = evpBytesToKey(password, salt, 32, 16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function decodeFunnelPayload(f) {
  const keyOffset = Number.parseInt(f.charAt(8), 10);
  const keyWindow = f.slice(9, 35);
  const key = keyWindow.slice(keyOffset, keyOffset + 6);
  const content = f.slice(35);
  return JSON.parse(decryptCryptoJsPassphrase(content, key));
}

function extractNextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error("Could not find __NEXT_DATA__.");
  return JSON.parse(match[1]);
}

async function fetchToFile(url, filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  await writeFile(filePath, Buffer.from(await response.arrayBuffer()));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function collectStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, out));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectStrings(item, out));
  return out;
}

function extractLazyChunkIds(files) {
  const ids = new Set();
  for (const file of files) {
    const text = file.text;
    for (const match of text.matchAll(/\b[A-Za-z_$][\w$]*\.e\((\d+)\)/g)) ids.add(Number(match[1]));
  }
  return [...ids].sort((a, b) => a - b);
}

function chunkPathFromRuntime(runtimeText, id) {
  const specials = new Map([
    [31602, "static/chunks/31602-5b56d2440b7fb03d.js"],
    [48750, "static/chunks/48750-d6f834f7a5a7e850.js"],
    [28843, "static/chunks/28843-04489204a90e225c.js"],
    [3999, "static/chunks/3999-4a7202fc237fad5a.js"],
    [89979, "static/chunks/89979-0f3697ba73b23b8f.js"],
  ]);
  if (specials.has(id)) return specials.get(id);

  const hashMatch = runtimeText.match(new RegExp(`(?:^|[,\\{])${id}:"([^"]+)"`));
  if (!hashMatch) return null;
  const name = id === 1791 ? "5a3e129d" : String(id);
  return `static/chunks/${name}.${hashMatch[1]}.js`;
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const originalHtml = await readFile(path.join(capturedDir, "original.html"), "utf8");
  const nextData = extractNextData(originalHtml);
  const funnel = decodeFunnelPayload(nextData.props.pageProps.f);

  await writeFile(path.join(capturedDir, "funnel.json"), `${JSON.stringify(funnel, null, 2)}\n`);

  const copied = [];
  for (const asset of manifest.assets.filter((item) => item.ok && item.url.startsWith(`${sourceOrigin}/_next/static/`))) {
    const url = new URL(asset.url);
    const target = path.join(root, url.pathname.replace(/^\/+/, ""));
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(root, asset.localPath), target);
    const decodedTarget = path.join(root, decodeURIComponent(url.pathname).replace(/^\/+/, ""));
    if (decodedTarget !== target) {
      await mkdir(path.dirname(decodedTarget), { recursive: true });
      await copyFile(path.join(root, asset.localPath), decodedTarget);
    }
    copied.push(url.pathname);
  }

  const localWebpackPath = path.join(root, "_next/static/chunks/webpack-bccdf3d6915dded3.js");
  let runtimeText = await readFile(localWebpackPath, "utf8");

  const publicAssetFiles = [];
  for (const asset of manifest.assets.filter((item) => item.ok && item.localPath.endsWith(".js"))) {
    publicAssetFiles.push({
      path: path.join(root, asset.localPath),
      text: await readFile(path.join(root, asset.localPath), "utf8"),
    });
  }

  const lazyIds = extractLazyChunkIds(publicAssetFiles);
  const lazyChunkPaths = unique(lazyIds.map((id) => chunkPathFromRuntime(runtimeText, id)));
  const downloadedLazy = [];
  for (const chunkPath of lazyChunkPaths) {
    const target = path.join(root, "_next", chunkPath);
    try {
      await fetchToFile(`${sourceOrigin}/_next/${chunkPath}`, target);
      downloadedLazy.push(`/_next/${chunkPath}`);
    } catch (error) {
      downloadedLazy.push(`FAILED ${chunkPath}: ${error.message}`);
    }
  }

  if (lazyIds.includes(99242)) {
    try {
      await fetchToFile(`${sourceOrigin}/_next/static/css/d0320de32467736e.css`, path.join(root, "_next/static/css/d0320de32467736e.css"));
      downloadedLazy.push("/_next/static/css/d0320de32467736e.css");
    } catch (error) {
      downloadedLazy.push(`FAILED static/css/d0320de32467736e.css: ${error.message}`);
    }
  }

  runtimeText = runtimeText.replace('f.p="https://inlead.digital/_next/"', 'f.p="/_next/"');
  await writeFile(localWebpackPath, runtimeText);

  const localFunnelEnginePath = path.join(root, "_next/static/chunks/70165-9a4c35af5ad5ac76.js");
  let engineText = await readFile(localFunnelEnginePath, "utf8");
  const domainGuard = 'let e=window.location.href,o=window.location.host,l=window.location.pathname.split("/").filter(Boolean)[0]||"";return!!(e.includes("https://inlead.digital")&&(B.slug==l||B.domain==l)||o==B.domain||e.includes("".concat("https://inlead.digital","/preview/")))||"simulate"===G';
  if (engineText.includes(domainGuard)) {
    engineText = engineText.replace(domainGuard, "return!0");
  } else {
    throw new Error("Could not find the domain guard to patch.");
  }
  await writeFile(localFunnelEnginePath, engineText);

  let localHtml = originalHtml
    .replaceAll(`${sourceOrigin}/_next/`, "/_next/")
    .replace('"assetPrefix":"https://inlead.digital"', '"assetPrefix":""');
  await writeFile(path.join(root, "index.html"), localHtml);

  const mediaUrls = unique(collectStrings(funnel).filter((item) => /^https:\/\/media\.inlead\.cloud\//.test(item)));
  const downloadedMedia = [];
  for (const mediaUrl of mediaUrls) {
    const url = new URL(mediaUrl);
    const target = path.join(capturedDir, "media-cache", url.pathname.replace(/^\/+/, ""));
    try {
      await fetchToFile(mediaUrl, target);
      downloadedMedia.push({ url: mediaUrl, localPath: path.relative(root, target) });
    } catch (error) {
      downloadedMedia.push({ url: mediaUrl, error: error.message });
    }
  }

  const info = {
    sourceUrl: manifest.sourceUrl,
    funnel: {
      id: funnel.id,
      hash: funnel.hash,
      title: funnel.title,
      domain: funnel.domain,
      slug: funnel.slug,
      steps: Array.isArray(funnel.steps) ? funnel.steps.length : 0,
    },
    copiedInitialAssets: copied.length,
    lazyChunkIds: lazyIds,
    downloadedLazy,
    mediaAssets: downloadedMedia,
    patches: [
      "Rewrote Next asset URLs from https://inlead.digital/_next/ to /_next/",
      "Rewrote webpack public path to /_next/",
      "Allowed the public funnel renderer to run on local/non-original hosts",
    ],
  };

  await writeFile(path.join(capturedDir, "clone-info.json"), `${JSON.stringify(info, null, 2)}\n`);
  console.log(JSON.stringify(info, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
