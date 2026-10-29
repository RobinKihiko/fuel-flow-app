import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useConfirmDelete } from "@/hooks/useConfirmDelete";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Undo2, Check, X, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface ReversalRow {
  id: string;
  sale_id: string;
  reason: string;
  status: string;
  requested_at: string;
  reviewed_at: string | null;
  review_note: string | null;
  requested_by: string | null;
  requester: string;
  sale: { created_at: string; litres: number; total_amount: number; payment_method: string; fuel: string; branch: string } | null;
}

export default function SaleReversalsPanel({ onChanged }: { onChanged?: () => void }) {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const confirmDelete = useConfirmDelete();
  const [rows, setRows] = useState<ReversalRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("sale_reversals")
      .select("id, sale_id, reason, status, requested_at, reviewed_at, review_note, requested_by, sales(created_at, litres, total_amount, payment_method, fuel_types(name), branches(name))")
      .order("requested_at", { ascending: false })
      .limit(50);

    const list = ((data as any[]) ?? []).map((r) => ({
      id: r.id,
      sale_id: r.sale_id,
      reason: r.reason,
      status: r.status,
      requested_at: r.requested_at,
      reviewed_at: r.reviewed_at,
      review_note: r.review_note,
      requested_by: r.requested_by,
      requester: "",
      sale: r.sales
        ? {
            created_at: r.sales.created_at,
            litres: Number(r.sales.litres),
            total_amount: Number(r.sales.total_amount),
            payment_method: r.sales.payment_method,
            fuel: r.sales.fuel_types?.name ?? "—",
            branch: r.sales.branches?.name ?? "—",
          }
        : null,
    })) as ReversalRow[];

    const ids = Array.from(new Set(list.map((r) => r.requested_by).filter(Boolean))) as string[];
    if (ids.length) {
      const { data: names } = await supabase.rpc("get_profile_names", { _ids: ids });
      const map = Object.fromEntries(((names as any[]) ?? []).map((n) => [n.user_id, n.full_name]));
      list.forEach((r) => { r.requester = (r.requested_by && map[r.requested_by]) || "Unknown user"; });
    }
    setRows(list);
  }, []);

  useEffect(() => { load(); }, [load]);

  const review = async (id: string, approve: boolean) => {
    if (!isAdmin) return;
    const note = approve ? null : window.prompt("Reason for rejecting (optional)") ?? null;
    setBusyId(id);
    try {
      const { error } = await supabase.rpc("review_sale_reversal", {
        _reversal_id: id,
        _approve: approve,
        _note: note,
      });
      if (error) throw error;
      toast.success(approve ? "Sale reversed and stock restored" : "Reversal request rejected");
      await load();
      onChanged?.();
    } catch (e: any) {
      toast.error(e.message || "Failed to review request");
    } finally {
      setBusyId(null);
    }
  };

  const purge = (id: string, saleId: string) => {
    confirmDelete({
      title: "Permanently delete reversed sale",
      description: "This removes the reversed transaction and its request from the records for good. An audit entry is kept.",
      confirmLabel: "Delete permanently",
      requireAdmin: true,
      action: async () => {
        setBusyId(id);
        try {
          const { error } = await supabase.rpc("delete_reversed_sale", { _sale_id: saleId });
          if (error) throw error;
          toast.success("Reversed transaction permanently deleted");
          await load();
          onChanged?.();
        } catch (e: any) {
          toast.error(e.message || "Failed to delete transaction");
        } finally {
          setBusyId(null);
        }
      },
    });
  };


  const badge = (status: string) =>
    status === "pending" ? "bg-warning/10 text-warning"
      : status === "approved" ? "bg-success/10 text-success"
        : "bg-destructive/10 text-destructive";

  return (
    <Card className="border-l-4 border-l-destructive bg-destructive/5">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Undo2 className="h-4 w-4" /> Sale Reversal Requests
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {isAdmin
            ? "Approve a request to reverse the sale and restore the litres back to the product and its tanks."
            : "Requests you raise stay pending until an admin approves them."}
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4">Requested</th>
                <th className="py-2 pr-4">By</th>
                <th className="py-2 pr-4">Sale</th>
                <th className="py-2 pr-4 text-right">Litres</th>
                <th className="py-2 pr-4 text-right">Amount</th>
                <th className="py-2 pr-4">Reason</th>
                <th className="py-2 pr-4">Status</th>
                {isAdmin && <th className="py-2"></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0 align-top">
                  <td className="py-2.5 pr-4 text-muted-foreground whitespace-nowrap">{format(new Date(r.requested_at), "MMM d, HH:mm")}</td>
                  <td className="py-2.5 pr-4">{r.requester || "—"}</td>
                  <td className="py-2.5 pr-4">
                    <span className="font-medium">{r.sale?.fuel ?? "—"}</span>
                    <span className="block text-xs text-muted-foreground">
                      {r.sale ? `${r.sale.branch} · ${format(new Date(r.sale.created_at), "MMM d, HH:mm")}` : ""}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono">{r.sale ? r.sale.litres.toFixed(2) : "—"}</td>
                  <td className="py-2.5 pr-4 text-right font-mono">{r.sale ? `KES ${r.sale.total_amount.toLocaleString()}` : "—"}</td>
                  <td className="py-2.5 pr-4 max-w-[220px] text-xs">{r.reason}{r.review_note ? <span className="block text-muted-foreground">Note: {r.review_note}</span> : null}</td>
                  <td className="py-2.5 pr-4">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge(r.status)}`}>{r.status.toUpperCase()}</span>
                  </td>
                  {isAdmin && (
                    <td className="py-2.5">
                      {r.status === "pending" ? (
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => review(r.id, true)}>
                            <Check className="h-3.5 w-3.5 mr-1" /> Approve
                          </Button>
                          <Button size="sm" variant="ghost" disabled={busyId === r.id} onClick={() => review(r.id, false)}>
                            <X className="h-3.5 w-3.5 mr-1" /> Reject
                          </Button>
                        </div>
                      ) : r.status === "approved" ? (
                        <Button size="sm" variant="ghost" className="text-destructive" disabled={busyId === r.id}
                          onClick={() => purge(r.id, r.sale_id)}>
                          <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete permanently
                        </Button>
                      ) : null}
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={isAdmin ? 8 : 7} className="py-8 text-center text-muted-foreground">No reversal requests</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
