#!/usr/bin/env node
// ============================================================
// build.mjs — Ofuscación y compresión de index.html
//
// Uso:
//   node build.mjs
//
// Genera:  dist/index.html  (minificado + ofuscado)
//
// La primera vez instala las dependencias necesarias
// automáticamente en node_modules local.
// ============================================================

import { execSync }          from "child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { createRequire }     from "module";
import path                  from "path";
import { fileURLToPath }     from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require   = createRequire(import.meta.url);

// ── Dependencias necesarias ──────────────────────────────────
const DEPS = {
  "clean-css":           "^5.3.3",
  "terser":              "^5.31.0",
  "html-minifier-terser":"^7.2.0",
};

// ── Auto-instalar si no están ────────────────────────────────
function ensureDeps() {
  const missing = Object.keys(DEPS).filter(dep => {
    try { require.resolve(dep); return false; }
    catch { return true; }
  });
  if (missing.length === 0) return;
  console.log(`📦 Instalando dependencias: ${missing.join(", ")}…`);
  const pkgs = missing.map(d => `${d}@${DEPS[d]}`).join(" ");
  execSync(`npm install --no-save ${pkgs}`, { stdio: "inherit", cwd: __dirname });
  console.log("✓ Dependencias instaladas\n");
}

ensureDeps();

// ── Importar tras instalar ───────────────────────────────────
const CleanCSS        = (await import("clean-css")).default;
const { minify: minifyJS } = await import("terser");
const { minify: minifyHTML } = await import("html-minifier-terser");

// ── Leer fuente ──────────────────────────────────────────────
const srcPath  = path.join(__dirname, "index.html");
const distDir  = path.join(__dirname, "dist");
const distPath = path.join(distDir, "index.html");

if (!existsSync(srcPath)) {
  console.error("✗ No se encuentra index.html");
  process.exit(1);
}

const src = readFileSync(srcPath, "utf8");
console.log(`📄 Fuente:  index.html  (${fmt(src.length)})`);

// ── Extraer bloques del HTML ─────────────────────────────────
// Extraemos CSS y JS para procesarlos por separado y luego reensamblar
function extractBlock(html, tag) {
  const open  = `<${tag}`;
  const close = `</${tag}>`;
  const start = html.indexOf(open);
  const end   = html.indexOf(close, start);
  if (start === -1 || end === -1) return { before: html, content: "", after: "" };
  // Buscar el cierre del tag de apertura (puede tener atributos)
  const tagEnd = html.indexOf(">", start) + 1;
  return {
    before:  html.slice(0, start),
    open:    html.slice(start, tagEnd),
    content: html.slice(tagEnd, end),
    close:   close,
    after:   html.slice(end + close.length),
  };
}

// ── 1. Minificar CSS ─────────────────────────────────────────
console.log("\n🎨 Minificando CSS…");
const cssBlock = extractBlock(src, "style");
const cssResult = new CleanCSS({
  level: { 1: { all: true }, 2: { all: true } },
  returnPromise: false,
}).minify(cssBlock.content);

if (cssResult.errors.length) {
  console.error("  ✗ Errores CSS:", cssResult.errors);
  process.exit(1);
}
const minCSS = cssResult.styles;
console.log(`  ${fmt(cssBlock.content.length)} → ${fmt(minCSS.length)}  (${pct(cssBlock.content.length, minCSS.length)} menos)`);

// ── 2. Extraer bloque <script> (el nuestro, el último) ───────
// Hay dos scripts: el CDN de Supabase y el nuestro.
// Ofuscamos solo el nuestro (el de la app).
// El CDN ya está minificado externamente.
const scripts = [...src.matchAll(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/gi)];
if (scripts.length < 2) {
  console.error("✗ No se encontraron los bloques <script> esperados.");
  process.exit(1);
}

// El último <script> es el código de la app
const appScriptMatch = scripts[scripts.length - 1];
const appScriptFull  = appScriptMatch[0];
const appScriptCode  = appScriptFull.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");

// ── 3. Ofuscar y minificar JS ────────────────────────────────
console.log("\n⚙️  Ofuscando y minificando JS…");
const terserResult = await minifyJS(appScriptCode, {
  compress: {
    passes:               2,
    drop_console:         false,  // mantener console.error para depuración
    drop_debugger:        true,
    pure_getters:         true,
    // unsafe_methods desactivado: con múltiples pasadas puede colapsar
    // closures anidados y provocar colisiones de nombres de parámetros
    unsafe_methods:       false,
    unsafe_arrows:        false,
    booleans_as_integers: false,
    // Mantener los nombres de funciones async nombradas para que
    // las llamadas cruzadas entre funciones no se rompan
    keep_fnames:          /^(tryAdminEnter|tryGuestEnter|enterApp|loadGifts|render|init|loadAdminLists|createNewList|selectList|showListSelector|subscribeRealtime|handleRealtimeEvent|cleanupRealtime|toggleReserved|toggleEssential|toggleBought|deleteGift|openModal|closeModal|saveModal|addLinkRow|tryAutoEntryFromUrl)$/,
  },
  // mangle desactivado: terser con passes múltiples puede renombrar
  // parámetros de callbacks anidados al mismo nombre (e.g. "e") y
  // provocar que el closure interno shadee el externo, rompiendo la lógica.
  // La compresión sigue siendo efectiva solo con el paso compress.
  mangle: false,
  output: {
    comments:    false,  // eliminar todos los comentarios
    ascii_only:  false,
  },
});

if (terserResult.error) {
  console.error("  ✗ Error JS:", terserResult.error);
  process.exit(1);
}
const minJS = terserResult.code;
console.log(`  ${fmt(appScriptCode.length)} → ${fmt(minJS.length)}  (${pct(appScriptCode.length, minJS.length)} menos)`);

// ── 4. Reensamblar HTML con bloques minificados ──────────────
let processed = src;

// Reemplazar bloque CSS
processed = processed.replace(
  `<style>${cssBlock.content}</style>`,
  `<style>${minCSS}</style>`
);

// Reemplazar bloque JS de la app (el último <script>)
processed = processed.replace(appScriptFull, `<script>${minJS}</script>`);

// ── 5. Minificar el HTML resultante ──────────────────────────
console.log("\n🗜️  Minificando HTML…");
const minHtml = await minifyHTML(processed, {
  collapseWhitespace:           true,
  removeComments:               true,
  removeRedundantAttributes:    true,
  removeScriptTypeAttributes:   true,
  removeStyleLinkTypeAttributes:true,
  useShortDoctype:              true,
  minifyCSS:                    false, // ya lo hicimos
  minifyJS:                     false, // ya lo hicimos
  conservativeCollapse:         true,
  collapseBooleanAttributes:    true,
});
console.log(`  ${fmt(processed.length)} → ${fmt(minHtml.length)}  (${pct(processed.length, minHtml.length)} menos)`);

// ── 6. Escribir resultado ────────────────────────────────────
mkdirSync(distDir, { recursive: true });
writeFileSync(distPath, minHtml, "utf8");

const total = pct(src.length, minHtml.length);
console.log(`\n✅ Generado: dist/index.html  (${fmt(src.length)} → ${fmt(minHtml.length)}, ${total} menos)\n`);

// ── Helpers ──────────────────────────────────────────────────
function fmt(bytes) {
  return bytes >= 1024
    ? (bytes / 1024).toFixed(1) + " KB"
    : bytes + " B";
}
function pct(orig, min) {
  return (((orig - min) / orig) * 100).toFixed(1) + "%";
}
