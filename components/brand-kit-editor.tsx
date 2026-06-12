"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { logAudit } from "@/lib/audit";

const MAX_COLORS = 5;
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** brand_colors jsonb is a hex array; older rows stored {name: hex}. */
function normalizeColors(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).slice(0, MAX_COLORS);
  if (value && typeof value === "object")
    return Object.values(value).map(String).slice(0, MAX_COLORS);
  return [];
}

function normalizeFonts(value: unknown): { primary: string; secondary: string } {
  const fonts = (value ?? {}) as Record<string, unknown>;
  return {
    primary: String(fonts.primary ?? ""),
    secondary: String(fonts.secondary ?? ""),
  };
}

/**
 * Editable brand kit (colors + fonts) — used on the team client
 * profile and the portal Branding tab. Saves brand_colors as a hex
 * array and brand_fonts as { primary, secondary }.
 */
export function BrandKitEditor({
  clientId,
  userId,
  initialColors,
  initialFonts,
}: {
  clientId: string;
  userId: string;
  initialColors: unknown;
  initialFonts: unknown;
}) {
  const [colors, setColors] = useState<string[]>(normalizeColors(initialColors));
  const [fonts, setFonts] = useState(normalizeFonts(initialFonts));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const invalidColor = colors.find((c) => !HEX_RE.test(c));

  function setColor(index: number, value: string) {
    setColors((prev) => prev.map((c, i) => (i === index ? value : c)));
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    const supabase = createClient();
    const brand_fonts: Record<string, string> = {};
    if (fonts.primary.trim()) brand_fonts.primary = fonts.primary.trim();
    if (fonts.secondary.trim()) brand_fonts.secondary = fonts.secondary.trim();

    const { error } = await supabase
      .from("clients")
      .update({ brand_colors: colors, brand_fonts })
      .eq("id", clientId);

    if (error) {
      setMessage(`Save failed: ${error.message}`);
    } else {
      setMessage("Brand kit saved.");
      await logAudit(supabase, {
        userId,
        entityType: "client",
        entityId: clientId,
        action: "brand_kit_updated",
        details: { colors: colors.length, fonts: Object.keys(brand_fonts) },
      });
    }
    setSaving(false);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="section-label">Colors</p>
        <div className="flex flex-wrap items-center gap-3">
          {colors.map((color, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 rounded-md border border-border p-1.5"
            >
              <input
                type="color"
                value={HEX_RE.test(color) ? color : "#000000"}
                onChange={(e) => setColor(i, e.target.value)}
                className="size-8 cursor-pointer rounded border-0 bg-transparent p-0"
                aria-label={`Brand color ${i + 1}`}
              />
              <Input
                value={color}
                onChange={(e) => setColor(i, e.target.value)}
                className="h-7 w-24 font-mono text-xs"
                placeholder="#2563eb"
                aria-label={`Brand color ${i + 1} hex`}
              />
              <button
                type="button"
                onClick={() => setColors((prev) => prev.filter((_, j) => j !== i))}
                className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                aria-label={`Remove color ${i + 1}`}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          {colors.length < MAX_COLORS && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setColors((prev) => [...prev, "#2563eb"])}
            >
              <Plus className="size-3.5" /> Add color
            </Button>
          )}
        </div>
        {invalidColor && (
          <p className="text-xs text-destructive">
            “{invalidColor}” isn’t a valid hex color (e.g. #2563eb).
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="brand-font-primary">Primary font</Label>
          <Input
            id="brand-font-primary"
            value={fonts.primary}
            onChange={(e) => setFonts({ ...fonts, primary: e.target.value })}
            placeholder="Inter"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="brand-font-secondary">Secondary font</Label>
          <Input
            id="brand-font-secondary"
            value={fonts.secondary}
            onChange={(e) => setFonts({ ...fonts, secondary: e.target.value })}
            placeholder="Georgia"
          />
        </div>
      </div>

      {message && (
        <p
          className={
            message === "Brand kit saved."
              ? "text-sm text-emerald-600 dark:text-emerald-400"
              : "text-sm text-destructive"
          }
        >
          {message}
        </p>
      )}
      <Button type="button" onClick={save} disabled={saving || !!invalidColor}>
        {saving ? "Saving…" : "Save brand kit"}
      </Button>
    </div>
  );
}
