// Notificação do browser (plano §8, G8): opt-in, nasce desligada. Uma por
// transição — o estado do veredito sobe (tranquilo → atenção → crítico) ou uma
// janela cruza 70/90 %. Nunca repetida: o último estado visto fica neste navegador.
import { useEffect, useState } from "react";
import { Button, ToggleGroup, ToggleGroupItem } from "@atrium/core-ui";
import { band, shouldNotify } from "../shared/notify";
import { pref, setPref } from "./router";
import { useSnapshot } from "./sdk";

const supported = typeof window !== "undefined" && "Notification" in window;

export function useNotifyEnabled() {
  const [on, setOn] = useState(() => pref("notify-on", false));
  return [on, (v: boolean) => (setPref("notify-on", v), setOn(v))] as const;
}

/** Montado uma vez no shell. Sem efeito enquanto a opção estiver desligada. */
export function VerdictNotifier() {
  const s = useSnapshot();
  const v = s?.verdict;
  useEffect(() => {
    if (!v) return;
    const cur = { state: v.underlying ?? v.state, bands: Object.fromEntries(v.windows.map((w) => [w.id, band(w.usedPct)])) };
    if (cur.state === "stale" || cur.state === "missing") return; // leitura antiga não muda o estado notificado
    const prev = pref<{ state: string; bands: Record<string, number> } | null>("notify-last", null);
    setPref("notify-last", cur);
    if (!pref("notify-on", false) || !supported || Notification.permission !== "granted") return;
    const why = shouldNotify(prev, cur);
    if (!why) return;
    try {
      new Notification(`LLM Monitor — ${{ ok: "Tranquilo", attention: "Atenção", critical: "Crítico", exhausted: "Sem Claude" }[cur.state] ?? "Mudou"}`, { body: v.headline, tag: "llm-monitor-verdict" });
    } catch {
      /* navegador recusou: a opção em Ajustes mostra o motivo */
    }
  }, [v?.underlying, v?.state, v?.headline]);
  return null;
}

export function NotifySetting() {
  const [on, setOn] = useNotifyEnabled();
  const [perm, setPerm] = useState(supported ? Notification.permission : "denied");
  if (!supported) return <p className="text-sm text-muted-foreground">Este navegador não oferece notificações.</p>;
  return (
    <div className="flex flex-col gap-2">
      <ToggleGroup
        type="single"
        value={on ? "on" : "off"}
        onValueChange={async (v: string) => {
          if (!v) return;
          if (v === "on" && Notification.permission === "default") setPerm(await Notification.requestPermission());
          setOn(v === "on");
        }}
        variant="outline"
        size="sm"
        className="justify-start"
      >
        <ToggleGroupItem value="off">Desligadas</ToggleGroupItem>
        <ToggleGroupItem value="on">Ligadas</ToggleGroupItem>
      </ToggleGroup>
      <p className="text-xs text-muted-foreground">
        {perm === "denied"
          ? "O navegador bloqueou as notificações deste endereço — libere nas permissões do site para elas chegarem."
          : "Avisa quando o veredito piora (tranquilo → atenção → crítico) ou uma janela passa de 70 % ou 90 %. Uma vez por mudança; a linha de status do terminal já mostra o veredito o tempo todo."}
      </p>
      {on && perm === "default" && (
        <Button size="sm" variant="outline" className="self-start" onClick={async () => setPerm(await Notification.requestPermission())}>
          Permitir no navegador
        </Button>
      )}
    </div>
  );
}
