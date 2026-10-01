// Marcas: anomalias levantadas por regra (campo novo, versão nova, salto de
// ritmo, fonte que falhou). Nada é descartado em silêncio.
import { Badge, Button, Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@atrium/core-ui";
import { ago, call, useSnapshot } from "../../src/sdk";

const tone = { info: "info", warning: "warning", alert: "warning", error: "error" } as const;
const nome: Record<string, string> = { info: "aviso", warning: "atenção", alert: "alerta", error: "erro" };

export default function Marcas() {
  const s = useSnapshot();
  if (!s) return null;
  const open = s.flags.filter((f) => !f.ack);
  const seen = s.flags.length - open.length;
  if (open.length === 0)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Nenhuma marca aberta</EmptyTitle>
          <EmptyDescription>
            Formato dos dados conferido em {s.collector.filesScanned.toLocaleString("pt-BR")} arquivos{s.collector.claudeVersion ? `, Claude Code ${s.collector.claudeVersion}` : ""}.
            {seen ? ` ${seen} já vistas.` : ""}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return (
    <ul className="flex flex-col gap-2">
      {open.map((f) => (
        <li key={f.key} className="rounded-md border p-3">
          <div className="flex items-start justify-between gap-2">
            <span className="text-sm font-medium leading-snug">{f.title}</span>
            <Badge tone={tone[f.level]}>{nome[f.level]}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{f.detail}</p>
          <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {f.count > 1 ? `${f.count} vezes · ` : ""}última {ago(f.lastSeen)}
            </span>
            <Button size="sm" variant="ghost" onClick={() => call(`/flags/${encodeURIComponent(f.key)}/ack`, { body: {} })}>
              Marcar como vista
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
