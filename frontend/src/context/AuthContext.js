import { createContext, useContext, useEffect, useState } from "react";
import { api, clearToken, getToken, setToken } from "@/lib/api";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("pbg_user") || "null");
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(!!getToken());

  const persistUser = (u) => {
    setUser(u);
    localStorage.setItem("pbg_user", JSON.stringify(u));
  };

  useEffect(() => {
    const t = getToken();
    if (!t) {
      setLoading(false);
      return;
    }
    api
      .get("/auth/me")
      .then((r) => persistUser(r.data))
      .catch(() => {
        clearToken();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password, organizationId) => {
    const r = await api.post("/auth/login", {
      email,
      password,
      organization_id: organizationId || undefined,
    });
    setToken(r.data.token);
    persistUser(r.data.user);
    return r.data.user;
  };

  const acceptInvite = async (token, password) => {
    const r = await api.post("/auth/accept-invitation", { token, password });
    setToken(r.data.token);
    persistUser(r.data.user);
    return r.data.user;
  };

  const switchOrganization = async (organizationId) => {
    const r = await api.post("/auth/switch-organization", { organization_id: organizationId });
    setToken(r.data.token);
    persistUser(r.data.user);
    // Hard reload so every page refetches org-scoped data
    window.location.href = r.data.user?.role === "athlete" || r.data.user?.role === "parent"
      ? "/my-id"
      : "/dashboard";
    return r.data.user;
  };

  const logout = () => {
    clearToken();
    setUser(null);
    window.location.href = "/";
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, acceptInvite, switchOrganization }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
