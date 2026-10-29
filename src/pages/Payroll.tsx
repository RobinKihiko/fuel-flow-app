import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Wallet, Save, Send, Users as UsersIcon } from "lucide-react";
import { PasswordConfirmDialog } from "@/components/PasswordConfirmDialog";
import { format } from "date-fns";

interface Employee {
  user_id: string;
  full_name: string;
  email: string;
  roles: string[];
  payroll?: { id?: string; gross_salary: number; allowances: number; deductions: number; notes: string | null };
}

export default function Payroll() {
  const { hasRole, user } = useAuth();
  const { toast } = useToast();
  const canManage = hasRole("admin") || hasRole("manager");

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState({ gross_salary: "0", allowances: "0", deductions: "0", notes: "" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [postOpen, setPostOpen] = useState(false);
  const [period, setPeriod] = useState(format(new Date(), "yyyy-MM"));

  const load = async () => {
    setLoading(true);
    const [{ data: profiles }, { data: roles }, { data: payroll }] = await Promise.all([
      supabase.from("profiles").select("user_id, full_name, phone"),
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("user_payroll").select("*"),
    ]);
    const list: Employee[] = (profiles ?? []).map((p: any) => {
      const userRoles = (roles ?? []).filter((r: any) => r.user_id === p.user_id).map((r: any) => r.role);
      const pay = (payroll ?? []).find((x: any) => x.user_id === p.user_id);
      return {
        user_id: p.user_id,
        full_name: p.full_name || "—",
        email: p.phone || "",
        roles: userRoles,
        payroll: pay ? {
          id: pay.id, gross_salary: Number(pay.gross_salary), allowances: Number(pay.allowances),
          deductions: Number(pay.deductions), notes: pay.notes,
        } : undefined,
      };
    }).filter(e => e.roles.length > 0);
    list.sort((a, b) => a.full_name.localeCompare(b.full_name));
    setEmployees(list);
    setLoading(false);
  };

  useEffect(() => { if (canManage) load(); }, []);

  if (!canManage) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Admin or manager access required.</div>;
  }

  const openEdit = (e: Employee) => {
    setEditing(e);
    setForm({
      gross_salary: String(e.payroll?.gross_salary ?? 0),
      allowances: String(e.payroll?.allowances ?? 0),
      deductions: String(e.payroll?.deductions ?? 0),
      notes: e.payroll?.notes ?? "",
    });
  };

  const saveSalary = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!editing) return;
    const payload = {
      user_id: editing.user_id,
      gross_salary: Number(form.gross_salary || 0),
      allowances: Number(form.allowances || 0),
      deductions: Number(form.deductions || 0),
      notes: form.notes.trim() || null,
    };
    const { error } = await supabase.from("user_payroll").upsert(payload, { onConflict: "user_id" });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Salary saved" });
    setEditing(null);
    load();
  };

  const netOf = (e: Employee) => e.payroll
    ? Number(e.payroll.gross_salary) + Number(e.payroll.allowances) - Number(e.payroll.deductions)
    : 0;

  const totalSelected = useMemo(
    () => employees.filter(e => selected.has(e.user_id)).reduce((s, e) => s + netOf(e), 0),
    [employees, selected]
  );

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const toggleAll = () => {
    if (selected.size === employees.length) setSelected(new Set());
    else setSelected(new Set(employees.map(e => e.user_id)));
  };

  const postPayroll = async () => {
    const picks = employees.filter(e => selected.has(e.user_id) && netOf(e) > 0);
    if (picks.length === 0) { toast({ title: "Nothing to post", variant: "destructive" }); return; }
    const periodDate = `${period}-01`;
    for (const e of picks) {
      const net = netOf(e);
      const { data: exp, error: expErr } = await supabase.from("expenses").insert({
        description: `Salary — ${e.full_name} (${period})`,
        amount: net,
        category: "Salaries",
        date: periodDate,
        created_by: user?.id,
      }).select().single();
      if (expErr) { toast({ title: `Failed for ${e.full_name}`, description: expErr.message, variant: "destructive" }); continue; }
      await supabase.from("payroll_runs").upsert({
        user_id: e.user_id, period_month: periodDate, net_amount: net,
        expense_id: exp.id, submitted_by: user?.id,
      }, { onConflict: "user_id,period_month" });
    }
    toast({ title: `${picks.length} salaries posted to Expenses` });
    setSelected(new Set());
    setPostOpen(false);
  };

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Wallet className="h-6 w-6 text-accent" />Payroll</h1>
          <p className="text-sm text-muted-foreground">Manage employee salaries and post pay runs to expenses.</p>
        </div>
        <div className="flex items-center gap-2">
          <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-[170px]" />
          <Button
            onClick={() => setPostOpen(true)}
            disabled={selected.size === 0}
            className="bg-accent text-accent-foreground hover:bg-accent/90"
          >
            <Send className="h-4 w-4 mr-2" />Post selected ({selected.size})
          </Button>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <Card className="bg-gradient-to-br from-primary/10 to-transparent">
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-2"><UsersIcon className="h-3 w-3" />Employees</CardTitle></CardHeader>
          <CardContent><p className="font-mono text-2xl font-bold">{employees.length}</p></CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-success/10 to-transparent">
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Total monthly net (KES)</CardTitle></CardHeader>
          <CardContent><p className="font-mono text-2xl font-bold">{employees.reduce((s, e) => s + netOf(e), 0).toLocaleString()}</p></CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-accent/10 to-transparent">
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Selected total (KES)</CardTitle></CardHeader>
          <CardContent><p className="font-mono text-2xl font-bold">{totalSelected.toLocaleString()}</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Employee salaries</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8"><div className="animate-spin h-8 w-8 border-4 border-accent border-t-transparent rounded-full" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 pr-2 w-8">
                      <Checkbox checked={selected.size === employees.length && employees.length > 0} onCheckedChange={toggleAll} />
                    </th>
                    <th className="py-2 pr-4">Employee</th>
                    <th className="py-2 pr-4">Role</th>
                    <th className="py-2 pr-4 text-right">Gross</th>
                    <th className="py-2 pr-4 text-right">Allow.</th>
                    <th className="py-2 pr-4 text-right">Deduct.</th>
                    <th className="py-2 pr-4 text-right">Net</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map(e => (
                    <tr key={e.user_id} className="border-b border-border last:border-0">
                      <td className="py-2.5"><Checkbox checked={selected.has(e.user_id)} onCheckedChange={() => toggle(e.user_id)} /></td>
                      <td className="py-2.5 pr-4">
                        <div className="font-medium">{e.full_name}</div>
                        <div className="text-xs text-muted-foreground">{e.email}</div>
                      </td>
                      <td className="py-2.5 pr-4 text-xs capitalize">{e.roles.join(", ")}</td>
                      <td className="py-2.5 pr-4 text-right font-mono">{Number(e.payroll?.gross_salary ?? 0).toLocaleString()}</td>
                      <td className="py-2.5 pr-4 text-right font-mono">{Number(e.payroll?.allowances ?? 0).toLocaleString()}</td>
                      <td className="py-2.5 pr-4 text-right font-mono">{Number(e.payroll?.deductions ?? 0).toLocaleString()}</td>
                      <td className="py-2.5 pr-4 text-right font-mono font-semibold">{netOf(e).toLocaleString()}</td>
                      <td className="py-2.5">
                        <Button size="sm" variant="outline" onClick={() => openEdit(e)}>
                          <Save className="h-3 w-3 mr-1" />Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {employees.length === 0 && (
                    <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">No employees found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Salary — {editing?.full_name}</DialogTitle></DialogHeader>
          <form onSubmit={saveSalary} className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Gross (KES)</Label><Input type="number" min="0" step="0.01" value={form.gross_salary} onChange={(e) => setForm({ ...form, gross_salary: e.target.value })} /></div>
              <div><Label>Allowances</Label><Input type="number" min="0" step="0.01" value={form.allowances} onChange={(e) => setForm({ ...form, allowances: e.target.value })} /></div>
              <div><Label>Deductions</Label><Input type="number" min="0" step="0.01" value={form.deductions} onChange={(e) => setForm({ ...form, deductions: e.target.value })} /></div>
            </div>
            <div><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <p className="text-sm">Net: <span className="font-mono font-bold">KES {(Number(form.gross_salary || 0) + Number(form.allowances || 0) - Number(form.deductions || 0)).toLocaleString()}</span></p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit">Save salary</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <PasswordConfirmDialog
        open={postOpen}
        onOpenChange={setPostOpen}
        title={`Post ${selected.size} salaries to Expenses`}
        description={`Period ${period}. Total KES ${totalSelected.toLocaleString()}. Re-enter your password to confirm.`}
        confirmLabel="Post payroll"
        onConfirmed={postPayroll}
      />
    </div>
  );
}
