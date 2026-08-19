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
    "assessment_published": {
        "subject": "{athlete_name}'s 60'6\" development assessment is ready",
        "body": (
            "Hi {name},\n\n"
            "{athlete_name}'s development assessment from {event} has been reviewed and "
            "released by {org}.\n"
            "Sign in to read it:\n\n"
            "{link}\n\n"
            "\u2014 60'6\" Athletics\n"
        ),
    },

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
    """60'6" branded HTML email.

    Table-based with inline styles on purpose: Gmail, Outlook and the iOS mail
    app strip <style> blocks and ignore flexbox, so anything fancier degrades
    into unstyled text for a large share of families. Max width 560px reads
    well on a phone, which is where most parents open this.
    """
    lines = [
        ln.strip() for ln in text_body.strip().split("\n\n")
        if ln.strip()
        and not ln.strip().startswith("http")
        and not ln.strip().startswith("\u2014")            # signature line, footer covers it
        and not any(context.get(f) and str(context.get(f)) in ln for f in ("link", *_CODE_FIELDS))
    ]
    greeting = ""
    if lines and lines[0].lower().startswith("hi "):
        greeting = lines.pop(0)

    paras = "".join(
        f'<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1F2937;'
        f'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">{ln}</p>'
        for ln in lines
    )
    greeting_html = (
        f'<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#111827;font-weight:600;'
        f'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">{greeting}</p>'
        if greeting else ""
    )

    cta = ""
    if context.get("link"):
        label = context.get("cta_label") or "Open 60\'6\" ID"
        cta = (
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
            'style="margin:8px 0 4px;"><tr><td style="border-radius:10px;background:#DC2626;">'
            f'<a href="{context["link"]}" style="display:inline-block;padding:14px 28px;'
            'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;'
            'font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">'
            f'{label}</a></td></tr></table>'
            f'<p style="margin:14px 0 0;font-size:12px;line-height:1.5;color:#9CA3AF;'
            'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">'
            f'Or paste this link into your browser:<br><span style="color:#6B7280;">{context["link"]}</span></p>'
        )

    code = ""
    if context.get("code"):
        code = (
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
            'style="margin:4px 0 20px;"><tr><td align="center" '
            'style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:32px;font-weight:700;'
            'letter-spacing:6px;color:#0A0A0A;background:#F9FAFB;border:1px solid #E5E7EB;'
            f'border-radius:12px;padding:20px 12px;">{context["code"]}</td></tr></table>'
        )

    org = context.get("org") or "60'6\" Athletics"
    preheader = (
        f'<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{subject}</div>'
    )

    return (
        f'{preheader}'
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
        'style="background:#F3F4F6;margin:0;padding:28px 12px;">'
        '<tr><td align="center">'
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" '
        'style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;'
        'border:1px solid #E5E7EB;">'

        # header
        '<tr><td style="background:#0A0A0A;padding:22px 28px;">'
        '<span style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;'
        'color:#ffffff;font-size:21px;font-weight:800;letter-spacing:-0.3px;">'
        '60\'6" <span style="color:#DC2626;">ID</span></span>'
        '<div style="margin-top:5px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;'
        'color:#9CA3AF;font-size:10px;letter-spacing:2.4px;text-transform:uppercase;">'
        'Train. Elevate. Succeed.</div></td></tr>'

        # red accent rule
        '<tr><td style="height:4px;background:#DC2626;font-size:0;line-height:0;">&nbsp;</td></tr>'

        # body
        f'<tr><td style="padding:30px 28px 28px;">{greeting_html}{paras}{code}{cta}</td></tr>'

        # footer
        '<tr><td style="padding:18px 28px 22px;border-top:1px solid #F3F4F6;background:#FAFAFA;">'
        '<p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;'
        f'font-size:12px;line-height:1.6;color:#6B7280;">Sent by <strong style="color:#374151;">{org}</strong> '
        'through 60\'6" ID — one permanent athlete profile for every camp, showcase and season.</p>'
        '<p style="margin:8px 0 0;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;'
        'font-size:11px;line-height:1.5;color:#9CA3AF;">'
        'You are receiving this because your athlete is registered with this organization.</p>'
        '</td></tr>'

        '</table></td></tr></table>'
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
