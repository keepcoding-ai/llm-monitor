// Passos de ferramenta do chat: o que o agente fez entre o texto de um turno e o do outro.
export type ChatStep = {
  id: string;
  name: string;
  /** resumo do input, ≤300 caracteres */
  input: string;
  status: "running" | "done" | "error";
  /** resumo do resultado, ≤500 caracteres; preenchido quando o passo termina */
  output?: string;
  at: string;
};
