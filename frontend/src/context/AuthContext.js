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

  useEffect(() => {
    const t = getToken();
    if (!t) {
      setLoading(false);
      return;
    }
    api
      .get("/auth/me")
      .then((r) => {
        setUser(r.data);
        localStorage.setItem("pbg_user", JSON.stringify(r.data));
      })
      .catch(() => {
        clearToken();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const r = await api.post("/auth/login", { email, password });
    setToken(r.data.token);
    setUser(r.data.user);
    localStorage.setItem("pbg_user", JSON.stringify(r.data.user));
    return r.data.user;
  };

  const acceptInvite = async (token, password) => {
    const r = await api.post("/auth/accept-invitation", { token, password });
    setToken(r.data.token);
    setUser(r.data.user);
    localStorage.setItem("pbg_user", JSON.stringify(r.data.user));
    return r.data.user;
  };

  const logout = () => {
    clearToken();
    setUser(null);
    window.location.href = "/signin";
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, acceptInvite }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
