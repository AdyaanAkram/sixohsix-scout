import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { PublicNav, PublicFooter } from "@/components/marketing/PublicShell";
import { Pencil, Plus, ShoppingBag, Trash2 } from "lucide-react";

/* All sub-components live at MODULE level — inline component definitions
   cause focus loss on every re-render in this codebase. */

const EMPTY_FORM = {
  name: "",
  description: "",
  category: "Other",
  price_text: "",
  image_url: "",
  affiliate_url: "",
  featured: false,
  display_order: 0,
};

function ProductImage({ item }) {
  const [failed, setFailed] = useState(false);
  if (item.image_url && !failed) {
    return (
      <img
        src={item.image_url}
        alt={item.name}
        loading="lazy"
        className="h-44 w-full object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div
      className="h-44 w-full flex items-center justify-center"
      style={{ background: "linear-gradient(135deg, hsl(var(--brand) / 0.3), hsl(var(--surface-3)))" }}
    >
      <span className="font-display text-2xl text-foreground/80">{item.category || "Gear"}</span>
    </div>
  );
}

function ProductCard({ item, isAdmin, onEdit, onDelete }) {
  return (
    <div
      className="mk-card rounded-xl border border-border bg-surface-2 overflow-hidden flex flex-col relative"
      data-testid={`store-item-${item.id}`}
    >
      {item.featured && (
        <Badge className="absolute top-3 left-3 z-10 bg-brand text-primary-foreground border-0 rounded-full px-2.5">
          Featured
        </Badge>
      )}
      {isAdmin && (
        <div className="absolute top-2 right-2 z-10 flex gap-1.5">
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8 rounded-full bg-background/80 backdrop-blur border-border"
            onClick={() => onEdit(item)}
            aria-label={`Edit ${item.name}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8 rounded-full bg-background/80 backdrop-blur border-border text-brand hover:text-brand"
            onClick={() => onDelete(item)}
            aria-label={`Delete ${item.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
      <ProductImage item={item} />
      <div className="p-4 flex flex-col flex-1">
        <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{item.category}</p>
        <h3 className="mt-1 font-display text-base text-foreground leading-snug">{item.name}</h3>
        {item.description ? (
          <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed mk-clamp-2">{item.description}</p>
        ) : null}
        <div className="mt-auto pt-4 flex items-center justify-between gap-3">
          <span className="font-mono-num text-sm font-semibold text-foreground">{item.price_text || ""}</span>
          <Button
            asChild
            size="sm"
            className="rounded-full h-9 px-4 font-bold bg-brand hover:bg-brand-secondary text-primary-foreground"
          >
            <a href={item.affiliate_url} target="_blank" rel="noopener noreferrer sponsored">
              Shop now →
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}

function ItemDialog({ open, onOpenChange, form, setForm, categories, editing, saving, onSave }) {
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            {editing ? "Edit product" : "Add product"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="store-name">Name</Label>
            <Input
              id="store-name"
              value={form.name}
              onChange={set("name")}
              placeholder="Marucci CAT X (-10)"
              data-testid="store-form-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="store-desc">Description</Label>
            <Textarea
              id="store-desc"
              value={form.description}
              onChange={set("description")}
              placeholder="Why we recommend it…"
              rows={3}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select
                value={form.category}
                onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}
              >
                <SelectTrigger data-testid="store-form-category">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="store-price">Price text</Label>
              <Input id="store-price" value={form.price_text} onChange={set("price_text")} placeholder="$129.99" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="store-image">Image URL</Label>
            <Input id="store-image" value={form.image_url} onChange={set("image_url")} placeholder="https://…" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="store-affiliate">Affiliate URL</Label>
            <Input
              id="store-affiliate"
              value={form.affiliate_url}
              onChange={set("affiliate_url")}
              placeholder="https://partner.example.com/…"
              data-testid="store-form-affiliate"
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Switch
                id="store-featured"
                checked={form.featured}
                onCheckedChange={(v) => setForm((f) => ({ ...f, featured: v }))}
              />
              <Label htmlFor="store-featured">Featured</Label>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="store-order" className="whitespace-nowrap">Display order</Label>
              <Input
                id="store-order"
                type="number"
                className="w-20"
                value={form.display_order}
                onChange={set("display_order")}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={onSave}
            disabled={saving}
            className="rounded-full font-bold bg-brand hover:bg-brand-secondary text-primary-foreground"
            data-testid="store-form-save"
          >
            {saving ? "Saving…" : editing ? "Save changes" : "Add product"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Store({ embedded = false }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "owner" || user?.role === "admin";

  const [data, setData] = useState(null); // {categories, items}
  const [loadingStore, setLoadingStore] = useState(true);
  const [activeCat, setActiveCat] = useState("All");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null); // item being edited or null
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api
      .get("/public/store")
      .then((r) => setData({ categories: r.data?.categories || [], items: r.data?.items || [] }))
      .catch(() => setData({ categories: [], items: [] }))
      .finally(() => setLoadingStore(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const items = useMemo(() => data?.items || [], [data]);
  const categories = useMemo(() => data?.categories || [], [data]);

  const chipCats = useMemo(() => {
    const withItems = categories.filter((c) => items.some((i) => i.category === c));
    return ["All", ...withItems];
  }, [categories, items]);

  const visible = useMemo(
    () => (activeCat === "All" ? items : items.filter((i) => i.category === activeCat)),
    [items, activeCat]
  );

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (item) => {
    setEditing(item);
    setForm({
      name: item.name || "",
      description: item.description || "",
      category: item.category || "Other",
      price_text: item.price_text || "",
      image_url: item.image_url || "",
      affiliate_url: item.affiliate_url || "",
      featured: !!item.featured,
      display_order: item.display_order ?? 0,
    });
    setDialogOpen(true);
  };

  const save = async () => {
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      category: form.category || "Other",
      price_text: form.price_text.trim() || null,
      image_url: form.image_url.trim() || null,
      affiliate_url: form.affiliate_url.trim(),
      featured: !!form.featured,
      display_order: Number(form.display_order) || 0,
    };
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/store-items/${editing.id}`, payload);
        toast.success("Product updated.");
      } else {
        await api.post("/store-items", payload);
        toast.success("Product added.");
      }
      setDialogOpen(false);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item) => {
    if (!window.confirm(`Remove "${item.name}" from the store?`)) return;
    try {
      await api.delete(`/store-items/${item.id}`);
      toast.success("Product removed.");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className={embedded ? "flex flex-col" : "min-h-screen bg-background text-foreground flex flex-col"} data-testid="store-page">
      {!embedded && <PublicNav />}

      {/* Hero strip */}
      <section className={embedded
        ? "relative overflow-hidden pb-8 border-b border-border"
        : "relative overflow-hidden pt-28 sm:pt-32 pb-10 sm:pb-14 border-b border-border"}>
        <div className="absolute inset-0 mk-hero-sweep" aria-hidden />
        <div className="relative max-w-6xl mx-auto px-5 sm:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand">Affiliate store</p>
          <h1 className="mt-2 font-display text-4xl sm:text-5xl tracking-tight text-foreground">
            The 60&apos;6&quot; Locker
          </h1>
          <p className="mt-3 text-sm sm:text-base text-muted-foreground max-w-xl leading-relaxed">
            Gear our coaches actually recommend. Every purchase is completed on a trusted partner&apos;s
            site through our affiliate links — nothing is sold on this platform.
          </p>
          {isAdmin && (
            <Button
              onClick={openAdd}
              className="mt-5 rounded-full h-11 px-6 font-bold bg-brand hover:bg-brand-secondary text-primary-foreground"
              data-testid="store-add-button"
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Add product
            </Button>
          )}
        </div>
      </section>

      {/* Catalog */}
      <section className="flex-1 max-w-6xl mx-auto w-full px-5 sm:px-8 py-10 sm:py-12">
        {chipCats.length > 1 && (
          <div className="flex flex-wrap gap-2 mb-8">
            {chipCats.map((c) => (
              <button
                key={c}
                onClick={() => setActiveCat(c)}
                className={`rounded-full px-4 h-9 text-sm font-semibold border transition-colors ${
                  activeCat === c
                    ? "bg-brand text-primary-foreground border-brand"
                    : "bg-surface-2 text-muted-foreground border-border hover:text-foreground hover:bg-surface-3"
                }`}
                data-testid={`store-cat-${c.toLowerCase()}`}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {loadingStore ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-72 rounded-xl bg-surface-3" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface-2/50 p-14 text-center">
            <ShoppingBag className="h-9 w-9 text-brand mx-auto" />
            <p className="mt-3 font-display text-xl text-foreground">Gear drops coming soon.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              We&apos;re curating the bats, gloves and training gear we trust. Check back shortly.
            </p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {visible.map((item) => (
              <ProductCard
                key={item.id}
                item={item}
                isAdmin={isAdmin}
                onEdit={openEdit}
                onDelete={remove}
              />
            ))}
          </div>
        )}
      </section>

      <ItemDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        form={form}
        setForm={setForm}
        categories={categories.length ? categories : ["Bats", "Gloves", "Training", "Apparel", "Accessories", "Other"]}
        editing={!!editing}
        saving={saving}
        onSave={save}
      />

      {!embedded && <PublicFooter />}
    </div>
  );
}
