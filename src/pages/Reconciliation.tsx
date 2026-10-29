import { useEffect, useMemo, useState } from "react";
import { format, startOfDay, endOfDay, subDays } from "date-fns";
import { DateRange } from "react-day-picker";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/DateRangePicker";
import { PasswordConfirmDialog } from "@/components/PasswordConfirmDialog";
import { useAuth } from "@/hooks/useAuth";
import { useModifierNames } from "@/hooks/useModifierNames";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";

interface Sale { id: string; total_amount: number; payment_method: string; created_at: string; branch_id: string | null; }
interface Tx { id: string; sale_id: string | null; amount: number; status: string; phone: string; mpesa_code: string | null; created_at: string; }
interface Review { id: string; sale_id: string | null; tx_id: string | null; status: string; verified_at: string | null; verified_by: string | null; note: string | null; }

interface Row {
  kind: "matched" | "amount_mismatch" | "missing_tx" | "unmatched_tx" | "pending";
  sale?: Sale;
  tx?: Tx;
  note: string;
}

export default function Reconciliation() {
  const today = new Date();
  const { user } = useAuth();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({ from: subDays(today, 6), to: today });
  const [rows, setRows] = useState<Row[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [cashTotal, setCashTotal] = useState(0);
  const [mpesaTotal, setMpesaTotal] = useState(0);
  const [txTotal, setTxTotal] = useState(0);
  const [pendingRows, setPendingRows] = useState<Row[]>([]);
  const [pwOpen, setPwOpen] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const rowKey = (r: Row, i: number) => `${r.sale?.id ?? ""}|${r.tx?.id ?? ""}|${i}`;

  const load = async () => {
    const from = dateRange?.from ?? today;
    const to = dateRange?.to ?? from;
    const fromIso = startOfDay(from).toISOString();
    const toIso = endOfDay(to).toISOString();

    const [{ data: sales }, { data: txs }, { data: revs }] = await Promise.all([
      supabase.from("sales").select("id,total_amount,payment_method,created_at,branch_id").gte("created_at", fromIso).lte("created_at", toIso).is("reversed_at", null),
      supabase.from("mpesa_transactions").select("*").gte("created_at", fromIso).lte("created_at", toIso),
      supabase.from("reconciliation_reviews").select("*"),
    ]);

    const s = (sales as Sale[]) ?? [];
    const t = (txs as Tx[]) ?? [];
    setReviews((revs as Review[]) ?? []);

    setCashTotal(s.filter((x) => x.payment_method === "cash").reduce((a, b) => a + Number(b.total_amount), 0));
    setMpesaTotal(s.filter((x) => x.payment_method === "mpesa").reduce((a, b) => a + Number(b.total_amount), 0));
    setTxTotal(t.filter((x) => x.status === "completed").reduce((a, b) => a + Number(b.amount), 0));

    const txBySale = new Map<string, Tx>();
    t.forEach((x) => { if (x.sale_id) txBySale.set(x.sale_id, x); });

    const out: Row[] = [];
    for (const sale of s.filter((x) => x.payment_method === "mpesa")) {
      const tx = txBySale.get(sale.id);
      if (!tx) out.push({ kind: "missing_tx", sale, note: "M-Pesa sale has no transaction record" });
      else if (tx.status !== "completed") out.push({ kind: "pending", sale, tx, note: `Transaction status: ${tx.status}` });
      else if (Math.abs(Number(tx.amount) - Number(sale.total_amount)) > 0.5)
        out.push({ kind: "amount_mismatch", sale, tx, note: `Sale KES ${sale.total_amount} ≠ Tx KES ${tx.amount}` });
      else out.push({ kind: "matched", sale, tx, note: "OK" });
    }
    for (const tx of t) {
      if (!tx.sale_id || !s.find((x) => x.id === tx.sale_id)) {
        out.push({ kind: "unmatched_tx", tx, note: "Transaction has no matching sale" });
      }
    }
    // Also expose cash sales as reconcilable rows
    for (const sale of s.filter((x) => x.payment_method === "cash")) {
      out.push({ kind: "matched", sale, note: "Cash sale" });
    }
    setRows(out);
  };

  useEffect(() => { load(); }, [dateRange]);

  const flagged = useMemo(() => rows.filter((r) => r.kind !== "matched"), [rows]);

  const verifierNames = useModifierNames(reviews.map((r) => r.verified_by));

  const reviewFor = (r: Row): Review | undefined => {
    const sid = r.sale?.id;
    const tid = r.tx?.id;
    return reviews.find((x) => (sid && x.sale_id === sid) || (tid && x.tx_id === tid));
  };

  const verifyRows = async (toVerify: Row[]) => {
    for (const r of toVerify) {
      const existing = reviewFor(r);
      const payload = {
        sale_id: r.sale?.id ?? null,
        tx_id: r.tx?.id ?? null,
        status: "verified",
        verified_at: new Date().toISOString(),
        verified_by: user?.id ?? null,
        reviewed_by: user?.id ?? null,
        note: `Verified ${r.kind}`,
      };
      const { error } = existing
        ? await supabase.from("reconciliation_reviews").update(payload).eq("id", existing.id)
        : await supabase.from("reconciliation_reviews").insert(payload);
      if (error) { toast.error(error.message); return; }
    }
    toast.success(`Marked ${toVerify.length} entr${toVerify.length === 1 ? "y" : "ies"} verified`);
    setSelectedKeys(new Set());
    load();
  };

  const badge = (r: Row) => {
    const rev = reviewFor(r);
    if (rev?.status === "verified") {
      return <span className="px-2 py-0.5 rounded text-xs font-medium bg-success/15 text-success inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> VERIFIED</span>;
    }
    const map: Record<string, string> = {
      matched: "bg-success/10 text-success",
      amount_mismatch: "bg-destructive/10 text-destructive",
      missing_tx: "bg-destructive/10 text-destructive",
      unmatched_tx: "bg-amber-500/10 text-amber-600",
      pending: "bg-muted text-muted-foreground",
    };
    const labels: Record<string, string> = {
      matched: "MATCHED", amount_mismatch: "AMOUNT MISMATCH",
      missing_tx: "NO TX", unmatched_tx: "ORPHAN TX", pending: "PENDING",
    };
    return <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[r.kind]}`}>{labels[r.kind]}</span>;
  };

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Cash vs M-Pesa Reconciliation</h1>
          <p className="text-sm text-muted-foreground">Match transactions against sales, flag mismatches, and verify each line manually.</p>
        </div>
        <DateRangePicker value={dateRange} onChange={setDateRange} className="w-[240px]" />
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Cash Sales</CardTitle></CardHeader>
          <CardContent><p className="font-mono text-2xl font-bold">KES {cashTotal.toLocaleString()}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">M-Pesa Sales</CardTitle></CardHeader>
          <CardContent><p className="font-mono text-2xl font-bold">KES {mpesaTotal.toLocaleString()}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">M-Pesa Tx (Completed)</CardTitle></CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-bold">KES {txTotal.toLocaleString()}</p>
            <p className={`text-xs mt-1 ${Math.abs(txTotal - mpesaTotal) < 1 ? "text-success" : "text-destructive"}`}>
              {Math.abs(txTotal - mpesaTotal) < 1 ? "Balanced" : `Variance: KES ${(txTotal - mpesaTotal).toLocaleString()}`}
            </p>
          </CardContent></Card>
      </div>

      {flagged.length > 0 && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader className="pb-2 flex flex-row items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <CardTitle className="text-base">{flagged.length} issue{flagged.length === 1 ? "" : "s"} flagged</CardTitle>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base">Reconciliation Detail</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{selectedKeys.size} selected</span>
            <Button
              size="sm"
              disabled={selectedKeys.size === 0}
              onClick={() => {
                const toVerify = rows.filter((r, i) => selectedKeys.has(rowKey(r, i)) && reviewFor(r)?.status !== "verified");
                if (toVerify.length === 0) return;
                setPendingRows(toVerify);
                setPwOpen(true);
              }}
              className="bg-accent text-accent-foreground hover:bg-accent/90"
            >
              Verify Selected
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-2 w-8">
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && rows.every((r, i) => reviewFor(r)?.status === "verified" || selectedKeys.has(rowKey(r, i)))}
                      onChange={(e) => {
                        if (e.target.checked) {
                          const all = new Set<string>();
                          rows.forEach((r, i) => { if (reviewFor(r)?.status !== "verified") all.add(rowKey(r, i)); });
                          setSelectedKeys(all);
                        } else setSelectedKeys(new Set());
                      }}
                    />
                  </th>
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Sale KES</th>
                  <th className="py-2 pr-4">Tx KES</th>
                  <th className="py-2 pr-4">Phone / Code</th>
                  <th className="py-2 pr-4">Note</th>
                  <th className="py-2 pr-4">Verified</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const rev = reviewFor(r);
                  const key = rowKey(r, i);
                  const isVerified = rev?.status === "verified";
                  return (
                    <tr key={key} className="border-b border-border last:border-0">
                      <td className="py-2.5 pr-2">
                        <input
                          type="checkbox"
                          disabled={isVerified}
                          checked={selectedKeys.has(key)}
                          onChange={(e) => {
                            const next = new Set(selectedKeys);
                            if (e.target.checked) next.add(key); else next.delete(key);
                            setSelectedKeys(next);
                          }}
                        />
                      </td>
                      <td className="py-2.5 pr-4 text-muted-foreground">
                        {format(new Date(r.sale?.created_at ?? r.tx?.created_at ?? Date.now()), "MMM d, HH:mm")}
                      </td>
                      <td className="py-2.5 pr-4">{badge(r)}</td>
                      <td className="py-2.5 pr-4 font-mono">{r.sale ? Number(r.sale.total_amount).toLocaleString() : "—"}</td>
                      <td className="py-2.5 pr-4 font-mono">{r.tx ? Number(r.tx.amount).toLocaleString() : "—"}</td>
                      <td className="py-2.5 pr-4 font-mono text-xs">{r.tx?.mpesa_code || r.tx?.phone || "—"}</td>
                      <td className="py-2.5 pr-4 text-xs">{r.note}</td>
                      <td className="py-2.5 pr-4 text-xs">
                        {rev?.verified_at ? (
                          <div>
                            <div>{format(new Date(rev.verified_at), "MMM d, HH:mm")}</div>
                            <span className="text-muted-foreground">by {verifierNames[rev.verified_by ?? ""] || "—"}</span>
                          </div>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-2.5">
                        {!isVerified && (
                          <Button size="sm" variant="outline" onClick={() => { setPendingRows([r]); setPwOpen(true); }}>
                            Verify
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && (
              <p className="text-center text-muted-foreground py-8 flex items-center justify-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" /> No activity in this range
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <PasswordConfirmDialog
        open={pwOpen}
        onOpenChange={(v) => { setPwOpen(v); if (!v) setPendingRows([]); }}
        title={pendingRows.length > 1 ? `Verify ${pendingRows.length} entries` : "Verify reconciliation entry"}
        description="Re-enter your password to mark these as reconciled. We'll record your name and timestamp."
        confirmLabel="Mark verified"
        onConfirmed={async () => { if (pendingRows.length) await verifyRows(pendingRows); }}
      />

    </div>
  );
}
