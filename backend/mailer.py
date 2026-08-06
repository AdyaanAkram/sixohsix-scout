"""Transactional mailer — Resend in production, stdout in development.

Provider is chosen by settings.mail_provider ("resend" | "stdout"). Every send is
plain-text first with a branded HTML alternative; text is the source of truth so a
client that strips HTML still gets a usable message. Sends retry once on transient
Resend errors. Call sites that must not fail the surrounding mutation use safe_send.
"""
from __future__ import annotations

import time
from typing import Any

from config import settings


def _mask_email(email: str) -> str:
    if not email or "@" not in email:
        return "***"
    local, _, domain = email.partition("@")
    if len(local) <= 1:
        return f"*@{domain}"
    return f"{local[0]}***@{domain}"


TEMPLATES = {
    "athlete_invitation": {
        "subject": "Claim your 60'6\" ID profile",
        "body": (
            "Hi {name},\n\n"
            "You've been invited to create your athlete account for {org}.\n"
            "Open this link to set your password (expires in 14 days):\n\n"
            "{link}\n\n"
            "— 60'6\" Athletics\n"
        ),
    },
    "guardian_invitation": {
        "subject": "Create a guardian account for {athlete_name}",
        "body": (
            "Hi {name},\n\n"
            "You're invited as the guardian for {athlete_name} on {org}.\n"
            "Because they are under 13, the account is guardian-controlled.\n"
            "Set a password here (expires in 14 days):\n\n"
            "{link}\n\n"
            "— 60'6\" Athletics\n"
        ),
    },
    "password_reset": {
        "subject": "Reset your 60'6\" password",
        "body": (
            "Hi {name},\n\n"
            "Use this link to reset your password:\n\n{link}\n\n"
            "If you didn't request this, ignore this email.\n"
        ),
    },
    "staff_invitation": {
        "subject": "You're invited to 60'6\" ID",
        "body": (
            "Hi {name},\n\n"
            "You've been invited to join {org} as staff.\n"
            "Open this link to set your password (expires in 14 days):\n\n"
            "{link}\n\n"
            "— 60'6\" Athletics\n"
        ),
    },
    "event_access_code": {
        "subject": "Your 60'6\" event access code",
        "body": (
            "Hi {name},\n\n"
            "You've been given evaluator access to {event_name} on {org}.\n\n"
            "Your secure access code is: {code}\n\n"
            "Sign in at {app_url} with this email address and enter the code when asked.\n"
            "Access expires when the event is over.\n\n"
            "— 60'6\" Athletics\n"
        ),
    },
}

# Fields rendered as a prominent monospace block in the HTML (e.g. a short code).
_CODE_FIELDS = ("code",)


def _html_wrapper(subject: str, text_body: str, context: dict[str, Any]) -> str:
    """Minimal branded HTML: 60'6" wordmark, black header, red accent, a CTA
    button when the context carries a link, and a code chip when it carries a code."""
    paras = "".join(
        f'<p style="margin:0 0 14px;font-size:15px;line-height:1.5;color:#111827;">{line}</p>'
        for line in text_body.strip().split("\n\n")
        if not line.strip().startswith("http") and "{" not in line
        and not any(context.get(f) and str(context.get(f)) in line for f in ("link", *_CODE_FIELDS))
    )
    cta = ""
    if context.get("link"):
        cta = (
            f'<a href="{context["link"]}" '
            'style="display:inline-block;background:#DC2626;color:#ffffff;text-decoration:none;'
            'font-weight:700;padding:12px 22px;border-radius:8px;font-size:15px;">Open 60\'6" ID</a>'
        )
    code = ""
    if context.get("code"):
        code = (
            f'<div style="font-family:ui-monospace,Menlo,monospace;font-size:30px;font-weight:700;'
            f'letter-spacing:4px;color:#0A0A0A;background:#F3F4F6;border:1px solid #E5E7EB;'
            f'border-radius:10px;padding:16px;text-align:center;margin:6px 0 18px;">{context["code"]}</div>'
        )
    return (
        '<div style="margin:0;padding:24px;background:#F3F4F6;">'
        '<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;'
        'border:1px solid #E5E7EB;">'
        '<div style="background:#0A0A0A;padding:18px 24px;">'
        '<span style="color:#ffffff;font-size:18px;font-weight:800;letter-spacing:0.5px;">'
        '60\'6" <span style="color:#DC2626;">ID</span></span></div>'
        f'<div style="padding:24px;">{paras}{code}{cta}</div>'
        '<div style="padding:16px 24px;border-top:1px solid #F3F4F6;color:#9CA3AF;font-size:12px;">'
        '60\'6" Athletics · Train. Elevate. Succeed.</div>'
        '</div></div>'
    )


def _post_resend(payload: dict, api_key: str) -> None:
    import httpx
    last_exc = None
    for attempt in range(2):  # one retry on transient failure
        try:
            r = httpx.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {api_key}"},
                json=payload,
                timeout=15,
            )
            # 4xx is a permanent error (bad address/domain) — don't retry it.
            if 400 <= r.status_code < 500:
                r.raise_for_status()
            r.raise_for_status()
            return
        except Exception as e:  # noqa: BLE001 — retry transient, re-raise below
            last_exc = e
            status = getattr(getattr(e, "response", None), "status_code", None)
            if status is not None and 400 <= status < 500:
                raise
            if attempt == 0:
                time.sleep(0.8)
    raise last_exc


def send_template(to: str, template: str, context: dict[str, Any]) -> dict:
    tpl = TEMPLATES.get(template)
    if not tpl:
        raise ValueError(f"Unknown email template: {template}")
    subject = tpl["subject"].format(**context)
    body = tpl["body"].format(**context)
    provider = settings.mail_provider
    api_key = settings.resend_api_key
    mail_from = settings.mail_from

    if provider == "resend":
        if not api_key:
            raise RuntimeError("RESEND_API_KEY is not configured")
        _post_resend(
            {"from": mail_from, "to": [to], "subject": subject,
             "text": body, "html": _html_wrapper(subject, body, context)},
            api_key,
        )
        return {"sent": True, "provider": "resend", "email": _mask_email(to)}

    # Development / staging without Resend
    print("──────── MAIL (dev) ────────")
    print(f"To: {to}")
    print(f"Subject: {subject}")
    print(body)
    print("────────────────────────────")
    return {"sent": True, "provider": "stdout", "email": _mask_email(to)}


def safe_send(to: str, template: str, context: dict[str, Any]) -> dict:
    """Send without ever raising. Use where a mail outage must not roll back or 500
    the surrounding action (the caller already persisted state and can relay manually)."""
    try:
        return send_template(to, template, context)
    except Exception as e:  # noqa: BLE001 — deliberate: mail is best-effort here
        print(f"[mailer] send failed (template={template}, to={_mask_email(to)}): {e}")
        return {"sent": False, "provider": settings.mail_provider, "email": _mask_email(to), "error": str(e)}
