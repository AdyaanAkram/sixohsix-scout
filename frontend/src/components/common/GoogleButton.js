import { useEffect, useRef } from "react";

// Feature flag: no client id → Google sign-in is hidden everywhere.
export const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || "";
export const googleEnabled = !!GOOGLE_CLIENT_ID;

/**
 * Renders the Google Identity Services button and hands the raw credential
 * (JWT) to `onCredential`. The GIS script loads async from index.html, so we
 * poll briefly until window.google is available before rendering.
 */
export default function GoogleButton({ onCredential, text = "signin_with" }) {
  const slot = useRef(null);
  const cb = useRef(onCredential);
  cb.current = onCredential;

  useEffect(() => {
    if (!googleEnabled) return undefined;
    let cancelled = false;
    let timer = null;

    const tryRender = () => {
      if (cancelled) return;
      const gsi = window.google?.accounts?.id;
      if (!gsi || !slot.current) {
        timer = setTimeout(tryRender, 250); // script not loaded yet — retry
        return;
      }
      gsi.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (resp) => {
          if (resp?.credential) cb.current?.(resp.credential);
        },
      });
      gsi.renderButton(slot.current, { theme: "outline", size: "large", shape: "pill", width: 320, text });
    };

    tryRender();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [text]);

  if (!googleEnabled) return null;
  return <div ref={slot} className="flex justify-center" data-testid="google-signin-button" />;
}
