import { useState, useEffect } from "react";
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
import { useConfirmDelete } from "@/hooks/useConfirmDelete";
import { Plus, Edit2, Building2, AlertTriangle, Trash2, Gauge } from "lucide-react";
import { format } from "date-fns";
import BranchBadge from "@/components/BranchBadge";

interface Branch { id: string; name: string; }
interface BranchFuel { id: string; name: string; price_per_litre: number; }
interface Pump {
  id: string; branch_id: string; code: string; label: string | null;
  status: "active" | "idle" | "error" | "offline";
  assigned_attendant_id: string | null; notes: string | null;
}
interface Nozzle { id: string; pump_id: string; branch_fuel_type_id: string; code: string; }
interface AttendantOpt { user_id: string; full_name: string | null; }
interface DriveOff {
  id: string; pump_id: string | null; vehicle_plate: string | null;
  estimated_litres: number | null; estimated_amount: number | null;
  notes: string | null; reported_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-success/15 text-success border-success/30",
  idle: "bg-muted text-muted-foreground border-border",
  error: "bg-destructive/15 text-destructive border-destructive/30",
  offline: "bg-secondary text-secondary-foreground border-border",
};

export default function Pumps() {
  const { hasRole, user } = useAuth();
  const { toast } = useToast();
  const confirmDelete = useConfirmDelete();
  const canManage = hasRole("admin") || hasRole("manager");

  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [pumps, setPumps] = useState<Pump[]>([]);
  const [nozzles, setNozzles] = useState<Nozzle[]>([]);
  const [fuels, setFuels] = useState<BranchFuel[]>([]);
  const [attendants, setAttendants] = useState<AttendantOpt[]>([]);
  const [driveOffs, setDriveOffs] = useState<DriveOff[]>([]);

  // Pump dialog
  const [pumpOpen, setPumpOpen] = useState(false);
  const [editingPump, setEditingPump] = useState<Pump | null>(null);
  const [pumpForm, setPumpForm] = useState({ code: "", label: "", notes: "" });

  // Nozzle dialog
  const [nozzleOpen, setNozzleOpen] = useState(false);
  const [nozzlePump, setNozzlePump] = useState<Pump | null>(null);
  const [nozzleForm, setNozzleForm] = useState({ code: "", branch_fuel_type_id: "" });

  // Drive-off dialog
  const [driveOffOpen, setDriveOffOpen] = useState(false);
  const [driveOffForm, setDriveOffForm] = useState({
    pump_id: "", vehicle_plate: "", estimated_litres: "", estimated_amount: "", notes: "",
  });

  useEffect(() => {
    supabase.from("branches").select("id, name").eq("is_active", true).then(({ data }) => {
      const list = (data as Branch[]) ?? [];
      setBranches(list);
      if (list.length >= 1 && !selectedBranchId) setSelectedBranchId(list[0].id);
    });
  }, []);

  const refresh = async () => {
    if (!selectedBranchId) return;
    const [{ data: p }, { data: f }] = await Promise.all([
      supabase.from("pumps").select("*").eq("branch_id", selectedBranchId).order("code"),
      supabase.from("branch_fuel_types").select("id,name,price_per_litre").eq("branch_id", selectedBranchId).order("name"),
    ]);
    const pumpList = (p as Pump[]) ?? [];
    setPumps(pumpList);
    setFuels((f as BranchFuel[]) ?? []);

    if (pumpList.length) {
      const { data: n } = await supabase.from("pump_nozzles").select("*").in("pump_id", pumpList.map(x => x.id));
      setNozzles((n as Nozzle[]) ?? []);
    } else setNozzles([]);

    const { data: ba } = await supabase.from("branch_attendants").select("user_id").eq("branch_id", selectedBranchId);
    const ids = (ba ?? []).map((r: any) => r.user_id);
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("user_id, full_name").in("user_id", ids);
      setAttendants((profs as AttendantOpt[]) ?? []);
    } else setAttendants([]);

    const { data: dos } = await supabase.from("drive_off_incidents").select("*")
      .eq("branch_id", selectedBranchId).order("reported_at", { ascending: false }).limit(20);
    setDriveOffs((dos as DriveOff[]) ?? []);
  };

  useEffect(() => { refresh(); }, [selectedBranchId]);

  const openNewPump = () => {
    setEditingPump(null);
    setPumpForm({ code: "", label: "", notes: "" });
    setPumpOpen(true);
  };
  const openEditPump = (p: Pump) => {
    setEditingPump(p);
    setPumpForm({ code: p.code, label: p.label ?? "", notes: p.notes ?? "" });
    setPumpOpen(true);
  };

  const savePump = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBranchId || !pumpForm.code.trim()) return;
    try {
      if (editingPump) {
        const { error } = await supabase.from("pumps").update({
          code: pumpForm.code.trim(), label: pumpForm.label.trim() || null, notes: pumpForm.notes.trim() || null,
        }).eq("id", editingPump.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("pumps").insert({
          branch_id: selectedBranchId, code: pumpForm.code.trim(),
          label: pumpForm.label.trim() || null, notes: pumpForm.notes.trim() || null,
        });
        if (error) throw error;
      }
      toast({ title: editingPump ? "Pump updated" : "Pump added" });
      setPumpOpen(false);
      refresh();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  };

  const deletePump = (id: string) => {
    confirmDelete({
      title: "Delete pump",
      description: "This permanently removes the pump and its nozzles. Admin password required.",
      action: async () => {
        const { error } = await supabase.from("pumps").delete().eq("id", id);
        if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
        else { toast({ title: "Pump deleted" }); refresh(); }
      },
    });
  };

  const updateStatus = async (p: Pump, status: Pump["status"]) => {
    const { error } = await supabase.from("pumps").update({ status }).eq("id", p.id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else refresh();
  };

  const updateAttendant = async (p: Pump, attendantId: string | null) => {
    const { error } = await supabase.from("pumps").update({ assigned_attendant_id: attendantId }).eq("id", p.id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else refresh();
  };

  const openNewNozzle = (p: Pump) => {
    setNozzlePump(p);
    setNozzleForm({ code: "", branch_fuel_type_id: "" });
    setNozzleOpen(true);
  };
  const saveNozzle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nozzlePump || !nozzleForm.code.trim() || !nozzleForm.branch_fuel_type_id) return;
    const { error } = await supabase.from("pump_nozzles").insert({
      pump_id: nozzlePump.id, code: nozzleForm.code.trim(),
      branch_fuel_type_id: nozzleForm.branch_fuel_type_id,
    });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Nozzle added" }); setNozzleOpen(false); refresh(); }
  };
  const deleteNozzle = (id: string) => {
    confirmDelete({
      title: "Delete nozzle", action: async () => {
        const { error } = await supabase.from("pump_nozzles").delete().eq("id", id);
        if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
        else refresh();
      },
    });
  };

  const reportDriveOff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBranchId) return;
    const { error } = await supabase.from("drive_off_incidents").insert({
      branch_id: selectedBranchId,
      pump_id: driveOffForm.pump_id || null,
      vehicle_plate: driveOffForm.vehicle_plate.trim() || null,
      estimated_litres: driveOffForm.estimated_litres ? Number(driveOffForm.estimated_litres) : null,
      estimated_amount: driveOffForm.estimated_amount ? Number(driveOffForm.estimated_amount) : null,
      notes: driveOffForm.notes.trim() || null,
      attendant_id: user?.id ?? null,
      reported_by: user?.id ?? null,
    });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else {
      toast({ title: "Drive-off reported", description: "Incident logged for review." });
      setDriveOffOpen(false);
      setDriveOffForm({ pump_id: "", vehicle_plate: "", estimated_litres: "", estimated_amount: "", notes: "" });
      refresh();
    }
  };

  const fuelName = (id: string) => fuels.find(f => f.id === id)?.name ?? "—";
  const attendantName = (id: string | null) => id ? (attendants.find(a => a.user_id === id)?.full_name ?? "—") : "Unassigned";

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold flex items-center gap-2"><Gauge className="h-6 w-6 text-accent" />Pump Management</h1>
          <BranchBadge />
        </div>
        <div className="flex items-center gap-2">
          {branches.length > 0 && (
            <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
              <SelectTrigger className="w-[200px]"><Building2 className="h-4 w-4 mr-2" /><SelectValue /></SelectTrigger>
              <SelectContent>
                {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" onClick={() => setDriveOffOpen(true)}>
            <AlertTriangle className="h-4 w-4 mr-2" />Drive-off
          </Button>
          {canManage && <Button onClick={openNewPump} className="bg-accent text-accent-foreground hover:bg-accent/90">
            <Plus className="h-4 w-4 mr-2" />New Pump
          </Button>}
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {pumps.map(p => {
          const pn = nozzles.filter(n => n.pump_id === p.id);
          return (
            <Card key={p.id} className="border-l-4" style={{ borderLeftColor: p.status === "active" ? "hsl(var(--success))" : p.status === "error" ? "hsl(var(--destructive))" : "hsl(var(--border))" }}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      Pump {p.code}
                      <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_STYLES[p.status]}`}>{p.status}</span>
                    </CardTitle>
                    {p.label && <p className="text-xs text-muted-foreground mt-1">{p.label}</p>}
                  </div>
                  {canManage && (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEditPump(p)}><Edit2 className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => deletePump(p.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <Select value={p.status} onValueChange={(v) => updateStatus(p, v as Pump["status"])} disabled={!canManage && !attendants.some(a => a.user_id === user?.id)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="idle">Idle</SelectItem>
                        <SelectItem value="error">Error</SelectItem>
                        <SelectItem value="offline">Offline</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Attendant</Label>
                    <Select value={p.assigned_attendant_id ?? "none"} onValueChange={(v) => updateAttendant(p, v === "none" ? null : v)} disabled={!canManage}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Unassigned</SelectItem>
                        {attendants.map(a => <SelectItem key={a.user_id} value={a.user_id}>{a.full_name || "Unnamed"}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label className="text-xs text-muted-foreground">Nozzles ({pn.length})</Label>
                    {canManage && <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => openNewNozzle(p)}>
                      <Plus className="h-3 w-3 mr-1" />Add
                    </Button>}
                  </div>
                  <div className="space-y-1">
                    {pn.map(n => (
                      <div key={n.id} className="flex items-center justify-between text-xs bg-muted/50 px-2 py-1 rounded">
                        <span className="font-mono">N{n.code}</span>
                        <span className="text-muted-foreground">{fuelName(n.branch_fuel_type_id)}</span>
                        {canManage && <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => deleteNozzle(n.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>}
                      </div>
                    ))}
                    {pn.length === 0 && <p className="text-xs text-muted-foreground italic">No nozzles configured</p>}
                  </div>
                </div>

                {p.notes && <p className="text-xs text-muted-foreground border-t pt-2">{p.notes}</p>}
              </CardContent>
            </Card>
          );
        })}
        {pumps.length === 0 && selectedBranchId && (
          <Card className="md:col-span-2 lg:col-span-3"><CardContent className="py-12 text-center text-muted-foreground">
            No pumps configured for this branch. {canManage && "Click \"New Pump\" to add one."}
          </CardContent></Card>
        )}
      </div>

      {driveOffs.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" />Recent Drive-offs</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4">Time</th><th className="py-2 pr-4">Pump</th><th className="py-2 pr-4">Plate</th>
                  <th className="py-2 pr-4">Litres</th><th className="py-2 pr-4">Amount</th><th className="py-2">Notes</th>
                </tr></thead>
                <tbody>
                  {driveOffs.map(d => (
                    <tr key={d.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 text-muted-foreground">{format(new Date(d.reported_at), "MMM d, HH:mm")}</td>
                      <td className="py-2 pr-4">{pumps.find(p => p.id === d.pump_id)?.code ?? "—"}</td>
                      <td className="py-2 pr-4 font-mono">{d.vehicle_plate ?? "—"}</td>
                      <td className="py-2 pr-4 font-mono">{d.estimated_litres ?? "—"}</td>
                      <td className="py-2 pr-4 font-mono">{d.estimated_amount ? `KES ${Number(d.estimated_amount).toLocaleString()}` : "—"}</td>
                      <td className="py-2 text-muted-foreground truncate max-w-[200px]">{d.notes ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={pumpOpen} onOpenChange={setPumpOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingPump ? "Edit Pump" : "New Pump"}</DialogTitle></DialogHeader>
          <form onSubmit={savePump} className="space-y-4">
            <div><Label>Code *</Label><Input value={pumpForm.code} onChange={e => setPumpForm({ ...pumpForm, code: e.target.value })} required placeholder="e.g. P1" /></div>
            <div><Label>Label</Label><Input value={pumpForm.label} onChange={e => setPumpForm({ ...pumpForm, label: e.target.value })} placeholder="e.g. Front Diesel Pump" /></div>
            <div><Label>Notes</Label><Textarea value={pumpForm.notes} onChange={e => setPumpForm({ ...pumpForm, notes: e.target.value })} /></div>
            <Button type="submit" className="w-full">Save</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={nozzleOpen} onOpenChange={setNozzleOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Nozzle to Pump {nozzlePump?.code}</DialogTitle></DialogHeader>
          <form onSubmit={saveNozzle} className="space-y-4">
            <div><Label>Nozzle Code *</Label><Input value={nozzleForm.code} onChange={e => setNozzleForm({ ...nozzleForm, code: e.target.value })} required placeholder="e.g. 1" /></div>
            <div>
              <Label>Fuel Grade *</Label>
              <Select value={nozzleForm.branch_fuel_type_id} onValueChange={v => setNozzleForm({ ...nozzleForm, branch_fuel_type_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select grade" /></SelectTrigger>
                <SelectContent>{fuels.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button type="submit" className="w-full">Add Nozzle</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={driveOffOpen} onOpenChange={setDriveOffOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" />Report Drive-off</DialogTitle></DialogHeader>
          <form onSubmit={reportDriveOff} className="space-y-4">
            <div>
              <Label>Pump</Label>
              <Select value={driveOffForm.pump_id} onValueChange={v => setDriveOffForm({ ...driveOffForm, pump_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select pump" /></SelectTrigger>
                <SelectContent>{pumps.map(p => <SelectItem key={p.id} value={p.id}>Pump {p.code}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Vehicle Plate</Label><Input value={driveOffForm.vehicle_plate} onChange={e => setDriveOffForm({ ...driveOffForm, vehicle_plate: e.target.value })} placeholder="KAA 123A" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Est. Litres</Label><Input type="number" step="0.01" value={driveOffForm.estimated_litres} onChange={e => setDriveOffForm({ ...driveOffForm, estimated_litres: e.target.value })} /></div>
              <div><Label>Est. KES</Label><Input type="number" step="0.01" value={driveOffForm.estimated_amount} onChange={e => setDriveOffForm({ ...driveOffForm, estimated_amount: e.target.value })} /></div>
            </div>
            <div><Label>Notes</Label><Textarea value={driveOffForm.notes} onChange={e => setDriveOffForm({ ...driveOffForm, notes: e.target.value })} /></div>
            <Button type="submit" variant="destructive" className="w-full">Log Drive-off</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
