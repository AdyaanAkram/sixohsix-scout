"""Transactional mailer — Resend in production, stdout in development."""
from __future__ import annotations

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
        "subject": "Claim your 60'6\" My ID profile",
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
        "subject": "You're invited to 60'6\" Scout",
        "body": (
            "Hi {name},\n\n"
            "You've been invited to join {org} as staff.\n"
            "Open this link to set your password (expires in 14 days):\n\n"
            "{link}\n\n"
            "— 60'6\" Athletics\n"
        ),
    },
}


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
        import httpx
        r = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"from": mail_from, "to": [to], "subject": subject, "text": body},
            timeout=15,
        )
        r.raise_for_status()
        return {"sent": True, "provider": "resend", "email": _mask_email(to)}

    # Development / staging without Resend
    print("──────── MAIL (dev) ────────")
    print(f"To: {to}")
    print(f"Subject: {subject}")
    print(body)
    print("────────────────────────────")
    return {"sent": True, "provider": "stdout", "email": _mask_email(to)}
