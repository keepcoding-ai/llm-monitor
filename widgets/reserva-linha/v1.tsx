// Reserva na home (plano G4): quantas contas Soul têm cota e qual usar a seguir. Um toque leva à página.
import { CaretRight } from "@phosphor-icons/react";
import { useSnapshot } from "../../src/sdk";
import { go } from "../../src/router";
import { recommend } from "../../shared/reserve";

export default function ReservaLinha() {
  const s = useSnapshot();
  if (!s) return null;
  const pools = s.soul.filter((p) => p.ok);
  const withQuota = pools.flatMap((p) => p.accounts).filter((a) => a.state === "ok").length;
  const rec = pools.map(recommend);
  const next = rec.find((r) => r.kind === "account");
  const sub =
    next && next.kind === "account"
      ? `próxima: ${next.account.label}${next.account.resetsAt ? ` · renova ${new Date(next.account.resetsAt).toLocaleDateString("pt-BR", { weekday: "short" })}` : " · livre agora"}`
      : rec.every((r) => r.kind === "single")
        ? "só 1 conta no pool — nenhuma reserva para trocar"
        : "nenhuma outra conta com cota agora";
  const broken = s.soul.filter((p) => !p.ok).length;
  return (
    <button type="button" onClick={() => go("reserva")} className="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" aria-label="Abrir a página Reserva">
      <span className="min-w-0">
        <span className="block text-sm font-medium">
          {withQuota} {withQuota === 1 ? "conta Soul com cota" : "contas Soul com cota"}
          {broken ? <span className="text-x-error"> · {broken} pool com erro</span> : null}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{sub}</span>
      </span>
      <CaretRight className="shrink-0 text-muted-foreground" />
    </button>
  );
}
