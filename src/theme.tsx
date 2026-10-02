// Eixo claro · automático · escuro — molde: workspace/atrium/modules/operations/src/lib/theme.ts
// (+ features/auth/ThemeToggle.tsx). Três estados, "automático" é o padrão e segue
// prefers-color-scheme ao vivo (muda no SO, muda aqui, sem F5). A escolha persiste
// na convenção pos:state: do Atrium, chave JSON. O script inline do index.html lê a
// MESMA chave e aplica .dark no <html> antes do React (sem flash) — mudou a chave
// aqui, mude lá.
import { useEffect, useSyncExternalStore } from "react";
import { CircleHalf, Moon, Sun } from "@phosphor-icons/react";
import { ToggleGroup, ToggleGroupItem } from "@atrium/core-ui";
import brand from "../brand.generated.json";

export type ThemeMode = "light" | "auto" | "dark";
export const THEME_KEY = "pos:state:anon:standalone:theme-mode";

const isMode = (v: unknown): v is ThemeMode => v === "light" || v === "auto" || v === "dark";

function load(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    const v = raw == null ? null : JSON.parse(raw);
    if (isMode(v)) return v;
  } catch {
    // estado sujo ou storage negado nunca trava a tela
  }
  return "auto";
}

const mql = matchMedia("(prefers-color-scheme: dark)");
let mode: ThemeMode = load();
let systemDark = mql.matches;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
mql.addEventListener("change", () => {
  systemDark = mql.matches;
  notify();
});

export function setThemeMode(next: ThemeMode) {
  mode = next;
  try {
    localStorage.setItem(THEME_KEY, JSON.stringify(next));
  } catch {
    // incógnito/quota: vale nesta aba
  }
  notify();
}

export function useThemeMode() {
  const m = useSyncExternalStore(subscribe, () => mode);
  const sys = useSyncExternalStore(subscribe, () => systemDark);
  return { mode: m, setMode: setThemeMode, dark: m === "auto" ? sys : m === "dark" };
}

/** Aplica o tema resolvido no <html>. Montado uma vez, na raiz do app. */
export function ThemeRoot() {
  const { dark } = useThemeMode();
  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle("dark", dark);
    el.style.colorScheme = dark ? "dark" : "light";
    // barra de status/título do PWA acompanha o tema ESCOLHIDO (a media query só enxerga o sistema)
    const c = dark ? brand.background.dark : brand.background.light;
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", c));
  }, [dark]);
  return null;
}

const OPTIONS: { value: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Tema claro", Icon: Sun },
  { value: "auto", label: "Tema automático (segue o sistema)", Icon: CircleHalf },
  { value: "dark", label: "Tema escuro", Icon: Moon },
];

/** Seletor de 3 estados, só ícones; nome acessível por opção + rótulo do grupo. */
export function ThemeToggle({ className }: { className?: string }) {
  const { mode: m, setMode } = useThemeMode();
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      aria-label="Tema da interface"
      value={m}
      onValueChange={(v) => isMode(v) && setMode(v)}
      className={className}
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        // sem Tooltip asChild: ele sobrescreve o data-state do item e apaga o "ligado"
        <ToggleGroupItem key={value} value={value} aria-label={label} title={label} className="size-9 md:size-8">
          <Icon weight="light" aria-hidden="true" />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
