// Deriva os assets de marca do LLM Monitor a partir do brand canônico
// (brand/llm-monitor/{light,dark}/*.svg) — skills `brand-derivation` (v2) e `pwa`.
//
//   node scripts/derive-brand.mjs
//
// Lei-mãe: tudo DERIVADO do brand, nada redesenhado. O SVG inteiro é tratado como UM
// grupo (escalado/transladado como corpo único). Saídas:
//   public/favicon-{light,dark}.svg, favicon.svg, favicon.ico, favicon-{16x16,32x32}.png
//   public/icons/icon.svg, icon-{192,512}.png (any, transparentes), icon-{192,512}-maskable.png
//   public/apple-touch-icon.png (180, opaco)        public/masked-icon.svg (Safari pinned)
//   public/splash/*.jpg (apple-touch-startup-image, iPhone+iPad × orientação × claro/escuro)
//   public/brand/{logo,logo-h,logo-v}-{light,dark}.svg (logomarcas p/ a UI, se precisar)
//   brand.generated.json (cores do tema p/ manifest/meta) + bloco de <link> splash no index.html
//
// Cadeias v2: favicon → favicon.svg > mask > icon > logo · ícone de home → icon.svg > logo.svg ·
// splash → creative.svg (recortado ao aspect do device; dark no media dark).
// Cores: paper (fundo opaco SÓ de maskable/apple/splash; any e favicons são transparentes) = --background do tema CLARO do app
// (src/styles.css); o dark vem de :root.dark. Rasteriza via Chromium (Playwright).

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = path.resolve(import.meta.dirname, "..");
const BRAND = path.join(ROOT, "brand/llm-monitor");
const PUB = path.join(ROOT, "public");
const first = (theme, names) => {
  for (const n of names) {
    const p = path.join(BRAND, theme, n + ".svg");
    if (existsSync(p)) return p;
  }
  throw new Error(`brand sem ${names.join(" | ")} em ${theme}/`);
};

// ---------------------------------------------------------------- cores do tema (oklch → hex)
function oklchToHex(s) {
  const m = s.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  const [L, C, h] = [Number(m[1]), Number(m[2]), (Number(m[3]) * Math.PI) / 180];
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const ss = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * ss, -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * ss, -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * ss];
  const enc = (x) => {
    x = Math.min(1, Math.max(0, x));
    return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
  };
  return "#" + lin.map((x) => enc(x).toString(16).padStart(2, "0")).join("");
}
const css = readFileSync(path.join(ROOT, "src/styles.css"), "utf8");
const tokenIn = (block, name) => block.match(new RegExp(`--${name}:\\s*(oklch\\([^)]*\\))`))[1];
const lightBlock = css.slice(css.indexOf(":root {"), css.indexOf(":root.dark"));
const darkBlock = css.slice(css.indexOf(":root.dark"));
const colors = {
  name: "LLM Monitor",
  shortName: "LLM Monitor",
  background: { light: oklchToHex(tokenIn(lightBlock, "background")), dark: oklchToHex(tokenIn(darkBlock, "background")) },
};
writeFileSync(path.join(ROOT, "brand.generated.json"), JSON.stringify(colors, null, 2) + "\n");
const PAPER = colors.background.light;

// ---------------------------------------------------------------- cópias SVG
mkdirSync(path.join(PUB, "icons"), { recursive: true });
mkdirSync(path.join(PUB, "splash"), { recursive: true });
mkdirSync(path.join(PUB, "brand"), { recursive: true });
const cp = (src, out) => copyFileSync(src, path.join(PUB, out));
cp(first("light", ["favicon", "mask", "icon", "logo"]), "favicon-light.svg"); // glifo p/ aba clara
cp(first("dark", ["favicon", "mask", "icon", "logo"]), "favicon-dark.svg"); // agulha branca p/ aba escura
cp(first("light", ["favicon", "mask", "icon", "logo"]), "favicon.svg");
cp(first("light", ["icon", "logo"]), "icons/icon.svg");
cp(first("light", ["mask", "icon"]), "masked-icon.svg");
for (const t of ["light", "dark"]) for (const n of ["logo", "logo-h", "logo-v"]) cp(first(t, [n]), `brand/${n}-${t}.svg`);

// ---------------------------------------------------------------- Chromium
function resolveChromium() {
  const tries = [() => createRequire(import.meta.url)("playwright"), () => createRequire(import.meta.url)(path.resolve(ROOT, "../../atrium/so/node_modules/playwright"))];
  for (const t of tries) {
    try {
      return t().chromium;
    } catch {
      /* próxima */
    }
  }
  throw new Error("playwright não resolvível (tentei o app e workspace/atrium/so/node_modules)");
}
const browser = await resolveChromium().launch();
const uri = (p) => `data:image/svg+xml;base64,${readFileSync(p).toString("base64")}`;

/** Ícone quadrado: o SVG como um grupo só, `frame` = canvas/conteúdo (100/frame do canvas = conteúdo). */
async function icon(srcPath, out, size, frame, bg, type = "png") {
  const inner = (size * 100) / frame;
  const off = (size - inner) / 2;
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><body style="margin:0;${bg ? `background:${bg}` : ""}"><img src="${uri(srcPath)}" style="position:absolute;left:${off}px;top:${off}px;width:${inner}px;height:${inner}px"></body>`);
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(PUB, out), omitBackground: !bg, type });
  await page.close();
  console.log(`  ${out.padEnd(34)} ${size}px frame ${frame}${bg ? " " + bg : ""}`);
}

const HOME = first("light", ["icon", "logo"]);
// any: fundo TRANSPARENTE (o SO/launcher pinta o dele; quadrado sólido vira "fundo branco" no Windows),
// símbolo ocupando a área com pouca margem (~4 %/lado)
await icon(HOME, "icons/icon-192.png", 192, 104, null);
await icon(HOME, "icons/icon-512.png", 512, 104, null);
// maskable: safe-zone 80 % (10 % de padding/lado), full-bleed sólido, arquivo SEPARADO do any
await icon(HOME, "icons/icon-192-maskable.png", 192, 125, PAPER);
await icon(HOME, "icons/icon-512-maskable.png", 512, 125, PAPER);
// apple-touch: ~14 % de margem, opaco, quadrado sem cantos arredondados
await icon(HOME, "apple-touch-icon.png", 180, 116, PAPER);
// favicon raster (fallback): transparente, tema claro
const FAV = first("light", ["favicon", "mask", "icon", "logo"]);
await icon(FAV, "favicon-32x32.png", 32, 104, null);
await icon(FAV, "favicon-16x16.png", 16, 104, null);
await icon(FAV, "favicon-48x48.png", 48, 104, null);

// favicon.ico (16/32/48 com payload PNG)
{
  const sizes = [16, 32, 48];
  const pngs = sizes.map((s) => readFileSync(path.join(PUB, `favicon-${s}x${s}.png`)));
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(sizes.length, 4);
  let off = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    head[e] = s;
    head[e + 1] = s;
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(pngs[i].length, e + 8);
    head.writeUInt32LE(off, e + 12);
    off += pngs[i].length;
  });
  writeFileSync(path.join(PUB, "favicon.ico"), Buffer.concat([head, ...pngs]));
  console.log("  favicon.ico                        16/32/48");
}

// ---------------------------------------------------------------- splash iOS (creative recortado ao aspect)
// [css w, css h, dpr] — iPhone e iPad vigentes.
const DEVICES = [
  [440, 956, 3], [402, 874, 3], [430, 932, 3], [393, 852, 3], [428, 926, 3], [390, 844, 3], [375, 812, 3],
  [414, 896, 3], [414, 896, 2], [414, 736, 3], [375, 667, 2], [320, 568, 2],
  [1032, 1376, 2], [1024, 1366, 2], [834, 1194, 2], [834, 1112, 2], [820, 1180, 2], [810, 1080, 2], [768, 1024, 2], [744, 1133, 2],
];
const links = [];
for (const scheme of ["light", "dark"]) {
  const creative = first(scheme, ["creative"]);
  for (const [w, h, r] of DEVICES) {
    for (const orient of ["portrait", "landscape"]) {
      const [cw, ch] = orient === "portrait" ? [w, h] : [h, w];
      const pw = cw * r, ph = ch * r;
      const name = `splash/${scheme}-${pw}x${ph}.jpg`;
      if (!existsSync(path.join(PUB, name))) {
        const side = Math.max(pw, ph); // quadrado full-bleed, "cover": centro preservado em qualquer aspecto até 2:1
        const page = await browser.newPage({ viewport: { width: pw, height: ph }, deviceScaleFactor: 1 });
        await page.setContent(`<!doctype html><body style="margin:0;overflow:hidden;background:${colors.background[scheme]}"><img src="${uri(creative)}" style="position:absolute;width:${side}px;height:${side}px;left:${(pw - side) / 2}px;top:${(ph - side) / 2}px"></body>`);
        await page.waitForTimeout(80);
        await page.screenshot({ path: path.join(PUB, name), type: "jpeg", quality: 88 });
        await page.close();
      }
      links.push(`    <link rel="apple-touch-startup-image" href="/${name}" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: ${orient}) and (prefers-color-scheme: ${scheme})" />`);
    }
  }
  console.log(`  splash ${scheme}: ${DEVICES.length * 2} imagens`);
}
await browser.close();

// ---------------------------------------------------------------- bloco de splash no index.html
const idx = path.join(ROOT, "index.html");
let html = readFileSync(idx, "utf8");
const S = "<!-- brand:splash:start (gerado por scripts/derive-brand.mjs) -->";
const E = "<!-- brand:splash:end -->";
if (!html.includes(S)) throw new Error("index.html sem o bloco brand:splash");
html = html.replace(new RegExp(`${S.replace(/[()]/g, "\\$&")}[\\s\\S]*?${E}`), `${S}\n${links.join("\n")}\n    ${E}`);
writeFileSync(idx, html);
console.log(`\nok — ${links.length} <link> de splash; cores ${JSON.stringify(colors.background)}`);
