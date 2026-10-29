import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, ALL_PAGE_KEYS, PAGE_LABELS, type PageKey } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Users as UsersIcon, Shield, ShieldCheck, User, UserPlus, Building2, Trash2, Wallet, KeyRound } from "lucide-react";
import { format } from "date-fns";
import { useConfirmDelete } from "@/hooks/useConfirmDelete";
import { Link } from "react-router-dom";
import { Checkbox } from "@/components/ui/checkbox";

interface UserBranch { id: string; name: string }
interface UserEntry {
  id: string;
  email: string;
  full_name: string;
  phone: string;
  id_number: string;
  roles: string[];
  branches: UserBranch[];
  created_at: string;
}

interface Branch { id: string; name: string }

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-destructive/10 text-destructive border-destructive/20",
  manager: "bg-accent/10 text-accent border-accent/20",
  attendant: "bg-primary/10 text-primary border-primary/20",
};

const ROLE_ICONS: Record<string, typeof Shield> = {
  admin: ShieldCheck,
  manager: Shield,
  attendant: User,
};

export default function UsersPage() {
  const { user, hasRole } = useAuth();
  const { toast } = useToast();
  const confirmDelete = useConfirmDelete();
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);

  // Register attendant dialog
  const [registerOpen, setRegisterOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ full_name: "", email: "", phone: "", id_number: "", branch_id: "" });

  // Page-permission dialog
  const [permUser, setPermUser] = useState<UserEntry | null>(null);
  const [permSelected, setPermSelected] = useState<Set<PageKey>>(new Set());
  const [permSaving, setPermSaving] = useState(false);

  const openPermissions = async (u: UserEntry) => {
    setPermUser(u);
    const { data } = await supabase
      .from("user_page_permissions")
      .select("page_key")
      .eq("user_id", u.id);
    setPermSelected(new Set(((data ?? []) as any[]).map((r) => r.page_key as PageKey)));
  };

  const togglePerm = (p: PageKey) => {
    const next = new Set(permSelected);
    if (next.has(p)) next.delete(p); else next.add(p);
    setPermSelected(next);
  };

  const savePermissions = async () => {
    if (!permUser) return;
    setPermSaving(true);
    try {
      await supabase.from("user_page_permissions").delete().eq("user_id", permUser.id);
      const rows = Array.from(permSelected).map((p) => ({ user_id: permUser.id, page_key: p, granted_by: user?.id ?? null }));
      if (rows.length > 0) {
        const { error } = await supabase.from("user_page_permissions").insert(rows as any);
        if (error) throw error;
      }
      toast({ title: "Page access updated", description: "Changes take effect immediately for the user." });
      setPermUser(null);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setPermSaving(false);
    }
  };


  const callFn = async (path: string, init?: RequestInit) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-users${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${session?.access_token}`,
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        ...(init?.headers || {}),
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 401) {
        await supabase.auth.signOut();
        throw new Error("Session expired. Please log in again.");
      }
      throw new Error(err.error || `Request failed (${res.status})`);
    }
    return res.json();
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const data = await callFn("?action=list");
      setUsers(data);
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const fetchBranches = async () => {
    const { data } = await supabase.from("branches").select("id, name").eq("is_active", true).order("name");
    setBranches((data as Branch[]) ?? []);
  };

  useEffect(() => {
    if (hasRole("admin")) {
      fetchUsers();
      fetchBranches();
    }
  }, []);

  const updateRole = async (userId: string, role: string, operation: "add" | "remove") => {
    try {
      await callFn("?action=update-role", { method: "POST", body: JSON.stringify({ user_id: userId, role, operation }) });
      toast({ title: `Role ${operation === "add" ? "assigned" : "removed"}` });
      fetchUsers();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const assignBranch = async (userId: string, branchId: string, operation: "add" | "remove") => {
    try {
      await callFn("?action=assign-branch", { method: "POST", body: JSON.stringify({ user_id: userId, branch_id: branchId, operation }) });
      toast({ title: `Branch ${operation === "add" ? "assigned" : "unassigned"}` });
      fetchUsers();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };


  const handleDeleteUser = (u: UserEntry) => {
    if (u.id === user?.id) {
      toast({ title: "Cannot delete your own account", variant: "destructive" });
      return;
    }
    confirmDelete({
      title: `Delete user ${u.full_name || u.email}?`,
      description: "This permanently removes the user, their roles and branch assignments. Admin password required.",
      requireAdmin: true,
      action: async () => {
        try {
          await callFn("?action=delete-user", { method: "POST", body: JSON.stringify({ user_id: u.id }) });
          toast({ title: "User deleted" });
          fetchUsers();
        } catch (e: any) {
          toast({ title: "Error", description: e.message, variant: "destructive" });
        }
      },
    });
  };


  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email || !form.id_number) {
      toast({ title: "Email and ID number are required", variant: "destructive" });
      return;
    }
    if (form.id_number.length < 6) {
      toast({ title: "ID number must be at least 6 characters", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await callFn("?action=create-user", {
        method: "POST",
        body: JSON.stringify({
          email: form.email.trim().toLowerCase(),
          phone: form.phone.trim() || null,
          id_number: form.id_number.trim(),
          full_name: form.full_name.trim(),
          branch_id: form.branch_id || null,
        }),
      });
      toast({ title: "Attendant registered", description: `Login: ${form.email} · Password: ${form.id_number}` });
      setRegisterOpen(false);
      setForm({ full_name: "", email: "", phone: "", id_number: "", branch_id: "" });
      fetchUsers();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (!hasRole("admin")) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">User Management</h1>
          <p className="text-muted-foreground">Register attendants and manage roles & branch assignments</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="gap-1">
            <UsersIcon className="h-3 w-3" />
            {users.length} users
          </Badge>
          <Link to="/payroll">
            <Button variant="outline" className="gap-2">
              <Wallet className="h-4 w-4" /> Payroll
            </Button>
          </Link>
          <Button onClick={() => setRegisterOpen(true)} className="bg-accent text-accent-foreground hover:bg-accent/90">
            <UserPlus className="h-4 w-4 mr-2" /> Register Attendant
          </Button>
        </div>
      </div>

      {/* Roles & Permissions reference */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Roles & Permissions</CardTitle>
          <p className="text-xs text-muted-foreground">
            Assign one or more roles from the table below. Permissions apply automatically across all pages.
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[220px]">Page / Feature</TableHead>
                  <TableHead className="text-center">Attendant</TableHead>
                  <TableHead className="text-center">Manager</TableHead>
                  <TableHead className="text-center">Admin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  { page: "Dashboard", a: "—", m: "View", d: "Full" },
                  { page: "Sales — record", a: "Record", m: "Record", d: "Record + Custom price" },
                  { page: "Sales — history", a: "Own branch", m: "All branches", d: "All branches" },
                  { page: "Pumps", a: "View", m: "View + edit", d: "Full" },
                  { page: "Tanks", a: "—", m: "View", d: "Full (dips, deliveries)" },
                  { page: "Fuel Management", a: "View", m: "View", d: "Edit prices / products" },
                  { page: "Expenses", a: "Add + view own", m: "Add / edit / delete", d: "Full" },
                  { page: "Reports & Discrepancies", a: "—", m: "View", d: "Full + validation alerts" },
                  { page: "Reconciliation", a: "—", m: "View", d: "Full" },
                  { page: "Branches", a: "—", m: "View", d: "Create / edit / delete" },
                  { page: "Users", a: "—", m: "—", d: "Register, assign roles & branches" },
                  { page: "Payroll", a: "—", m: "View", d: "Run payroll" },
                ].map((r) => (
                  <TableRow key={r.page}>
                    <TableCell className="font-medium">{r.page}</TableCell>
                    <TableCell className="text-center text-xs">
                      <span className={r.a === "—" ? "text-muted-foreground" : "text-primary"}>{r.a}</span>
                    </TableCell>
                    <TableCell className="text-center text-xs">
                      <span className={r.m === "—" ? "text-muted-foreground" : "text-accent"}>{r.m}</span>
                    </TableCell>
                    <TableCell className="text-center text-xs">
                      <span className={r.d === "—" ? "text-muted-foreground" : "text-destructive font-medium"}>{r.d}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">
            Tip: a single user can have multiple roles. Higher roles inherit lower-role permissions.
          </p>
        </CardContent>
      </Card>


      {/* Attendants grouped by branch */}
      {(() => {
        const attendants = users.filter((u) => u.roles.includes("attendant"));
        const groups: Record<string, { branchName: string; list: UserEntry[] }> = {};
        attendants.forEach((u) => {
          if (u.branches.length === 0) {
            (groups["__none"] ||= { branchName: "Unassigned", list: [] }).list.push(u);
          } else {
            u.branches.forEach((b) => {
              (groups[b.id] ||= { branchName: b.name, list: [] }).list.push(u);
            });
          }
        });
        const entries = Object.entries(groups).sort((a, b) =>
          a[0] === "__none" ? 1 : b[0] === "__none" ? -1 : a[1].branchName.localeCompare(b[1].branchName)
        );
        if (attendants.length === 0) return null;
        return (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Building2 className="h-4 w-4" /> Attendants by Branch</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {entries.map(([key, g]) => (
                <div key={key} className="border rounded-lg p-3">
                  <p className="font-semibold text-sm mb-2 flex items-center gap-2">
                    <Badge variant="outline" className={key === "__none" ? "text-destructive border-destructive/40" : ""}>
                      {g.branchName}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{g.list.length} attendant(s)</span>
                  </p>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {g.list.map((u) => (
                      <div key={`${key}-${u.id}`} className="text-sm border rounded p-2 bg-muted/30">
                        <p className="font-medium truncate">{u.full_name || "—"}</p>
                        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                        {u.phone && <p className="text-[11px] text-muted-foreground">{u.phone}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })()}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All Users</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin h-8 w-8 border-4 border-accent border-t-transparent rounded-full" />
            </div>
          ) : users.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No users found</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Roles</TableHead>
                    <TableHead>Branches</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{u.full_name || "—"}</p>
                          <p className="text-xs text-muted-foreground">{u.email}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <div>{u.phone || <span className="text-muted-foreground">—</span>}</div>
                        <div className="text-muted-foreground font-mono">ID: {u.id_number || "—"}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {u.roles.length === 0 ? (
                            <span className="text-xs text-muted-foreground">No roles</span>
                          ) : (
                            u.roles.map((role) => {
                              const Icon = ROLE_ICONS[role] || User;
                              return (
                                <Badge
                                  key={role}
                                  variant="outline"
                                  className={`gap-1 cursor-pointer ${ROLE_COLORS[role] || ""}`}
                                  onClick={() => {
                                    if (u.id === user?.id && role === "admin") {
                                      toast({ title: "Cannot remove your own admin role", variant: "destructive" });
                                      return;
                                    }
                                    updateRole(u.id, role, "remove");
                                  }}
                                >
                                  <Icon className="h-3 w-3" />
                                  {role}
                                  <span className="text-[10px] opacity-50">×</span>
                                </Badge>
                              );
                            })
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap max-w-[220px]">
                          {u.branches.length === 0 ? (
                            <span className="text-xs text-muted-foreground">None</span>
                          ) : (
                            u.branches.map((b) => (
                              <Badge
                                key={b.id}
                                variant="outline"
                                className="gap-1 cursor-pointer"
                                onClick={() => assignBranch(u.id, b.id, "remove")}
                                title="Click to unassign"
                              >
                                <Building2 className="h-3 w-3" />
                                {b.name}
                                <span className="text-[10px] opacity-50">×</span>
                              </Badge>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground font-mono">
                        {format(new Date(u.created_at), "dd MMM yyyy")}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1.5">
                          <Select onValueChange={(role) => updateRole(u.id, role, "add")}>
                            <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue placeholder="Add role..." /></SelectTrigger>
                            <SelectContent>
                              {["admin", "manager", "attendant"]
                                .filter((r) => !u.roles.includes(r))
                                .map((r) => (
                                  <SelectItem key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                          <Select onValueChange={(branchId) => assignBranch(u.id, branchId, "add")}>
                            <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue placeholder="Assign branch..." /></SelectTrigger>
                            <SelectContent>
                              {branches
                                .filter((b) => !u.branches.find((ub) => ub.id === b.id))
                                .map((b) => (
                                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs justify-start"
                            onClick={() => openPermissions(u)}
                          >
                            <KeyRound className="h-3.5 w-3.5 mr-1" /> Page access
                          </Button>
                          {u.id !== user?.id && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10 justify-start"
                              onClick={() => handleDeleteUser(u)}
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete user
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Register New Attendant</DialogTitle>
            <DialogDescription>
              The attendant will sign in using their email and their ID number as the password.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRegister} className="space-y-3">
            <div className="space-y-1.5">
              <Label>Full Name</Label>
              <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Jane Doe" />
            </div>
            <div className="space-y-1.5">
              <Label>Email *</Label>
              <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Phone Number</Label>
              <Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="0712345678" />
            </div>
            <div className="space-y-1.5">
              <Label>ID Number * (used as password)</Label>
              <Input required minLength={6} value={form.id_number} onChange={(e) => setForm({ ...form, id_number: e.target.value })} placeholder="Min 6 characters" />
              <p className="text-xs text-muted-foreground">Attendant logs in with email + this ID number.</p>
            </div>
            {branches.length > 0 && (
              <div className="space-y-1.5">
                <Label>Assign to Branch</Label>
                <Select value={form.branch_id} onValueChange={(v) => setForm({ ...form, branch_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select branch (optional)" /></SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRegisterOpen(false)} disabled={submitting}>Cancel</Button>
              <Button type="submit" disabled={submitting} className="bg-accent text-accent-foreground hover:bg-accent/90">
                {submitting ? "Creating..." : "Create Attendant"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!permUser} onOpenChange={(o) => !o && setPermUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Page access — {permUser?.full_name || permUser?.email}</DialogTitle>
            <DialogDescription>
              Grant access to individual pages. Changes take effect immediately (no re-login required).
              Role-based access still applies on top of these grants.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {ALL_PAGE_KEYS.map((p) => (
              <label key={p} className="flex items-center gap-2 border rounded px-2 py-1.5 text-sm cursor-pointer hover:bg-muted/40">
                <Checkbox checked={permSelected.has(p)} onCheckedChange={() => togglePerm(p)} />
                <span>{PAGE_LABELS[p]}</span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPermUser(null)} disabled={permSaving}>Cancel</Button>
            <Button onClick={savePermissions} disabled={permSaving} className="bg-accent text-accent-foreground hover:bg-accent/90">
              {permSaving ? "Saving..." : "Save page access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
