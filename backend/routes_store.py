"""Affiliate store: gear the org recommends, purchased through affiliate links.

No payments touch this platform — every product links OUT to the retailer with
the coach's affiliate URL. Admins manage items; the storefront is public.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import ADMIN_ROLES, require_roles
from db import clean, db, log_audit, new_id, now_iso

router = APIRouter(tags=["store"])

STORE_CATEGORIES = ["Bats", "Gloves", "Training", "Apparel", "Accessories", "Other"]


class StoreItemBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    category: str = "Other"
    price_text: str | None = Field(default=None, max_length=40)  # "$129.99" — display only
    image_url: str | None = None                                  # external product image
    affiliate_url: str = Field(min_length=8)                      # where Buy links out to
    featured: bool = False
    display_order: int = 0


@router.get("/public/store")
async def public_store():
    """Public storefront — active items only, no auth."""
    items = await db.store_items.find(
        {"active": {"$ne": False}}, {"_id": 0}).to_list(200)
    items.sort(key=lambda i: (not i.get("featured"), i.get("display_order", 0), i.get("name", "")))
    return {"categories": STORE_CATEGORIES, "items": items}


@router.post("/store-items")
async def create_store_item(body: StoreItemBody, user=Depends(require_roles(*ADMIN_ROLES))):
    if not body.affiliate_url.startswith(("http://", "https://")):
        raise HTTPException(status_code=422, detail="Affiliate URL must be a full http(s) link.")
    doc = {
        "id": new_id(), "organization_id": user["organization_id"],
        **body.model_dump(), "active": True,
        "created_by": user["id"], "created_at": now_iso(), "updated_at": now_iso(),
    }
    await db.store_items.insert_one({**doc})
    await log_audit(user["organization_id"], user, "store_item_created", "store_item", doc["id"],
                    {"name": body.name})
    return clean(doc)


@router.patch("/store-items/{item_id}")
async def update_store_item(item_id: str, body: StoreItemBody,
                            user=Depends(require_roles(*ADMIN_ROLES))):
    if not body.affiliate_url.startswith(("http://", "https://")):
        raise HTTPException(status_code=422, detail="Affiliate URL must be a full http(s) link.")
    res = await db.store_items.update_one(
        {"id": item_id, "organization_id": user["organization_id"]},
        {"$set": {**body.model_dump(), "updated_at": now_iso()}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Store item not found.")
    await log_audit(user["organization_id"], user, "store_item_updated", "store_item", item_id,
                    {"name": body.name})
    return {"message": "Item updated."}


@router.delete("/store-items/{item_id}")
async def delete_store_item(item_id: str, user=Depends(require_roles(*ADMIN_ROLES))):
    res = await db.store_items.delete_one(
        {"id": item_id, "organization_id": user["organization_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Store item not found.")
    await log_audit(user["organization_id"], user, "store_item_deleted", "store_item", item_id, None)
    return {"message": "Item removed."}
