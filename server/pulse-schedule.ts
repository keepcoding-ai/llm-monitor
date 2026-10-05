// Agendador das análises automáticas (o pulso periódico do Haiku).
// Sem dependência de estado: tudo entra por injeção, para o teste provar que,
// desligado, nenhuma chamada ao LLM é agendada nem disparada.
// O chat e o "Pulsar agora" (iniciados pelo dono) não passam por aqui.

export type PulseScheduleDeps = {
  /** Lê a configuração viva a cada (re)agendamento — o toggle vale na hora. */
  config: () => { enabled: boolean; everyMinutes: number };
  /** O turno de LLM em si (pulse("agenda")). */
  run: () => Promise<unknown>;
  /** Depois de cada turno (republica o snapshot). */
  after?: () => void;
  setNextAt: (iso: string | null) => void;
  timers?: { set: (fn: () => void, ms: number) => unknown; clear: (t: unknown) => void };
  log?: (msg: string) => void;
};

export function createPulseScheduler(d: PulseScheduleDeps) {
  const timers = d.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t as NodeJS.Timeout) };
  let timer: unknown = null;

  function schedule(): void {
    if (timer) timers.clear(timer);
    timer = null;
    const cfg = d.config();
    if (!cfg.enabled) {
      d.setNextAt(null);
      return;
    }
    const ms = Math.max(5, cfg.everyMinutes) * 60_000;
    d.setNextAt(new Date(Date.now() + ms).toISOString());
    timer = timers.set(async () => {
      timer = null;
      // reconfere na hora de disparar: o flag pode ter sido desligado fora da API
      if (d.config().enabled) {
        try {
          await d.run();
        } catch (e) {
          d.log?.((e as Error).message);
        }
        d.after?.();
      }
      schedule();
    }, ms);
  }

  return { schedule, pending: () => timer != null };
}
