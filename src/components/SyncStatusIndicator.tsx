import { useState } from "react";
import { format } from "date-fns";
import { Cloud, CloudOff, RefreshCw, AlertTriangle, CheckCircle2, Clock, Trash2, GitMerge, ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import type { QueuedSale } from "@/lib/offlineQueue";

function StatusPill({ item }: { item: QueuedSale }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "Pending", cls: "bg-warning/15 text-warning border-warning/30" },
    syncing: { label: "Syncing", cls: "bg-accent/15 text-accent border-accent/30" },
    synced: { label: "Synced", cls: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
    failed: { label: "Failed", cls: "bg-destructive/15 text-destructive border-destructive/30" },
    conflict: { label: "Conflict", cls: "bg-destructive/15 text-destructive border-destructive/30" },
  };
  const s = map[item.status] ?? map.pending;
  return <span className={`text-[10px] px-1.5 py-0.5 rounded border ${s.cls}`}>{s.label}</span>;
}

export default function SyncStatusIndicator({ compact = false }: { compact?: boolean }) {
  const { online, items, counts, syncing, lastSyncAt, syncNow, resolveConflict, retryItem, discardItem, clearSyncedItems } = useOfflineSync();
  const [open, setOpen] = useState(false);

  const attention = counts.conflict + counts.failed;
  const badgeCount = counts.pending + attention;

  const tone = !online
    ? "text-warning"
    : attention > 0
      ? "text-destructive"
      : counts.pending > 0
        ? "text-accent"
        : "text-muted-foreground";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size={compact ? "icon" : "sm"} className={`relative ${compact ? "h-8 w-8" : "h-8 px-2 gap-2"} ${tone}`} aria-label="Sync status">
          {online ? <Cloud className="h-4 w-4" /> : <CloudOff className="h-4 w-4" />}
          {!compact && <span className="text-xs font-medium">{online ? (counts.pending > 0 ? "Syncing data" : "Online") : "Offline"}</span>}
          {badgeCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
              {badgeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] p-0">
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold">
              {online ? <Cloud className="h-4 w-4 text-accent" /> : <CloudOff className="h-4 w-4 text-warning" />}
              {online ? "Connected" : "Working offline"}
            </div>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => syncNow()} disabled={!online || syncing}>
              <RefreshCw className={`h-3 w-3 mr-1 ${syncing ? "animate-spin" : ""}`} /> Sync now
            </Button>
          </div>
          <div className="grid grid-cols-4 gap-1 text-center">
            {[
              { label: "Pending", value: counts.pending, icon: Clock, cls: "text-warning" },
              { label: "Conflicts", value: counts.conflict, icon: ArrowRightLeft, cls: "text-destructive" },
              { label: "Failed", value: counts.failed, icon: AlertTriangle, cls: "text-destructive" },
              { label: "Synced", value: counts.synced, icon: CheckCircle2, cls: "text-emerald-600" },
            ].map((s) => (
              <div key={s.label} className="rounded border border-border py-1.5">
                <s.icon className={`h-3.5 w-3.5 mx-auto ${s.cls}`} />
                <p className="text-sm font-bold font-mono">{s.value}</p>
                <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {lastSyncAt ? `Last sync check ${format(lastSyncAt, "HH:mm:ss")}` : "No sync yet this session"}
            {!online && " · sales are saved on this laptop and upload automatically"}
          </p>
        </div>

        <ScrollArea className="max-h-80">
          {items.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground text-center">Everything is up to date. No offline sales waiting.</p>
          ) : (
            <div className="divide-y divide-border">
              {items.map((i) => (
                <div key={i.id} className="p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold">{i.fuel.name} · {i.litres.toFixed(2)} L</span>
                    <StatusPill item={i} />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{format(new Date(i.capturedAt), "MMM d, HH:mm")} · {i.paymentMethod.toUpperCase()}</span>
                    <span className="font-mono">KES {i.totalAmount.toLocaleString()}</span>
                  </div>
                  {i.branchName && <p className="text-[10px] text-muted-foreground">{i.branchName}</p>}

                  {i.status === "conflict" && i.conflict && (
                    <div className="rounded border border-destructive/30 bg-destructive/5 p-2 space-y-2">
                      <p className="text-[11px] text-destructive">{i.conflict.message}</p>
                      <div className="grid grid-cols-2 gap-1">
                        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => resolveConflict(i.id, "merge")}>
                          <GitMerge className="h-3 w-3 mr-1" /> Merge
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => resolveConflict(i.id, "overwrite")}>
                          <ArrowRightLeft className="h-3 w-3 mr-1" /> Overwrite
                        </Button>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        Merge uses the current server value{i.conflict.kind === "stock" ? " (records only the litres still in stock)" : " (recalculates litres at today's price)"}.
                        Overwrite keeps exactly what was recorded offline. Either choice is written to the audit trail.
                      </p>
                    </div>
                  )}

                  {i.lastError && i.status !== "conflict" && (
                    <p className="text-[10px] text-destructive break-words">{i.lastError}</p>
                  )}

                  <div className="flex gap-2 pt-0.5">
                    {(i.status === "failed" || i.status === "pending") && (
                      <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2" onClick={() => retryItem(i.id)} disabled={!online}>
                        <RefreshCw className="h-3 w-3 mr-1" /> Retry
                      </Button>
                    )}
                    {i.status !== "syncing" && (
                      <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2 text-destructive" onClick={() => discardItem(i.id)}>
                        <Trash2 className="h-3 w-3 mr-1" /> Remove
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {counts.synced > 0 && (
          <div className="p-2 border-t border-border">
            <Button size="sm" variant="ghost" className="w-full h-7 text-[11px]" onClick={clearSyncedItems}>
              Clear {counts.synced} synced {counts.synced === 1 ? "record" : "records"}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export { StatusPill };
