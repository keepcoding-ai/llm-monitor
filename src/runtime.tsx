// Runtime da plataforma viva: carrega versões de widget por import dinâmico,
// isola cada slot num ErrorBoundary e roda o render de teste antes da troca.
import { Component, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { BASE, call, onWidgetTest } from "./sdk";

type Mod = { default: ComponentType };
const cache = new Map<string, Promise<Mod>>();

export function loadWidget(id: string, v: number): Promise<Mod> {
  const key = `${id}@${v}`;
  let p = cache.get(key);
  if (!p) {
    p = import(/* @vite-ignore */ `${BASE}/widgets/${id}/v${v}.tsx`) as Promise<Mod>;
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

export function useWidget(id: string, v: number): { Comp: ComponentType | null; error: string | null } {
  const [st, setSt] = useState<{ key: string; Comp: ComponentType | null; error: string | null }>({ key: "", Comp: null, error: null });
  const key = `${id}@${v}`;
  useEffect(() => {
    let alive = true;
    loadWidget(id, v).then(
      (m) => alive && setSt({ key, Comp: m.default, error: typeof m.default === "function" ? null : "o módulo não exporta um componente padrão" }),
      (e) => alive && setSt({ key, Comp: null, error: String(e?.message ?? e) }),
    );
    return () => {
      alive = false;
    };
  }, [id, v, key]);
  return st.key === key ? { Comp: st.Comp, error: st.error } : { Comp: null, error: null };
}

export class SlotBoundary extends Component<{ children: ReactNode; fallback: (err: Error, reset: () => void) => ReactNode; onError?: (e: Error) => void }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  componentDidCatch(err: Error) {
    this.props.onError?.(err);
  }
  render() {
    if (this.state.err) return this.props.fallback(this.state.err, () => this.setState({ err: null }));
    return this.props.children;
  }
}

// ------------------------------------------------------------ render de teste

function TestRender({ widget, v, done }: { widget: string; v: number; done: () => void }) {
  const { Comp, error } = useWidget(widget, v);
  const reported = useRef(false);
  const report = (ok: boolean, err?: string) => {
    if (reported.current) return;
    reported.current = true;
    call(`/widgets/${widget}/versions/${v}/test`, { body: { ok, error: err } }).finally(done);
  };
  useEffect(() => {
    if (error) report(false, `não carregou: ${error}`);
  }, [error]);
  useEffect(() => {
    if (!Comp) return;
    // monta, deixa os efeitos rodarem; sem exceção em 1,5 s = aprovado
    const t = setTimeout(() => report(true), 1500);
    return () => clearTimeout(t);
  }, [Comp]);
  if (!Comp) return null;
  return (
    <SlotBoundary fallback={() => null} onError={(e) => report(false, e.message)}>
      <Comp />
    </SlotBoundary>
  );
}

/** Harness oculto: recebe pedidos de teste por SSE e renderiza fora da tela. */
export function TestHarness() {
  const [tests, setTests] = useState<{ widget: string; v: number }[]>([]);
  useEffect(() => {
    const off = onWidgetTest((t) => setTests((cur) => (cur.some((x) => x.widget === t.widget && x.v === t.v) ? cur : [...cur, t])));
    return () => {
      off();
    };
  }, []);
  return (
    <div aria-hidden style={{ position: "fixed", left: -10000, top: 0, width: 420, height: 600, overflow: "hidden", pointerEvents: "none" }}>
      {tests.map((t) => (
        <TestRender key={`${t.widget}@${t.v}`} widget={t.widget} v={t.v} done={() => setTests((cur) => cur.filter((x) => !(x.widget === t.widget && x.v === t.v)))} />
      ))}
    </div>
  );
}
