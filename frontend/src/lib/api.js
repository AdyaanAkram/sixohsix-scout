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

// Plain-English fallbacks by status. Coaches and parents read these on a phone
// at a ballpark; none of them can act on "Request failed with status code 500".
const STATUS_MESSAGE = {
  400: "That didn't look right. Check the details and try again.",
  401: "Your session has expired. Please sign in again.",
  403: "You do not have permission to do that.",
  404: "We could not find that.",
  409: "Someone else changed this first. Refresh the page and try again.",
  413: "That file is too large.",
  422: "Some details need fixing before this can save.",
  429: "Too many tries. Wait a minute, then try again.",
  500: "Something went wrong on our end. Please try again.",
  502: "The server is waking up. Give it a few seconds and try again.",
  503: "The server is waking up. Give it a few seconds and try again.",
  504: "That took too long. Please try again.",
};

// A pydantic 422 body is a list of {loc, msg}. Name the field in words instead
// of printing the raw object — JSON.stringify in a toast helps nobody.
const fieldLabel = (loc) => {
  const key = Array.isArray(loc) ? loc[loc.length - 1] : loc;
  if (typeof key !== "string" || key === "body") return null;
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

export const errMsg = (e, fallback = "Something went wrong.") => {
  const detail = e?.response?.data?.detail;
  // Server-written strings are already meant for people — pass them through.
  if (typeof detail === "string" && detail.trim()) return detail;

  if (Array.isArray(detail) && detail.length) {
    const parts = detail
      .map((d) => {
        const label = fieldLabel(d?.loc);
        const msg = typeof d?.msg === "string" ? d.msg : null;
        if (label && msg) return `${label}: ${msg}`;
        return label || msg;
      })
      .filter(Boolean);
    if (parts.length) return parts.slice(0, 3).join(" · ");
    return STATUS_MESSAGE[422];
  }

  // No response at all means the request never landed.
  if (!e?.response) {
    if (e?.code === "ECONNABORTED" || /timeout/i.test(e?.message || "")) {
      return "That took too long. Check your connection and try again.";
    }
    return navigator.onLine === false
      ? "You are offline. Reconnect and try again."
      : "Cannot reach 60'6\" ID right now. Check your connection and try again.";
  }

  return STATUS_MESSAGE[e.response.status] || fallback;
};
