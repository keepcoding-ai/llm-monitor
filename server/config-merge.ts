// Merge do PUT /config: `pulse` e `chat` entram campo a campo (o corpo pode trazer só uma parte).
import { ChatConfigSchema, type Config } from "./store.ts";

export function mergeConfig(cur: Config, body: Partial<Config>): Config {
  const bodyChat = body.chat && typeof body.chat === "object" ? body.chat : {};
  // front antigo: manda só o espelho `chatModel` quando troca o modelo
  const legacy = typeof body.chatModel === "string" && body.chatModel !== cur.chatModel && !("model" in bodyChat) ? { model: body.chatModel } : {};
  const merged: Record<string, unknown> = { ...cur.chat, ...legacy, ...bodyChat };
  if (merged.effort == null) delete merged.effort; // null limpa: volta ao padrão do modelo
  const chat = ChatConfigSchema.parse(merged);
  return { ...cur, ...body, pulse: { ...cur.pulse, ...(body.pulse ?? {}) }, chat, chatModel: chat.model };
}
