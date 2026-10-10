// Endereço do app (lei das duas rotas): /llm-monitor/{página}#{detour}.
// Páginas são destinos; chat e versões são free detours no # (dono é o shell).
import { useSyncExternalStore } from "react";
import { BASE } from "./sdk";

/** Id de página do layout (dinâmico): `agora` = raiz; os demais vêm de `layout.pages`. */
export type Page = string;

// rotas antigas → o lugar novo de cada assunto (a página-por-widget e a "Semana", hoje "Ciclo")
const LEGACY: Record<string, string> = { consumo: "/ciclo", "por-modelo": "/ciclo", picos: "/ciclo", "contas-soul": "/reserva", controle: "/ajustes", marcas: "/avisos" };
const RENAMED: Record<string, string> = { semana: "ciclo" };

/** Corrige rotas antigas uma vez, na carga (replace: o endereço velho não fica no histórico). */
export function fixLegacyRoute() {
  const m = new RegExp(`^${BASE}/(?:w/)?([a-z0-9-]+)`).exec(location.pathname);
  if (!m) return;
  const to = location.pathname.startsWith(`${BASE}/w/`) ? LEGACY[m[1]] ?? "/" : RENAMED[m[1]] ? `/${RENAMED[m[1]]}` : null;
  if (to) history.replaceState(null, "", `${BASE}${to}${location.hash}`);
}

function sub(f: () => void) {
  addEventListener("popstate", f);
  addEventListener("hashchange", f);
  return () => {
    removeEventListener("popstate", f);
    removeEventListener("hashchange", f);
  };
}
export function usePage(): Page {
  const path = useSyncExternalStore(sub, () => location.pathname);
  const seg = path.slice(BASE.length).split("/")[1] ?? "";
  return RENAMED[seg] ?? (seg || "agora");
}
export function useHash(): string {
  return useSyncExternalStore(sub, () => location.hash.replace(/^#/, ""));
}
export function pageHref(p: Page) {
  return p === "agora" ? `${BASE}/` : `${BASE}/${p}`;
}
export function go(p: Page) {
  const to = pageHref(p) + location.hash;
  if (to === location.pathname + location.hash) return;
  history.pushState(null, "", to);
  dispatchEvent(new PopStateEvent("popstate"));
}
export function setHash(h: string) {
  if (h) location.hash = h;
  else history.pushState(null, "", location.pathname + location.search);
  dispatchEvent(new HashChangeEvent("hashchange"));
}
export function useMedia(q: string) {
  return useSyncExternalStore(
    (f) => {
      const m = matchMedia(q);
      m.addEventListener("change", f);
      return () => m.removeEventListener("change", f);
    },
    () => matchMedia(q).matches,
  );
}
/** Régua de 4 posições (plano: celular < 768 · tablet < 1280 · desktop < 1920 · TV). */
export type Tier = "mobile" | "tablet" | "desktop" | "tv";
export function useTier(): Tier {
  const md = useMedia("(min-width: 768px)");
  const xl = useMedia("(min-width: 1280px)");
  const tv = useMedia("(min-width: 1920px)");
  return tv ? "tv" : xl ? "desktop" : md ? "tablet" : "mobile";
}

/** Preferência por navegador (storage negado nunca trava a tela). */
export function pref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`pos:state:anon:standalone:${key}`);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
export function setPref(key: string, v: unknown) {
  try {
    localStorage.setItem(`pos:state:anon:standalone:${key}`, JSON.stringify(v));
  } catch {
    /* sem storage: vale só nesta aba */
  }
}
