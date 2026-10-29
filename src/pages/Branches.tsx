import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useConfirmDelete } from "@/hooks/useConfirmDelete";
import { Building2, Plus, Users, Fuel, Trash2, MapPin, ShoppingCart, Pencil, Clock } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useModifierNames } from "@/hooks/useModifierNames";
import { format } from "date-fns";
// Branch deletion intentionally disabled per product requirement.

interface Branch {
  id: string;
  name: string;
  location: string | null;
  mpesa_shortcode?: string | null;
  mpesa_consumer_key?: string | null;
  mpesa_consumer_secret?: string | null;
  mpesa_passkey?: string | null;
  is_active: boolean;
  created_at: string;
  last_modified_by: string | null;
  last_modified_at: string | null;
}


interface BranchFuelType {
  id: string;
  branch_id: string;
  name: string;
  price_per_litre: number;
  stock_level: number;
}

interface BranchAttendant {
  id: string;
  branch_id: string;
  user_id: string;
  assigned_at: string;
}

interface UserEntry {
  id: string;
  email: string;
  full_name: string;
  roles: string[];
}

export default function Branches() {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const confirmDelete = useConfirmDelete();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [branchFuels, setBranchFuels] = useState<BranchFuelType[]>([]);
  const [branchAttendants, setBranchAttendants] = useState<BranchAttendant[]>([]);
  const [allUsers, setAllUsers] = useState<UserEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const branchModifiers = useModifierNames(branches.map((b) => b.last_modified_by));

  // New branch form
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [newBranch, setNewBranch] = useState({ name: "", location: "" });

  // New fuel form
  const [showNewFuel, setShowNewFuel] = useState(false);
  const [newFuel, setNewFuel] = useState({ name: "", price_per_litre: "", stock_level: "" });

  // Edit branch form
  const [showEditBranch, setShowEditBranch] = useState(false);
  const [editBranch, setEditBranch] = useState({
    name: "",
    location: "",
    is_active: true,
  });

  const fetchBranches = async () => {
    const { data } = await supabase.from("branches").select("*").order("created_at");
    const list = (data ?? []) as any[];
    const ids = list.map((b) => b.id);
    let credsById: Record<string, any> = {};
    if (ids.length) {
      const { data: creds } = await supabase.from("branch_mpesa_credentials").select("*").in("branch_id", ids);
      credsById = Object.fromEntries((creds ?? []).map((c: any) => [c.branch_id, c]));
    }
    const merged: Branch[] = list.map((b) => ({
      ...b,
      mpesa_shortcode: credsById[b.id]?.mpesa_shortcode ?? null,
      mpesa_consumer_key: credsById[b.id]?.mpesa_consumer_key ?? null,
      mpesa_consumer_secret: credsById[b.id]?.mpesa_consumer_secret ?? null,
      mpesa_passkey: credsById[b.id]?.mpesa_passkey ?? null,
    }));
    setBranches(merged);
    setSelectedBranch((cur) => cur ? merged.find((m) => m.id === cur.id) ?? cur : cur);
    setLoading(false);
  };


  const fetchBranchDetails = async (branchId: string) => {
    const [{ data: fuels }, { data: attendants }] = await Promise.all([
      supabase.from("branch_fuel_types").select("*").eq("branch_id", branchId),
      supabase.from("branch_attendants").select("*").eq("branch_id", branchId),
    ]);
    setBranchFuels((fuels as BranchFuelType[]) ?? []);
    setBranchAttendants((attendants as BranchAttendant[]) ?? []);
  };

  const fetchAllUsers = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-users?action=list`,
        {
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        }
      );
      if (response.ok) {
        const data = await response.json();
        setAllUsers(data);
      }
    } catch {}
  };

  useEffect(() => {
    fetchBranches();
    if (hasRole("admin")) fetchAllUsers();
  }, []);

  useEffect(() => {
    if (selectedBranch) fetchBranchDetails(selectedBranch.id);
  }, [selectedBranch]);

  const createBranch = async () => {
    const { data: created, error } = await supabase.from("branches").insert({
      name: newBranch.name,
      location: newBranch.location || null,
    }).select().single();
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Branch created!" });
    setShowNewBranch(false);
    setNewBranch({ name: "", location: "" });
    await fetchBranches();
    if (created) setSelectedBranch(created as Branch);
  };


  const openEditBranch = () => {
    if (!selectedBranch) return;
    setEditBranch({
      name: selectedBranch.name ?? "",
      location: selectedBranch.location ?? "",
      is_active: selectedBranch.is_active,
    });
    setShowEditBranch(true);
  };

  const updateBranch = async () => {
    if (!selectedBranch) return;
    if (!editBranch.name.trim()) {
      toast({ title: "Branch name is required", variant: "destructive" });
      return;
    }
    const { data: updated, error } = await supabase
      .from("branches")
      .update({
        name: editBranch.name.trim(),
        location: editBranch.location.trim() || null,
        is_active: editBranch.is_active,
      })
      .eq("id", selectedBranch.id)
      .select()
      .single();
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Branch updated" });
    setShowEditBranch(false);
    await fetchBranches();
    if (updated) setSelectedBranch(updated as Branch);
  };


  const addFuelType = async () => {
    if (!selectedBranch) return;
    const { error } = await supabase.from("branch_fuel_types").insert({
      branch_id: selectedBranch.id,
      name: newFuel.name,
      price_per_litre: Number(newFuel.price_per_litre),
      stock_level: Number(newFuel.stock_level) || 0,
    });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Fuel type added!" });
    setShowNewFuel(false);
    setNewFuel({ name: "", price_per_litre: "", stock_level: "" });
    fetchBranchDetails(selectedBranch.id);
  };

  const removeFuelType = (id: string) => {
    confirmDelete({
      title: "Remove fuel type", action: async () => {
        await supabase.from("branch_fuel_types").delete().eq("id", id);
        if (selectedBranch) fetchBranchDetails(selectedBranch.id);
      },
    });
  };

  const assignAttendant = async (userId: string) => {
    if (!selectedBranch) return;
    const { error } = await supabase.from("branch_attendants").insert({
      branch_id: selectedBranch.id,
      user_id: userId,
    });
    if (error) {
      if (error.code === "23505") {
        toast({ title: "Already assigned", variant: "destructive" });
      } else {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
      return;
    }
    toast({ title: "Attendant assigned!" });
    fetchBranchDetails(selectedBranch.id);
  };

  const removeAttendant = (id: string) => {
    confirmDelete({
      title: "Remove attendant from branch", action: async () => {
        await supabase.from("branch_attendants").delete().eq("id", id);
        if (selectedBranch) fetchBranchDetails(selectedBranch.id);
      },
    });
  };

  if (!hasRole("admin")) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Admin access required.</p>
      </div>
    );
  }

  const assignedUserIds = branchAttendants.map((a) => a.user_id);
  const unassignedUsers = allUsers.filter((u) => !assignedUserIds.includes(u.id));

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Branches</h1>
          <p className="text-muted-foreground">Manage petrol station branches</p>
        </div>
        <Dialog open={showNewBranch} onOpenChange={setShowNewBranch}>
          <DialogTrigger asChild>
            <Button className="bg-accent text-accent-foreground hover:bg-accent/90 gap-2">
              <Plus className="h-4 w-4" /> Add Branch
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>New Branch</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Branch Name *</Label>
                  <Input value={newBranch.name} onChange={(e) => setNewBranch({ ...newBranch, name: e.target.value })} placeholder="Main Street Station" />
                </div>
                <div className="space-y-2">
                  <Label>Location</Label>
                  <Input value={newBranch.location} onChange={(e) => setNewBranch({ ...newBranch, location: e.target.value })} placeholder="Nairobi, Kenya" />
                </div>
              </div>
              <Button onClick={createBranch} disabled={!newBranch.name} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
                Create Branch
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit Branch Dialog */}
      <Dialog open={showEditBranch} onOpenChange={setShowEditBranch}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Branch</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Branch Name *</Label>
                <Input value={editBranch.name} onChange={(e) => setEditBranch({ ...editBranch, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Location</Label>
                <Input value={editBranch.location} onChange={(e) => setEditBranch({ ...editBranch, location: e.target.value })} />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">Inactive branches are hidden from sales & fuel</p>
              </div>
              <Switch checked={editBranch.is_active} onCheckedChange={(v) => setEditBranch({ ...editBranch, is_active: v })} />
            </div>
            <Button onClick={updateBranch} disabled={!editBranch.name.trim()} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Branch List */}
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4" /> All Branches</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin h-8 w-8 border-4 border-accent border-t-transparent rounded-full" />
              </div>
            ) : branches.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No branches yet</p>
            ) : (
              branches.map((b) => (
                <div
                  key={b.id}
                  onClick={() => setSelectedBranch(b)}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedBranch?.id === b.id ? "border-accent bg-accent/5" : "border-border hover:border-accent/50"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-sm">{b.name}</p>
                      {b.location && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <MapPin className="h-3 w-3" /> {b.location}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-accent hover:text-accent/80"
                        onClick={(e) => { e.stopPropagation(); navigate(`/sales?branch=${b.id}`); }}
                        title="View Sales"
                      >
                        <ShoppingCart className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Branch Details */}
        <Card className="md:col-span-2">
          {selectedBranch ? (
            <Tabs defaultValue="fuel">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">{selectedBranch.name}</CardTitle>
                      {!selectedBranch.is_active && <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={openEditBranch} title="Edit branch">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {selectedBranch.last_modified_by && (
                      <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-1">
                        <Clock className="h-3 w-3" />
                        Last modified by <span className="font-medium text-foreground">{branchModifiers[selectedBranch.last_modified_by] ?? "…"}</span>
                        {selectedBranch.last_modified_at && ` · ${format(new Date(selectedBranch.last_modified_at), "MMM d, yyyy HH:mm")}`}
                      </p>
                    )}
                  </div>
                  <TabsList>
                    <TabsTrigger value="fuel" className="gap-1"><Fuel className="h-3 w-3" /> Fuel Types</TabsTrigger>
                    <TabsTrigger value="attendants" className="gap-1"><Users className="h-3 w-3" /> Attendants</TabsTrigger>
                    
                  </TabsList>
                </div>
              </CardHeader>
              <CardContent>
                <TabsContent value="fuel" className="space-y-4">
                  <div className="flex justify-end">
                    <Dialog open={showNewFuel} onOpenChange={setShowNewFuel}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline" className="gap-1"><Plus className="h-3 w-3" /> Add Fuel</Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader><DialogTitle>Add Fuel Type</DialogTitle></DialogHeader>
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label>Name</Label>
                            <Input value={newFuel.name} onChange={(e) => setNewFuel({ ...newFuel, name: e.target.value })} placeholder="Super Petrol" />
                          </div>
                          <div className="space-y-2">
                            <Label>Price per Litre (KES)</Label>
                            <Input type="number" value={newFuel.price_per_litre} onChange={(e) => setNewFuel({ ...newFuel, price_per_litre: e.target.value })} />
                          </div>
                          <div className="space-y-2">
                            <Label>Initial Stock (Litres)</Label>
                            <Input type="number" value={newFuel.stock_level} onChange={(e) => setNewFuel({ ...newFuel, stock_level: e.target.value })} />
                          </div>
                          <Button onClick={addFuelType} disabled={!newFuel.name || !newFuel.price_per_litre} className="w-full bg-accent text-accent-foreground">Add Fuel Type</Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                  {branchFuels.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No fuel types. Add one above.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fuel</TableHead>
                          <TableHead>Price/L</TableHead>
                          <TableHead>Stock</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {branchFuels.map((f) => (
                          <TableRow key={f.id}>
                            <TableCell className="font-medium">{f.name}</TableCell>
                            <TableCell className="font-mono">KES {Number(f.price_per_litre).toLocaleString()}</TableCell>
                            <TableCell className="font-mono">{Number(f.stock_level).toLocaleString()}L</TableCell>
                            <TableCell>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive/60 hover:text-destructive" onClick={() => removeFuelType(f.id)}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </TabsContent>

                <TabsContent value="attendants" className="space-y-4">
                  <div className="flex justify-end">
                    <Select onValueChange={assignAttendant}>
                      <SelectTrigger className="w-[200px]">
                        <SelectValue placeholder="Assign user..." />
                      </SelectTrigger>
                      <SelectContent>
                        {unassignedUsers.length === 0 ? (
                          <SelectItem value="none" disabled>All users assigned</SelectItem>
                        ) : (
                          unassignedUsers.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.full_name || u.email}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  {branchAttendants.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No attendants assigned.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>User</TableHead>
                          <TableHead>Roles</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {branchAttendants.map((a) => {
                          const u = allUsers.find((u) => u.id === a.user_id);
                          return (
                            <TableRow key={a.id}>
                              <TableCell>
                                <p className="font-medium text-sm">{u?.full_name || "—"}</p>
                                <p className="text-xs text-muted-foreground">{u?.email || a.user_id}</p>
                              </TableCell>
                              <TableCell>
                                <div className="flex gap-1">
                                  {u?.roles.map((r) => (
                                    <Badge key={r} variant="outline" className="text-[10px]">{r}</Badge>
                                  ))}
                                </div>
                              </TableCell>
                              <TableCell>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive/60 hover:text-destructive" onClick={() => removeAttendant(a.id)}>
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </TabsContent>

              </CardContent>
            </Tabs>
          ) : (
            <CardContent className="flex items-center justify-center py-16">
              <p className="text-muted-foreground text-sm">Select a branch to manage</p>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
