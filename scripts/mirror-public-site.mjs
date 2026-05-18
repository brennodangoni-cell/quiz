import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const sourceUrl = "https://quiz.secajejumturbo.site/";
const outDir = process.cwd();
const capturedDir = path.join(outDir, "captured");
const bundleDir = path.join(capturedDir, "public-assets");
const formattedDir = path.join(capturedDir, "formatted");

const textTypes = [
  "application/javascript",
  "text/javascript",
  "text/css",
  "application/json",
  "text/plain",
  "text/html",
  "application/octet-stream",
];

function sha1(input) {
  return createHash("sha1").update(input).digest("hex").slice(0, 10);
}

function safeFileName(url) {
  const parsed = new URL(url);
  const ext = path.extname(parsed.pathname) || ".bin";
  const base = parsed.pathname
    .replace(/^\/+/, "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/_+/g, "_")
    .slice(-180)
    || "index";
  return `${parsed.hostname}_${base}${parsed.search ? `_${sha1(parsed.search)}` : ""}${base.endsWith(ext) ? "" : ext}`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function extractPublicUrls(html) {
  const urls = [];
  const attrRe = /\b(?:src|href|content)=["']([^"']+)["']/gi;
  let match;
  while ((match = attrRe.exec(html))) {
    const raw = match[1].trim();
    if (!raw || raw.startsWith("data:") || raw.startsWith("#")) continue;
    try {
      urls.push(new URL(raw, sourceUrl).toString());
    } catch {}
  }
  return unique(urls).filter((url) => url.startsWith("http"));
}

function prettyJs(source) {
  return source
    .replace(/;\s*/g, ";\n")
    .replace(/\{\s*/g, "{\n")
    .replace(/\}\s*/g, "\n}\n")
    .replace(/,\s*(?=[A-Za-z_$"'])/g, ",\n")
    .replace(/\n{3,}/g, "\n\n");
}

function prettyCss(source) {
  return source
    .replace(/\{/g, "{\n")
    .replace(/;/g, ";\n")
    .replace(/\}/g, "\n}\n")
    .replace(/\n{3,}/g, "\n\n");
}

async function fetchBuffer(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome Safari",
      accept: "*/*",
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  const contentType = response.headers.get("content-type") || "";
  return {
    body: Buffer.from(await response.arrayBuffer()),
    contentType,
  };
}

async function maybeFetchSourcemap(assetUrl, localPath, text) {
  const candidates = [];
  const inlineMatch = text.match(/[#@]\s*sourceMappingURL=([^\s*]+)/);
  if (inlineMatch?.[1] && !inlineMatch[1].startsWith("data:")) {
    candidates.push(new URL(inlineMatch[1], assetUrl).toString());
  }
  candidates.push(`${assetUrl}.map`);

  for (const mapUrl of unique(candidates)) {
    try {
      const { body, contentType } = await fetchBuffer(mapUrl);
      if (!contentType.includes("json") && !body.toString("utf8", 0, 80).includes("{")) continue;
      const mapPath = `${localPath}.map`;
      await writeFile(mapPath, body);
      return { url: mapUrl, localPath: path.relative(outDir, mapPath) };
    } catch {}
  }
  return null;
}

async function main() {
  await mkdir(capturedDir, { recursive: true });
  await mkdir(bundleDir, { recursive: true });
  await mkdir(formattedDir, { recursive: true });

  const { body: htmlBody } = await fetchBuffer(sourceUrl);
  const html = htmlBody.toString("utf8");

  await writeFile(path.join(capturedDir, "original.html"), html);
  await writeFile(path.join(outDir, "index.html"), html);

  const assetUrls = extractPublicUrls(html)
    .filter((url) => {
      const parsed = new URL(url);
      return parsed.hostname.includes("inlead") || parsed.hostname.includes("media.inlead") || parsed.hostname.includes("fonts.");
    });

  const manifest = {
    sourceUrl,
    capturedAt: new Date().toISOString(),
    entryHtml: "index.html",
    originalHtml: "captured/original.html",
    assets: [],
  };

  for (const assetUrl of assetUrls) {
    const fileName = safeFileName(assetUrl);
    const localPath = path.join(bundleDir, fileName);
    const record = {
      url: assetUrl,
      localPath: path.relative(outDir, localPath),
      formattedPath: null,
      sourcemap: null,
      ok: false,
      error: null,
    };

    try {
      const { body, contentType } = await fetchBuffer(assetUrl);
      await writeFile(localPath, body);
      record.ok = true;
      record.contentType = contentType;
      record.bytes = body.length;

      const ext = path.extname(new URL(assetUrl).pathname);
      const isText = textTypes.some((type) => contentType.includes(type)) || [".js", ".css", ".json", ".html", ".txt", ".svg"].includes(ext);
      if (isText) {
        const text = body.toString("utf8");
        if (ext === ".js" || contentType.includes("javascript")) {
          const formattedPath = path.join(formattedDir, `${fileName}.formatted.js`);
          await writeFile(formattedPath, prettyJs(text));
          record.formattedPath = path.relative(outDir, formattedPath);
          record.sourcemap = await maybeFetchSourcemap(assetUrl, localPath, text);
        } else if (ext === ".css" || contentType.includes("css")) {
          const formattedPath = path.join(formattedDir, `${fileName}.formatted.css`);
          await writeFile(formattedPath, prettyCss(text));
          record.formattedPath = path.relative(outDir, formattedPath);
          record.sourcemap = await maybeFetchSourcemap(assetUrl, localPath, text);
        }
      }
    } catch (error) {
      record.error = error.message;
    }

    manifest.assets.push(record);
  }

  await writeFile(path.join(capturedDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const htmlAgain = await readFile(path.join(outDir, "index.html"), "utf8");
  const note = [
    "# Cópia pública do quiz",
    "",
    "Esta pasta contém uma cópia do que o navegador recebe publicamente em https://quiz.secajejumturbo.site/.",
    "",
    "- `index.html`: entrada pronta para hospedar/testar localmente, mantendo os scripts públicos originais.",
    "- `captured/original.html`: HTML bruto capturado.",
    "- `captured/public-assets/`: arquivos JS/CSS/imagens/fontes públicas baixadas para análise.",
    "- `captured/formatted/`: versões formatadas dos JS/CSS públicos para leitura.",
    "- `captured/manifest.json`: mapa de origem, arquivo local, sourcemaps encontrados e erros de download.",
    "",
    `Tamanho do HTML capturado: ${htmlAgain.length} caracteres.`,
    "",
  ].join("\n");
  await writeFile(path.join(outDir, "README.md"), note);

  console.log(JSON.stringify({
    sourceUrl,
    assets: manifest.assets.length,
    downloaded: manifest.assets.filter((asset) => asset.ok).length,
    sourcemaps: manifest.assets.filter((asset) => asset.sourcemap).length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
