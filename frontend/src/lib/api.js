import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API });

export const getToken = () => localStorage.getItem("pbg_token");
export const setToken = (t) => localStorage.setItem("pbg_token", t);
export const clearToken = () => {
  localStorage.removeItem("pbg_token");
  localStorage.removeItem("pbg_user");
};

api.interceptors.request.use((cfg) => {
  const t = getToken();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && getToken() && !window.location.pathname.startsWith("/signin")) {
      clearToken();
      window.location.href = "/signin";
    }
    return Promise.reject(err);
  }
);

// signed URL for file downloads (PDF/CSV/media) opened in new tabs
export const signedUrl = (path) => {
  const sep = path.includes("?") ? "&" : "?";
  return `${API}${path}${sep}token=${getToken()}`;
};

export const errMsg = (e, fallback = "Something went wrong.") =>
  e?.response?.data?.detail || e?.message || fallback;
