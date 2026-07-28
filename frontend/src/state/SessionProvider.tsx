import { createContext, PropsWithChildren, useContext, useEffect, useState } from "react";

import { AuthOptions, SessionSnapshot } from "../models/api";
import { api } from "../services/api";

interface SessionContextValue {
  session: SessionSnapshot | null;
  authOptions: AuthOptions | null;
  loading: boolean;
  error: string | null;
  refreshSession: () => Promise<void>;
  setSessionSnapshot: (snapshot: SessionSnapshot) => void;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

function createEmptySession(): SessionSnapshot {
  return {
    authenticated: false,
    session_id: null,
    csrf_token: null,
    user: null,
    server: null,
    pending_server: null,
    server_state: null,
    can_manage_server_presets: false,
    can_manage_groups: false,
    capabilities: null,
    preferences: {
      theme_mode: "system",
      font_scale: 1,
      request_timeout_seconds: 30,
      live_log_poll_interval_ms: 2500,
      presentation_font_scale: 1.2,
      compact_ui: true,
      show_hidden_packages_in_tree: false,
      item_detail_view_mode: "standard",
    },
    bookmarks: [],
    saved_searches: [],
    recent_items: [],
  };
}

export function SessionProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [authOptions, setAuthOptions] = useState<AuthOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshSession = async () => {
    setLoading(true);
    setError(null);
    try {
      const [options, snapshot] = await Promise.all([api.getAuthOptions(), api.getSession()]);
      setAuthOptions(options);
      setSession(snapshot);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to load session";
      setError(message);
      setSession(createEmptySession());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshSession();
  }, []);

  return (
    <SessionContext.Provider
      value={{
        session,
        authOptions,
        loading,
        error,
        refreshSession,
        setSessionSnapshot: (snapshot) => setSession(snapshot),
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within SessionProvider");
  }
  return context;
}
