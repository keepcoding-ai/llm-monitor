**APROVADA pelo dono em 01/10/2026 — em uso em server/llm.ts**

# MINUTA — contexto da tela no chat (não ligada)

Plano de interface §6: "Contexto da tela entra silenciosamente (veredito e janela decisiva; em Semana, o recorte; em Reserva, a conta)".

O cliente já envia `context` no `POST /api/v1/chat` (ex.: `tela: agora · veredito: Atenção. Nesse ritmo, a semana esgota sábado à noite…`).
O servidor recebe e **ignora** — mudar o que o LLM lê é decisão do dono.

## Proposta de texto (para `server/llm.ts`, função `chat`, acrescentado ao `system`)

```
Contexto da tela que o dono está vendo agora (use para entender a pergunta; não repita): {context}
```

## Proposta de troca no resumo (`compactSummary`)

Trocar `autonomia: s.autonomy` por `veredito: { estado: s.verdict.state, frase: s.verdict.headline, janelas: s.verdict.windows.map(w => ({ janela: w.label, usado: w.usedPct, renova: w.resetHuman, esgota: w.exhausts ? w.hitsHuman : null })) }`.
O campo `autonomy` continua sendo calculado só para não mudar o que o pulso e o chat leem hoje.
