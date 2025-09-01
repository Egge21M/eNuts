import "../shim";
import * as SQLite from "expo-sqlite";
import { ExpoSqliteRepositories } from "coco-cashu-expo-sqlite";
import { ConsoleLogger, Manager } from "coco-cashu-core";
import { getSeed } from "@src/storage/store/restore";
import { l } from "@src/logger";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type ManagerContextValue = {
  manager: Manager | null;
  ready: boolean;
  error: Error | null;
  waitUntilReady: () => Promise<Manager>;
};

const ManagerCtx = createContext<ManagerContextValue>({
  manager: null,
  ready: false,
  error: null,
  waitUntilReady: () => Promise.reject(new Error("Manager not initialized")),
});

/**
 * Returns the full manager context (including ready and error state).
 * Use this when you need to check readiness or display fallback UI.
 */
export const useManagerContext = () => useContext(ManagerCtx);

/**
 * Strict hook that returns a non-null Manager.
 * Throws an error if the manager is not ready. Use inside ManagerGate or
 * only in components that are guaranteed to render after manager is initialized.
 */
export const useManager = (): Manager => {
  const { manager } = useManagerContext();
  if (!manager) {
    throw new Error(
      "Manager is not ready. Wrap the component tree with <ManagerGate> or check readiness via useManagerContext()."
    );
  }
  return manager;
};

/**
 * Renders children only when manager is initialized.
 * Optionally accepts a fallback (e.g., spinner or null) while initializing,
 * and an errorFallback for error state.
 */
export const ManagerGate = ({
  children,
  fallback = null,
  errorFallback = null,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  errorFallback?: React.ReactNode;
}) => {
  const { manager, ready, error } = useManagerContext();
  if (error) return <>{errorFallback}</>;
  if (!ready || !manager) return <>{fallback}</>;
  return <>{children}</>;
};

export const ManagerProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [manager, setManager] = useState<Manager | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const resolveRef = useRef<((m: Manager) => void) | null>(null);
  const rejectRef = useRef<((e: Error) => void) | null>(null);
  const readyPromiseRef = useRef<Promise<Manager>>(
    new Promise<Manager>((resolve, reject) => {
      resolveRef.current = resolve;
      rejectRef.current = reject;
    })
  );

  useEffect(() => {
    async function initManager() {
      try {
        const db = await SQLite.openDatabaseAsync("cashu.db");
        const repo = new ExpoSqliteRepositories({ database: db });
        await repo.init();

        async function seedGetter() {
          const seed = await getSeed();
          if (!seed) {
            throw new Error("No seed found");
          }
          return seed;
        }

        const mgr = new Manager(repo, seedGetter, new ConsoleLogger(undefined));
        await mgr.enableMintQuoteWatcher();

        setManager(mgr);
        if (resolveRef.current) {
          resolveRef.current(mgr);
        }
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        l("[ManagerProvider] init error", err);
        if (rejectRef.current) {
          rejectRef.current(err);
        }
      } finally {
        setReady(true);
      }
    }
    void initManager();
  }, []);

  const waitUntilReady = () => {
    if (manager) return Promise.resolve(manager);
    return readyPromiseRef.current;
  };

  const value = useMemo(
    () => ({ manager, ready, error, waitUntilReady }),
    [manager, ready, error]
  );

  return <ManagerCtx.Provider value={value}>{children}</ManagerCtx.Provider>;
};
