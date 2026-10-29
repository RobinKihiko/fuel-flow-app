import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  getQueue, subscribeQueue, updateItem, removeItem, clearSynced, queueCounts,
  type QueuedSale, type QueuedFuel, type Resolution,
} from "@/lib/offlineQueue";

interface OfflineSyncContextType {
  online: boolean;
  items: QueuedSale[];
  counts: ReturnType<typeof queueCounts>;
  syncing: boolean;
  lastSyncAt: Date | null;
  syncNow: () => Promise<void>;
  resolveConflict: (id: string, resolution: Resolution) => Promise<void>;
  retryItem: (id: string) => Promise<void>;
  discardItem: (id: string) => void;
  clearSyncedItems: () => void;
}

const Ctx = createContext<OfflineSyncContextType | undefined>(undefined);

const EPS = 0.005;

async function readServerFuel(fuel: QueuedFuel) {
  const table = fuel.legacy ? "fuel_types" : "branch_fuel_types";
  const { data, error } = await supabase.from(table as any).select("*").eq("id", fuel.id).maybeSingle();
  if (error) throw error;
  return data as any | null;
}

async function resolveLegacyFuelId(fuel: QueuedFuel): Promise<string> {
  if (fuel.legacy) return fuel.id;
  const { data: match } = await supabase.from("fuel_types").select("id").eq("name", fuel.name).maybeSingle();
  if (match?.id) return match.id as string;
  const { data: created, error } = await supabase
    .from("fuel_types")
    .insert({ name: fuel.name, price_per_litre: fuel.pricePerLitre, stock_level: 0, vat_rate: fuel.vatRate } as any)
    .select("id").single();
  if (error) throw error;
  return created.id as string;
}

async function logSyncEvent(
  recordId: string | null,
  action: "offline_sync" | "offline_conflict_merge" | "offline_conflict_overwrite" | "offline_sync_failed",
  field: string | null,
  oldValue: string | null,
  newValue: string | null,
  context: Record<string, unknown>,
) {
  try {
    await supabase.rpc("log_offline_sync_event" as any, {
      _record_id: recordId,
      _action: action,
      _field: field,
      _old_value: oldValue,
      _new_value: newValue,
      _context: context as any,
    });
  } catch {
    // Audit logging must never block the upload of a real sale.
  }
}

export function OfflineSyncProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState<boolean>(typeof navigator === "undefined" ? true : navigator.onLine);
  const [items, setItems] = useState<QueuedSale[]>(() => getQueue());
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const busy = useRef(false);

  useEffect(() => subscribeQueue(() => setItems(getQueue())), []);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);

  // Push one queued sale to the server, applying any chosen conflict resolution.
  const pushItem = useCallback(async (item: QueuedSale) => {
    updateItem(item.id, { status: "syncing", lastError: undefined });

    const server = await readServerFuel(item.fuel);
    if (!server) throw new Error("This fuel product no longer exists on the server.");

    const serverPrice = Number(server.price_per_litre ?? 0);
    const serverStock = Number(server.stock_level ?? 0);

    let litres = item.litres;
    let total = item.totalAmount;
    const resolution = item.resolution;

    // Conflict 1: the product price changed while we were offline.
    const priceChanged = Math.abs(serverPrice - item.fuel.pricePerLitre) > EPS;
    // Conflict 2: not enough stock left to cover the offline sale.
    const shortStock = item.litres - serverStock > EPS;

    if ((priceChanged || shortStock) && !resolution) {
      const kind = shortStock ? "stock" : "price";
      updateItem(item.id, {
        status: "conflict",
        conflict: {
          kind,
          message: shortStock
            ? `Only ${serverStock.toFixed(2)} L of ${item.fuel.name} remain, but this offline sale needs ${item.litres.toFixed(2)} L.`
            : `${item.fuel.name} was KES ${item.fuel.pricePerLitre.toFixed(2)}/L offline but is now KES ${serverPrice.toFixed(2)}/L.`,
          offlineValue: shortStock ? item.litres : item.fuel.pricePerLitre,
          serverValue: shortStock ? serverStock : serverPrice,
          detectedAt: new Date().toISOString(),
        },
      });
      return;
    }

    if (resolution === "merge") {
      if (shortStock) {
        litres = Math.max(0, Number(serverStock.toFixed(2)));
        total = Number((litres * serverPrice).toFixed(2));
      } else if (priceChanged) {
        // Keep the money the customer actually paid, re-derive litres at the current price.
        litres = Number((item.totalAmount / (serverPrice || item.fuel.pricePerLitre)).toFixed(2));
        total = item.totalAmount;
      }
    }

    if (litres <= 0) throw new Error("Nothing left to record after merging with current stock.");

    const legacyFuelId = await resolveLegacyFuelId(item.fuel);
    const { data: sale, error } = await supabase
      .from("sales")
      .insert({
        fuel_type_id: legacyFuelId,
        litres,
        total_amount: total,
        payment_method: item.paymentMethod,
        attendant_id: item.attendantId,
        branch_id: item.branchId,
        pump_id: item.pumpId,
        created_at: item.capturedAt,
      } as any)
      .select()
      .single();
    if (error) throw error;

    let stockNote: string | null = null;
    if (!item.fuel.legacy) {
      const { error: rpcErr } = await supabase.rpc("deduct_fuel_sale", {
        _branch_fuel_type_id: item.fuel.id,
        _litres: litres,
        _idempotency_key: item.id,
      });
      if (rpcErr) stockNote = rpcErr.message;
    } else {
      await supabase.from("fuel_types").update({ stock_level: Math.max(0, serverStock - litres) }).eq("id", item.fuel.id);
    }

    await logSyncEvent(
      sale.id,
      resolution === "merge" ? "offline_conflict_merge" : resolution === "overwrite" ? "offline_conflict_overwrite" : "offline_sync",
      resolution ? (item.conflict?.kind === "stock" ? "litres" : "price_per_litre") : null,
      resolution ? String(item.conflict?.offlineValue ?? "") : null,
      resolution ? String(item.conflict?.serverValue ?? "") : null,
      {
        offline_id: item.id,
        captured_at: item.capturedAt,
        recorded_litres: litres,
        recorded_total: total,
        offline_litres: item.litres,
        offline_total: item.totalAmount,
        resolution: resolution ?? "none",
        stock_note: stockNote,
      },
    );

    updateItem(item.id, {
      status: "synced",
      remoteSaleId: sale.id,
      syncedAt: new Date().toISOString(),
      litres,
      totalAmount: total,
      lastError: stockNote ? `Recorded, but stock could not be fully deducted: ${stockNote}` : undefined,
    });
  }, []);

  const syncNow = useCallback(async () => {
    if (busy.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    const queue = getQueue().filter((i) => i.status === "pending" || i.status === "failed" || (i.status === "conflict" && i.resolution));
    if (queue.length === 0) { setLastSyncAt(new Date()); return; }
    busy.current = true;
    setSyncing(true);
    try {
      for (const item of queue) {
        try {
          await pushItem(item);
        } catch (e: any) {
          const msg = e?.message ?? "Unknown error";
          updateItem(item.id, { status: "failed", attempts: (item.attempts ?? 0) + 1, lastError: msg });
          await logSyncEvent(null, "offline_sync_failed", null, null, null, { offline_id: item.id, error: msg });
        }
      }
      setLastSyncAt(new Date());
    } finally {
      busy.current = false;
      setSyncing(false);
    }
  }, [pushItem]);

  // Auto-sync when the connection returns, and periodically while online.
  useEffect(() => {
    if (!online) return;
    void syncNow();
    const t = setInterval(() => { void syncNow(); }, 30000);
    return () => clearInterval(t);
  }, [online, syncNow]);

  const resolveConflict = useCallback(async (id: string, resolution: Resolution) => {
    updateItem(id, { resolution, status: "pending" });
    await syncNow();
  }, [syncNow]);

  const retryItem = useCallback(async (id: string) => {
    updateItem(id, { status: "pending", lastError: undefined });
    await syncNow();
  }, [syncNow]);

  const value: OfflineSyncContextType = {
    online,
    items,
    counts: queueCounts(items),
    syncing,
    lastSyncAt,
    syncNow,
    resolveConflict,
    retryItem,
    discardItem: (id: string) => removeItem(id),
    clearSyncedItems: () => clearSynced(),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOfflineSync() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useOfflineSync must be used within OfflineSyncProvider");
  return ctx;
}
