import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Fuel, Edit2, Building2, Trash2, Droplet } from "lucide-react";
import BranchBadge from "@/components/BranchBadge";
import AuditTrailPanel from "@/components/AuditTrailPanel";

interface Branch { id: string; name: string; }
interface FuelType { id: string; name: string; price_per_litre: number; stock_level: number; vat_rate?: number; buying_price?: number | null; }
interface TankRow { id?: string; fuel_name: string; capacity_litres: string; current_level_litres: string; low_stock_threshold: string; }
interface LinkedTank { id: string; fuel_name: string; capacity_litres: number; current_level_litres: number; low_stock_threshold: number; }

export default function FuelManagement() {
  const { user, hasRole } = useAuth();
  const { toast } = useToast();
  const isAdmin = hasRole("admin");
  const canEdit = isAdmin; // Only admins can edit fuel management
  const isAttendantOnly = !isAdmin && !hasRole("manager");


  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const [fuelTypes, setFuelTypes] = useState<FuelType[]>([]);
  const [linkedTanks, setLinkedTanks] = useState<Record<string, LinkedTank[]>>({});

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [buyingPrice, setBuyingPrice] = useState("");
  const [vatRate, setVatRate] = useState("16");
  const [tanks, setTanks] = useState<TankRow[]>([{ fuel_name: "", capacity_litres: "", current_level_litres: "", low_stock_threshold: "" }]);

  useEffect(() => {
    supabase.from("branches").select("id, name").eq("is_active", true).then(({ data }) => {
      const list = (data as Branch[]) ?? [];
      setBranches(list);
      if (list.length === 1) setSelectedBranchId(list[0].id);
    });
  }, []);

  const fetchFuels = async () => {
    if (!selectedBranchId) { setFuelTypes([]); setLinkedTanks({}); return; }
    const { data } = await supabase.from("branch_fuel_types").select("*").eq("branch_id", selectedBranchId).order("name");
    const fuels = (data as FuelType[]) ?? [];
    setFuelTypes(fuels);

    if (fuels.length) {
      const { data: links } = await supabase
        .from("branch_fuel_type_tanks")
        .select("branch_fuel_type_id, tank_id, tanks(id, fuel_name, capacity_litres, current_level_litres, low_stock_threshold)")
        .in("branch_fuel_type_id", fuels.map((f) => f.id));
      const grouped: Record<string, LinkedTank[]> = {};
      (links ?? []).forEach((l: any) => {
        if (!l.tanks) return;
        (grouped[l.branch_fuel_type_id] ||= []).push(l.tanks);
      });
      setLinkedTanks(grouped);
    } else {
      setLinkedTanks({});
    }
  };

  useEffect(() => { fetchFuels(); }, [selectedBranchId]);

  const openNew = () => {
    setEditingId(null);
    setName(""); setPrice(""); setBuyingPrice(""); setVatRate("16");
    setTanks([{ fuel_name: "", capacity_litres: "", current_level_litres: "", low_stock_threshold: "" }]);
    setDialogOpen(true);
  };

  const openEdit = async (f: FuelType) => {
    setEditingId(f.id);
    setName(f.name);
    setPrice(String(f.price_per_litre));
    setBuyingPrice(f.buying_price != null ? String(f.buying_price) : "");
    setVatRate(String(f.vat_rate ?? 16));
    const existing = linkedTanks[f.id] ?? [];
    setTanks(existing.length
      ? existing.map((t) => ({
          id: t.id,
          fuel_name: t.fuel_name,
          capacity_litres: String(t.capacity_litres),
          current_level_litres: String(t.current_level_litres),
          low_stock_threshold: String(t.low_stock_threshold),
        }))
      : [{ fuel_name: f.name, capacity_litres: "", current_level_litres: "", low_stock_threshold: "" }]);
    setDialogOpen(true);
  };

  const addTankRow = () =>
    setTanks((t) => [...t, { fuel_name: name || "", capacity_litres: "", current_level_litres: "", low_stock_threshold: "" }]);
  const removeTankRow = (i: number) => setTanks((t) => t.filter((_, idx) => idx !== i));
  const updateTankRow = (i: number, patch: Partial<TankRow>) =>
    setTanks((t) => t.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const totalStock = tanks.reduce((sum, t) => sum + Number(t.current_level_litres || 0), 0);
  const totalCapacity = tanks.reduce((sum, t) => sum + Number(t.capacity_litres || 0), 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBranchId) return;
    if (tanks.length === 0 || tanks.some((t) => !t.capacity_litres)) {
      toast({ title: "Add at least one tank with capacity", variant: "destructive" });
      return;
    }
    try {
      let fuelId = editingId;
      const fuelPayload = { name, price_per_litre: Number(price), stock_level: totalStock, vat_rate: Number(vatRate || 0), buying_price: buyingPrice ? Number(buyingPrice) : null, branch_id: selectedBranchId };

      if (editingId) {
        const { error } = await supabase.from("branch_fuel_types").update(fuelPayload).eq("id", editingId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("branch_fuel_types").insert(fuelPayload).select().single();
        if (error) throw error;
        fuelId = data.id;
      }
      if (!fuelId) throw new Error("Missing fuel id");

      // Upsert tanks. For existing rows update; for new rows insert + link.
      const keepIds: string[] = [];
      for (const t of tanks) {
        const tankPayload = {
          branch_id: selectedBranchId,
          fuel_name: (t.fuel_name || name).trim(),
          capacity_litres: Number(t.capacity_litres || 0),
          current_level_litres: Number(t.current_level_litres || 0),
          low_stock_threshold: Number(t.low_stock_threshold || 0),
        };
        if (t.id) {
          await supabase.from("tanks").update(tankPayload).eq("id", t.id);
          keepIds.push(t.id);
        } else {
          const { data: newTank, error: tErr } = await supabase.from("tanks").insert(tankPayload).select().single();
          if (tErr) throw tErr;
          await supabase.from("branch_fuel_type_tanks").insert({ branch_fuel_type_id: fuelId, tank_id: newTank.id });
          keepIds.push(newTank.id);
        }
      }
      // Remove links/tanks dropped from form (edit mode)
      if (editingId) {
        const existing = linkedTanks[editingId] ?? [];
        const toRemove = existing.filter((e) => !keepIds.includes(e.id));
        for (const r of toRemove) {
          await supabase.from("branch_fuel_type_tanks").delete().eq("branch_fuel_type_id", editingId).eq("tank_id", r.id);
          await supabase.from("tanks").delete().eq("id", r.id);
        }
      }

      toast({ title: editingId ? "Fuel product updated" : "Fuel product added", description: `${tanks.length} tank(s) configured` });
      setDialogOpen(false);
      fetchFuels();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const fuelColors = ["bg-fuel-petrol", "bg-fuel-diesel", "bg-fuel-kerosene"];

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold">Fuel Management</h1>
            <BranchBadge />
          </div>
          <p className="text-muted-foreground text-sm">{canEdit ? "Configure fuel products and their tanks" : "View fuel products & stock"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {branches.length > 0 && (
            <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
              <SelectTrigger className="w-[180px]">
                <Building2 className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Select branch" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {canEdit && (
            <Button onClick={openNew} className="bg-accent text-accent-foreground hover:bg-accent/90" disabled={!selectedBranchId}>
              <Plus className="h-4 w-4 mr-2" /> Add Fuel Product
            </Button>
          )}
        </div>
      </div>

      {!selectedBranchId && (
        <Card className="flex items-center justify-center py-12">
          <div className="text-center text-muted-foreground">
            <Building2 className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p>Select a branch to manage its fuel products</p>
          </div>
        </Card>
      )}

      {selectedBranchId && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {fuelTypes.map((fuel, i) => {
            const fTanks = linkedTanks[fuel.id] ?? [];
            const capacity = fTanks.reduce((s, t) => s + Number(t.capacity_litres), 0);
            const level = fTanks.reduce((s, t) => s + Number(t.current_level_litres), 0);
            const pct = capacity > 0 ? Math.min(100, (level / capacity) * 100) : 0;
            return (
              <Card key={fuel.id} className="relative overflow-hidden">
                <div className={`absolute top-0 left-0 w-1 h-full ${fuelColors[i % fuelColors.length]}`} />
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Fuel className="h-4 w-4" /> {fuel.name}
                  </CardTitle>
                  {canEdit && (
                    <Button variant="ghost" size="icon" onClick={() => openEdit(fuel)} title="Edit">
                      <Edit2 className="h-4 w-4" />
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Selling / Litre</span>
                    <span className="font-mono font-semibold">KES {fuel.price_per_litre}</span>
                  </div>
                  {!isAttendantOnly && (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Buying / Litre</span>
                        <span className="font-mono">{fuel.buying_price != null ? `KES ${fuel.buying_price}` : "—"}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Margin / Litre</span>
                        <span className="font-mono text-success">
                          {fuel.buying_price != null ? `KES ${(Number(fuel.price_per_litre) - Number(fuel.buying_price)).toFixed(2)}` : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">VAT</span>
                        <span className="font-mono">{Number(fuel.vat_rate ?? 16)}%</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Stock</span>
                    <span className="font-mono font-semibold">{level.toLocaleString()}L / {capacity.toLocaleString()}L</span>
                  </div>
                  {!isAttendantOnly && fuel.buying_price != null && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Stock Value</span>
                      <span className="font-mono font-semibold text-accent">KES {(level * Number(fuel.buying_price)).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    </div>
                  )}

                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full ${fuelColors[i % fuelColors.length]} transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="pt-2 border-t border-border/50 space-y-1">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                      <Droplet className="h-3 w-3" /> {fTanks.length} tank(s)
                    </p>
                    {fTanks.map((t) => (
                      <div key={t.id} className="flex justify-between text-xs">
                        <span>{t.fuel_name}</span>
                        <span className="font-mono">{Number(t.current_level_litres).toLocaleString()}L / {Number(t.capacity_litres).toLocaleString()}L</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {fuelTypes.length === 0 && (
            <Card className="col-span-full flex items-center justify-center py-12">
              <div className="text-center text-muted-foreground">
                <Fuel className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <p>No fuel products configured yet</p>
                {canEdit && <Button variant="link" className="text-accent" onClick={openNew}>Add your first fuel product</Button>}
              </div>
            </Card>
          )}
        </div>
      )}
      {selectedBranchId && isAdmin && (
        <AuditTrailPanel
          tables={["branch_fuel_types", "tanks"]}
          branchId={selectedBranchId}
          fieldsOnly={["buying_price", "capacity_litres"]}
          title="Recent changes (buying price & capacity)"
        />
      )}



      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Fuel Product" : "Add Fuel Product"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2 col-span-2">
                <Label>Product name *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Super Petrol" required />
              </div>
              <div className="space-y-2">
                <Label>Selling Price / Litre (KES) *</Label>
                <Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Buying Price / Litre (KES)</Label>
                <Input type="number" step="0.01" value={buyingPrice} onChange={(e) => setBuyingPrice(e.target.value)} placeholder="Cost basis for stock value" />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>VAT Rate (%) *</Label>
                <Input type="number" step="0.01" min="0" value={vatRate} onChange={(e) => setVatRate(e.target.value)} required />
              </div>
            </div>

            <div className="space-y-3 border-t pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Tanks for this product</Label>
                  <p className="text-xs text-muted-foreground">Total stock = sum of all tank levels</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addTankRow}>
                  <Plus className="h-3 w-3 mr-1" /> Add Tank
                </Button>
              </div>
              <div className="space-y-3">
                {tanks.map((t, i) => (
                  <div key={i} className="p-3 border rounded-lg space-y-2 bg-muted/30">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tank #{i + 1}</span>
                      {tanks.length > 1 && (
                        <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeTankRow(i)}>
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1 col-span-2">
                        <Label className="text-xs">Tank label</Label>
                        <Input value={t.fuel_name} onChange={(e) => updateTankRow(i, { fuel_name: e.target.value })} placeholder={name || "Tank label"} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Capacity (L) *</Label>
                        <Input type="number" step="0.01" value={t.capacity_litres} onChange={(e) => updateTankRow(i, { capacity_litres: e.target.value })} required />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Current level (L)</Label>
                        <Input type="number" step="0.01" value={t.current_level_litres} onChange={(e) => updateTankRow(i, { current_level_litres: e.target.value })} />
                      </div>
                      <div className="space-y-1 col-span-2">
                        <Label className="text-xs">Low stock alert (L)</Label>
                        <Input type="number" step="0.01" value={t.low_stock_threshold} onChange={(e) => updateTankRow(i, { low_stock_threshold: e.target.value })} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-3 rounded border border-accent/40 bg-accent/5 text-sm flex flex-col gap-1">
                <div className="flex justify-between">
                  <span>Total capacity</span>
                  <span className="font-mono font-semibold">{totalCapacity.toLocaleString()} L</span>
                </div>
                <div className="flex justify-between">
                  <span>Total stock available</span>
                  <span className="font-mono font-bold text-accent">{totalStock.toLocaleString()} L</span>
                </div>
              </div>
            </div>

            <Button type="submit" className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
              {editingId ? "Save Changes" : "Create Fuel Product"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
