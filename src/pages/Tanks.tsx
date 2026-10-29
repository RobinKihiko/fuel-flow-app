import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Building2, Droplet, Truck, Ruler, AlertTriangle, Trash2, Pencil } from "lucide-react";
import { format } from "date-fns";
import BranchBadge from "@/components/BranchBadge";
import { PasswordConfirmDialog } from "@/components/PasswordConfirmDialog";

interface Branch { id: string; name: string; }
interface Tank {
  id: string; branch_id: string; fuel_name: string;
  capacity_litres: number; current_level_litres: number; low_stock_threshold: number;
  notes: string | null; updated_at: string;
  product_name?: string;
  branch_fuel_type_id?: string;
}
interface Dip { id: string; tank_id: string; dip_litres: number; notes: string | null; recorded_at: string; }
interface Topup {
  id: string; tank_id: string | null; supplier: string | null;
  expected_litres: number | null; litres: number;
  cost_per_litre: number | null; topup_date: string; notes: string | null; created_at: string;
  created_by: string | null;
}

export default function Tanks() {
  const { hasRole, user } = useAuth();
  const { toast } = useToast();
  const canManage = hasRole("admin") || hasRole("manager");
  const today = format(new Date(), "yyyy-MM-dd");

  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [tanks, setTanks] = useState<Tank[]>([]);
  const [dips, setDips] = useState<Dip[]>([]);
  const [topups, setTopups] = useState<Topup[]>([]);
  const [recorderNames, setRecorderNames] = useState<Record<string, string>>({});

  const [dipOpen, setDipOpen] = useState(false);
  const [dipTank, setDipTank] = useState<Tank | null>(null);
  const [dipForm, setDipForm] = useState({ dip_litres: "", notes: "" });

  const [topupOpen, setTopupOpen] = useState(false);
  const [topupTank, setTopupTank] = useState<Tank | null>(null);
  const [topupForm, setTopupForm] = useState({ supplier: "", expected_litres: "", delivered_litres: "", cost_per_litre: "", topup_date: today, notes: "" });
  const [topupConfirmOpen, setTopupConfirmOpen] = useState(false);

  const [deleteTopup, setDeleteTopup] = useState<Topup | null>(null);

  const [editTopup, setEditTopup] = useState<Topup | null>(null);
  const [editForm, setEditForm] = useState({ supplier: "", expected_litres: "", litres: "", cost_per_litre: "", topup_date: today, notes: "" });
  const [editConfirmOpen, setEditConfirmOpen] = useState(false);


  useEffect(() => {
    supabase.from("branches").select("id, name").eq("is_active", true).then(({ data }) => {
      const list = (data as Branch[]) ?? [];
      setBranches(list);
      if (list.length >= 1 && !selectedBranchId) setSelectedBranchId(list[0].id);
    });
  }, []);

  const refresh = async () => {
    if (!selectedBranchId) return;
    const { data: fuels } = await supabase.from("branch_fuel_types").select("id, name").eq("branch_id", selectedBranchId);
    const fuelIds = (fuels ?? []).map((f: any) => f.id);
    if (fuelIds.length === 0) { setTanks([]); setDips([]); setTopups([]); return; }

    const { data: links } = await supabase.from("branch_fuel_type_tanks").select("branch_fuel_type_id, tank_id").in("branch_fuel_type_id", fuelIds);
    const linkedTankIds = Array.from(new Set((links ?? []).map((l: any) => l.tank_id)));
    if (linkedTankIds.length === 0) { setTanks([]); setDips([]); setTopups([]); return; }

    const productByTank: Record<string, string> = {};
    const branchFuelIdByTank: Record<string, string> = {};
    (links ?? []).forEach((l: any) => {
      const fuel = (fuels ?? []).find((f: any) => f.id === l.branch_fuel_type_id);
      if (fuel) {
        productByTank[l.tank_id] = fuel.name;
        branchFuelIdByTank[l.tank_id] = fuel.id;
      }
    });

    const { data: t } = await supabase.from("tanks").select("*").in("id", linkedTankIds).order("fuel_name");
    const tankList = ((t as Tank[]) ?? []).map((tk) => ({
      ...tk,
      product_name: productByTank[tk.id],
      branch_fuel_type_id: branchFuelIdByTank[tk.id],
    }));
    setTanks(tankList);

    const [{ data: d }, { data: tu }] = await Promise.all([
      supabase.from("tank_dips").select("*").in("tank_id", linkedTankIds).order("recorded_at", { ascending: false }).limit(50),
      supabase.from("fuel_topups").select("*").in("tank_id", linkedTankIds).order("created_at", { ascending: false }).limit(50),
    ]);
    setDips((d as Dip[]) ?? []);
    const list = ((tu as any[]) ?? []) as Topup[];
    setTopups(list);
    const ids = Array.from(new Set(list.map((x) => x.created_by).filter(Boolean))) as string[];
    if (ids.length) {
      const { data: names } = await supabase.rpc("get_profile_names", { _ids: ids });
      setRecorderNames(Object.fromEntries((names ?? []).map((n: any) => [n.user_id, n.full_name])));
    } else {
      setRecorderNames({});
    }
  };

  useEffect(() => { refresh(); }, [selectedBranchId]);

  const openDip = (t: Tank) => { setDipTank(t); setDipForm({ dip_litres: String(t.current_level_litres), notes: "" }); setDipOpen(true); };
  const saveDip = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dipTank) return;
    const { error } = await supabase.from("tank_dips").insert({
      tank_id: dipTank.id, dip_litres: Number(dipForm.dip_litres),
      notes: dipForm.notes.trim() || null, recorded_by: user?.id ?? null,
    });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Dip recorded", description: "Tank level updated." }); setDipOpen(false); refresh(); }
  };

  const openTopup = (t: Tank | null) => {
    setTopupTank(t);
    setTopupForm({ supplier: "", expected_litres: "", delivered_litres: "", cost_per_litre: "", topup_date: today, notes: "" });
    setTopupOpen(true);
  };
  const validateTopup = (): boolean => {
    if (!topupTank) { toast({ title: "Select a tank", variant: "destructive" }); return false; }
    const liters = Number(topupForm.delivered_litres);
    if (!liters || liters <= 0) { toast({ title: "Enter litres", variant: "destructive" }); return false; }
    const cost = Number(topupForm.cost_per_litre);
    if (!cost || cost <= 0) {
      toast({ title: "Buying price required", description: "Enter the cost per litre to capture current stock value.", variant: "destructive" });
      return false;
    }
    const projected = Number(topupTank.current_level_litres) + liters;
    if (projected > Number(topupTank.capacity_litres)) {
      const room = Number(topupTank.capacity_litres) - Number(topupTank.current_level_litres);
      toast({
        title: "Exceeds tank capacity",
        description: `Tank ${topupTank.fuel_name} can only accept ${Math.max(0, room).toLocaleString()} L more.`,
        variant: "destructive",
      });
      return false;
    }
    return true;
  };

  const saveTopup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateTopup()) return;
    setTopupConfirmOpen(true);
  };

  const commitTopup = async () => {
    if (!topupTank) return;
    const liters = Number(topupForm.delivered_litres);
    const cost = Number(topupForm.cost_per_litre);
    // Trigger auto-updates tank level and branch_fuel_types stock/buying_price atomically
    const { error } = await supabase.from("fuel_topups").insert({
      tank_id: topupTank.id,
      branch_id: topupTank.branch_id,
      branch_fuel_type_id: topupTank.branch_fuel_type_id ?? null,
      litres: liters,
      supplier: topupForm.supplier.trim() || null,
      expected_litres: topupForm.expected_litres ? Number(topupForm.expected_litres) : null,
      cost_per_litre: cost,
      topup_date: topupForm.topup_date,
      notes: topupForm.notes.trim() || null,
      created_by: user?.id ?? null,
    } as any);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Top-up recorded", description: `${liters.toLocaleString()} L added to ${topupTank.fuel_name}.` });
    setTopupOpen(false);
    refresh();
  };

  const commitDeleteTopup = async () => {
    if (!deleteTopup) return;
    const { error } = await supabase.from("fuel_topups").delete().eq("id", deleteTopup.id);
    if (error) { toast({ title: "Cannot delete top-up", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Top-up deleted", description: `${Number(deleteTopup.litres).toLocaleString()} L removed from live tank, product stock and the day's stock report. Recorded in audit trail.` });
    setDeleteTopup(null);
    refresh();
  };

  const openEditTopup = (t: Topup) => {
    setEditTopup(t);
    setEditForm({
      supplier: t.supplier ?? "",
      expected_litres: t.expected_litres != null ? String(t.expected_litres) : "",
      litres: String(t.litres),
      cost_per_litre: t.cost_per_litre != null ? String(t.cost_per_litre) : "",
      topup_date: t.topup_date,
      notes: t.notes ?? "",
    });
  };

  const submitEditTopup = (e: React.FormEvent) => {
    e.preventDefault();
    const liters = Number(editForm.litres);
    if (!liters || liters <= 0) { toast({ title: "Enter litres", variant: "destructive" }); return; }
    const cost = Number(editForm.cost_per_litre);
    if (!cost || cost <= 0) { toast({ title: "Buying price required", variant: "destructive" }); return; }
    setEditConfirmOpen(true);
  };

  const commitEditTopup = async () => {
    if (!editTopup) return;
    const { error } = await supabase.from("fuel_topups").update({
      supplier: editForm.supplier.trim() || null,
      expected_litres: editForm.expected_litres ? Number(editForm.expected_litres) : null,
      litres: Number(editForm.litres),
      cost_per_litre: Number(editForm.cost_per_litre),
      topup_date: editForm.topup_date,
      notes: editForm.notes.trim() || null,
    } as any).eq("id", editTopup.id);
    if (error) { toast({ title: "Cannot update top-up", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Top-up updated", description: "Tank, product stock and the day's stock report were recalculated." });
    setEditTopup(null);
    refresh();
  };


  const variance = useMemo(() =>
    topups.map(d => ({ ...d, diff: d.expected_litres != null ? Number(d.litres) - Number(d.expected_litres) : null })),
    [topups]
  );

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold flex items-center gap-2"><Droplet className="h-6 w-6 text-accent" />Tank Inventory</h1>
          <BranchBadge />
        </div>
        <div className="flex items-center gap-2">
          {branches.length > 0 && (
            <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
              <SelectTrigger className="w-[180px]"><Building2 className="h-4 w-4 mr-2" /><SelectValue /></SelectTrigger>
              <SelectContent>{branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
          {canManage && tanks.length > 0 && (
            <Button onClick={() => openTopup(null)} className="bg-accent text-accent-foreground hover:bg-accent/90">
              <Truck className="h-4 w-4 mr-1" />Top up tank
            </Button>
          )}
        </div>
      </div>

      <Card className="bg-gradient-to-r from-accent/5 via-primary/5 to-transparent border-accent/20">
        <CardContent className="py-3 text-xs text-muted-foreground">
          Tanks are configured on the <strong>Fuel Management</strong> page. Use this page to record dip-stick readings and log top-ups (deliveries).
        </CardContent>
      </Card>

      {(() => {
        const lowTanks = tanks.filter(t => t.current_level_litres <= t.low_stock_threshold && t.low_stock_threshold > 0);
        if (lowTanks.length === 0) return null;
        return (
          <Card className="border-destructive/60 bg-destructive/5">
            <CardContent className="py-3 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-destructive">Low Stock Alert — Reorder Required</p>
                <p className="text-sm text-muted-foreground">
                  {lowTanks.map(t => `${t.fuel_name} (${Number(t.current_level_litres).toLocaleString()}L / threshold ${Number(t.low_stock_threshold).toLocaleString()}L)`).join(" · ")}
                </p>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tanks.map(t => {
          const pct = t.capacity_litres > 0 ? Math.min(100, (t.current_level_litres / t.capacity_litres) * 100) : 0;
          const low = t.current_level_litres <= t.low_stock_threshold;
          return (
            <Card key={t.id} className={low ? "border-destructive/50" : ""}>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  {t.fuel_name}
                  {low && <AlertTriangle className="h-4 w-4 text-destructive" />}
                </CardTitle>
                {t.product_name && <p className="text-xs text-muted-foreground">Product: {t.product_name}</p>}
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-mono font-semibold">{Number(t.current_level_litres).toLocaleString()} L</span>
                    <span className="text-muted-foreground text-xs">of {Number(t.capacity_litres).toLocaleString()} L</span>
                  </div>
                  <div className="h-3 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full transition-all ${low ? "bg-destructive" : pct < 50 ? "bg-amber-500" : "bg-success"}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Low alert: {Number(t.low_stock_threshold).toLocaleString()} L</p>
                </div>
                {canManage && (
                  <Button variant="outline" size="sm" className="w-full" onClick={() => openDip(t)}>
                    <Ruler className="h-3 w-3 mr-1" />Record Dip
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
        {tanks.length === 0 && selectedBranchId && (
          <Card className="md:col-span-2 lg:col-span-3"><CardContent className="py-12 text-center text-muted-foreground">
            No tanks linked to fuel products yet. Add a fuel product (with tanks) on the Fuel Management page.
          </CardContent></Card>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Truck className="h-4 w-4" />Recent Top-ups</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-2">Date</th>
                  <th className="py-2 pr-2">Recorded at</th>
                  <th className="py-2 pr-2">Tank</th>
                  <th className="py-2 pr-2">Supplier</th>
                  <th className="py-2 pr-2">Litres</th>
                  <th className="py-2 pr-2">Var.</th>
                  <th className="py-2 pr-2">Received by</th>
                  {hasRole("admin") && <th className="py-2"></th>}
                </tr></thead>
                <tbody>
                  {variance.map(d => (
                    <tr key={d.id} className="border-b last:border-0">
                      <td className="py-2 pr-2 text-muted-foreground">{format(new Date(d.topup_date), "MMM d")}</td>
                      <td className="py-2 pr-2 text-muted-foreground text-xs">{format(new Date(d.created_at), "MMM d, HH:mm")}</td>
                      <td className="py-2 pr-2">{tanks.find(t => t.id === d.tank_id)?.fuel_name ?? "—"}</td>
                      <td className="py-2 pr-2">{d.supplier ?? "—"}</td>
                      <td className="py-2 pr-2 font-mono">{Number(d.litres).toLocaleString()}</td>
                      <td className="py-2 pr-2 font-mono">
                        {d.diff == null ? "—" : <span className={d.diff < 0 ? "text-destructive" : d.diff > 0 ? "text-success" : ""}>{d.diff > 0 ? "+" : ""}{d.diff.toFixed(0)}</span>}
                      </td>
                      <td className="py-2 pr-2 text-xs">{d.created_by ? (recorderNames[d.created_by] ?? "—") : "—"}</td>
                      {hasRole("admin") && (
                        <td className="py-2">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditTopup(d)} title="Edit (admin)"><Pencil className="h-3 w-3" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDeleteTopup(d)} title="Delete (admin)"><Trash2 className="h-3 w-3 text-destructive" /></Button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {variance.length === 0 && <tr><td colSpan={hasRole("admin") ? 8 : 7} className="py-6 text-center text-muted-foreground">No top-ups yet</td></tr>}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Ruler className="h-4 w-4" />Recent Dip Readings</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-2">Time</th><th className="py-2 pr-2">Tank</th><th className="py-2 pr-2">Litres</th><th className="py-2">Notes</th>
                </tr></thead>
                <tbody>
                  {dips.map(d => (
                    <tr key={d.id} className="border-b last:border-0">
                      <td className="py-2 pr-2 text-muted-foreground">{format(new Date(d.recorded_at), "MMM d, HH:mm")}</td>
                      <td className="py-2 pr-2">{tanks.find(t => t.id === d.tank_id)?.fuel_name ?? "—"}</td>
                      <td className="py-2 pr-2 font-mono">{Number(d.dip_litres).toLocaleString()}</td>
                      <td className="py-2 text-muted-foreground truncate max-w-[160px]">{d.notes ?? ""}</td>
                    </tr>
                  ))}
                  {dips.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">No dips recorded</td></tr>}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={dipOpen} onOpenChange={setDipOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Dip Reading — {dipTank?.fuel_name}</DialogTitle></DialogHeader>
          <form onSubmit={saveDip} className="space-y-3">
            <div><Label>Measured litres *</Label><Input type="number" step="0.01" value={dipForm.dip_litres} onChange={e => setDipForm({ ...dipForm, dip_litres: e.target.value })} required /></div>
            <div><Label>Notes</Label><Textarea value={dipForm.notes} onChange={e => setDipForm({ ...dipForm, notes: e.target.value })} placeholder="Variance reason, time of day, etc." /></div>
            <Button type="submit" className="w-full">Record Dip</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={topupOpen} onOpenChange={setTopupOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Truck className="h-4 w-4 text-accent" />Top up tank {topupTank ? `— ${topupTank.fuel_name}` : ""}</DialogTitle>
          </DialogHeader>
          <form onSubmit={saveTopup} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Branch *</Label>
                <Select value={selectedBranchId} onValueChange={(v) => { setSelectedBranchId(v); setTopupTank(null); }}>
                  <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                  <SelectContent>{branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Tank *</Label>
                <Select value={topupTank?.id ?? ""} onValueChange={(v) => setTopupTank(tanks.find(t => t.id === v) ?? null)}>
                  <SelectTrigger><SelectValue placeholder={tanks.length === 0 ? "No tanks" : "Select tank"} /></SelectTrigger>
                  <SelectContent>
                    {tanks.map(t => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.fuel_name} — {Number(t.current_level_litres).toLocaleString()}/{Number(t.capacity_litres).toLocaleString()} L
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {topupTank && (
              <div className="text-xs p-2 rounded bg-muted/50 flex justify-between">
                <span>Available capacity:</span>
                <span className="font-mono font-semibold">
                  {Math.max(0, Number(topupTank.capacity_litres) - Number(topupTank.current_level_litres)).toLocaleString()} L
                </span>
              </div>
            )}
            <div><Label>Supplier</Label><Input value={topupForm.supplier} onChange={e => setTopupForm({ ...topupForm, supplier: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Date *</Label><Input type="date" value={topupForm.topup_date} onChange={e => setTopupForm({ ...topupForm, topup_date: e.target.value })} required /></div>
              <div><Label>Buying Price / Litre (KES) *</Label><Input type="number" step="0.01" min="0.01" value={topupForm.cost_per_litre} onChange={e => setTopupForm({ ...topupForm, cost_per_litre: e.target.value })} required /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Expected (L)</Label><Input type="number" step="0.01" value={topupForm.expected_litres} onChange={e => setTopupForm({ ...topupForm, expected_litres: e.target.value })} /></div>
              <div><Label>Delivered (L) *</Label><Input type="number" step="0.01" value={topupForm.delivered_litres} onChange={e => setTopupForm({ ...topupForm, delivered_litres: e.target.value })} required /></div>
            </div>
            <div><Label>Notes</Label><Textarea value={topupForm.notes} onChange={e => setTopupForm({ ...topupForm, notes: e.target.value })} /></div>
            <Button type="submit" className="w-full bg-accent text-accent-foreground hover:bg-accent/90">Record Top-up</Button>
          </form>
        </DialogContent>
      </Dialog>

      <PasswordConfirmDialog
        open={topupConfirmOpen}
        onOpenChange={setTopupConfirmOpen}
        title="Confirm top-up entry"
        description="Re-enter your password to record this top-up. This prevents accidental double entries."
        confirmLabel="Record Top-up"
        onConfirmed={commitTopup}
      />

      <Dialog open={!!editTopup} onOpenChange={(o) => !o && setEditTopup(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Pencil className="h-4 w-4 text-accent" />Edit top-up (admin)</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitEditTopup} className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Changing litres adjusts the tank, product stock and that day's stock report automatically. Stock can never go below zero or above tank capacity.
            </p>
            <div><Label>Supplier</Label><Input value={editForm.supplier} onChange={e => setEditForm({ ...editForm, supplier: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Date *</Label><Input type="date" value={editForm.topup_date} onChange={e => setEditForm({ ...editForm, topup_date: e.target.value })} required /></div>
              <div><Label>Buying Price / Litre (KES) *</Label><Input type="number" step="0.01" min="0.01" value={editForm.cost_per_litre} onChange={e => setEditForm({ ...editForm, cost_per_litre: e.target.value })} required /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Expected (L)</Label><Input type="number" step="0.01" value={editForm.expected_litres} onChange={e => setEditForm({ ...editForm, expected_litres: e.target.value })} /></div>
              <div><Label>Delivered (L) *</Label><Input type="number" step="0.01" value={editForm.litres} onChange={e => setEditForm({ ...editForm, litres: e.target.value })} required /></div>
            </div>
            <div><Label>Notes</Label><Textarea value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} /></div>
            <Button type="submit" className="w-full">Save changes</Button>
          </form>
        </DialogContent>
      </Dialog>

      <PasswordConfirmDialog
        open={editConfirmOpen}
        onOpenChange={setEditConfirmOpen}
        title="Confirm top-up edit"
        description="Admin password required. Tank levels, product stock and the day's stock report will be recalculated."
        requireAdmin
        confirmLabel="Save changes"
        onConfirmed={commitEditTopup}
      />

      <PasswordConfirmDialog
        open={!!deleteTopup}
        onOpenChange={(o) => !o && setDeleteTopup(null)}
        title="Delete top-up (admin)"
        description="Admin password required. The litres are removed from the tank, the product stock and that day's stock report, and the change is kept in the audit trail."
        requireAdmin
        destructive
        confirmLabel="Delete top-up"
        onConfirmed={commitDeleteTopup}
      />
    </div>

  );
}
