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

  // Open self-signup (parent/guardian or 13+ athlete). Stores auth exactly like
  // login/acceptInvite; returns the full payload so callers can surface `joined`.
  const signup = async (payload) => {
    const r = await api.post("/auth/signup", payload);
    setToken(r.data.token);
    persistUser(r.data.user);
    return r.data;
  };

  // Google Identity Services credential exchange. Returns either an
  // authenticated payload ({token, user} — stored here) or
  // {needs_signup, email, name} for the caller to route to /signup.
  const googleAuth = async (credential) => {
    const r = await api.post("/auth/google", { credential });
    if (r.data?.token) {
      setToken(r.data.token);
      persistUser(r.data.user);
    }
    return r.data;
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
    <AuthContext.Provider value={{ user, loading, login, logout, signup, googleAuth, acceptInvite, switchOrganization }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
