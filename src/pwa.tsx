// PWA: registro do service worker (vite-plugin-pwa, registerType "prompt") + avisos de
// rede/atualização. Prompt, e não autoUpdate: recarregar sozinho derrubaria uma conversa
// de chat em andamento — a pessoa escolhe quando atualizar. Componente-first (Alert do core-ui).
import { useEffect, useState, useSyncExternalStore } from "react";
import { registerSW } from "virtual:pwa-register";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@atrium/core-ui";
import { CloudSlash, ArrowsClockwise } from "@phosphor-icons/react";

let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
const subs = new Set<() => void>();
let needRefresh = false;
const emit = () => subs.forEach((f) => f());

/** Chamado uma vez em main.tsx. Falha de SW (http inseguro, browser sem suporte) nunca trava o app. */
export function registerPwa() {
  if (!("serviceWorker" in navigator)) return;
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      needRefresh = true;
      emit();
    },
    onRegisterError(e) {
      console.warn("[pwa] service worker não registrou:", e);
    },
  });
}

export function useOnlineStatus() {
  return useSyncExternalStore(
    (f) => {
      addEventListener("online", f);
      addEventListener("offline", f);
      return () => (removeEventListener("online", f), removeEventListener("offline", f));
    },
    () => navigator.onLine,
    () => true,
  );
}

function useNeedRefresh() {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => needRefresh,
  );
}

/** Faixa no fluxo: sem rede (a leitura em tela é a última recebida) e/ou versão nova pronta. */
export function PwaNotices() {
  const online = useOnlineStatus();
  const refresh = useNeedRefresh();
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!refresh) setHidden(false);
  }, [refresh]);
  if (online && (!refresh || hidden)) return null;
  return (
    <div className="mb-4 flex flex-col gap-2">
      {!online && (
        <Alert>
          <CloudSlash weight="light" aria-hidden="true" />
          <AlertTitle>Sem rede</AlertTitle>
          <AlertDescription>O app abre offline; o que aparece é a última leitura recebida. Volta ao vivo quando a rede voltar.</AlertDescription>
        </Alert>
      )}
      {refresh && !hidden && (
        <Alert>
          <ArrowsClockwise weight="light" aria-hidden="true" />
          <AlertTitle>Versão nova pronta</AlertTitle>
          <AlertDescription>Atualize quando for um bom momento — a conversa em andamento não é interrompida até lá.</AlertDescription>
          <AlertAction>
            <button type="button" className="text-sm font-medium underline underline-offset-4" onClick={() => void updateSW?.(true)}>
              Atualizar
            </button>{" "}
            <button type="button" className="ml-2 text-sm underline underline-offset-4" onClick={() => setHidden(true)}>
              Depois
            </button>
          </AlertAction>
        </Alert>
      )}
    </div>
  );
}
