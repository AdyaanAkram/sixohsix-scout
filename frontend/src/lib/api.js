import axios from "axios";

// unset → local CRA default; empty string → same-origin /api (nginx proxy).
const RAW = process.env.REACT_APP_BACKEND_URL;
const BACKEND_URL = (RAW === undefined || RAW === null)
  ? "http://127.0.0.1:8000"
  : String(RAW).trim().replace(/\/$/, "");
export const API = BACKEND_URL ? `${BACKEND_URL}/api` : "/api";

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

export const errMsg = (e, fallback = "Something went wrong.") => {
  const detail = e?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d) => d.msg || JSON.stringify(d)).join("; ");
  if (!e?.response && (e?.code === "ERR_NETWORK" || e?.message === "Network Error")) {
    return "Cannot reach the API. Is the backend running on port 8000?";
  }
  return e?.message || fallback;
};
