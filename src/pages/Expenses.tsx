import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, FileDown, Trash2, Calendar as CalendarIcon } from "lucide-react";
import { useConfirmDelete } from "@/hooks/useConfirmDelete";
import { format, startOfDay, endOfDay } from "date-fns";
import { DateRange } from "react-day-picker";
import { DateRangePicker } from "@/components/DateRangePicker";
import { cn } from "@/lib/utils";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useModifierNames } from "@/hooks/useModifierNames";

interface Expense {
  id: string;
  description: string;
  amount: number;
  category: string | null;
  date: string;
  last_modified_by: string | null;
  last_modified_at: string | null;
}

export default function Expenses() {
  const { user, hasRole } = useAuth();
  const { toast } = useToast();
  const confirmDelete = useConfirmDelete();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [expenseDate, setExpenseDate] = useState<Date>(new Date());
  const [dateOpen, setDateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  const canEdit = hasRole("admin") || hasRole("manager");
  const canAdd = !!user; // any signed-in user can post
  const modifierNames = useModifierNames(expenses.map((e) => e.last_modified_by));

  const handleDelete = (e: Expense) => confirmDelete({
    title: "Delete this expense?",
    description: `"${e.description}" — KES ${Number(e.amount).toLocaleString()}. Admin password required.`,
    requireAdmin: true,
    action: async () => {
      const { error } = await supabase.from("expenses").delete().eq("id", e.id);
      if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
      else { toast({ title: "Expense deleted" }); fetchExpenses(); }
    },
  });

  const fetchExpenses = async () => {
    let q = supabase.from("expenses").select("*").order("date", { ascending: false }).limit(500);
    if (dateRange?.from) {
      q = q.gte("date", format(startOfDay(dateRange.from), "yyyy-MM-dd"));
      q = q.lte("date", format(endOfDay(dateRange.to ?? dateRange.from), "yyyy-MM-dd"));
    }
    const { data } = await q;
    setExpenses((data as Expense[]) ?? []);
  };

  useEffect(() => { fetchExpenses(); }, [dateRange]);

  const resetForm = () => {
    setDescription(""); setAmount(""); setCategory(""); setEditingId(null); setExpenseDate(new Date());
  };

  const openNew = () => { resetForm(); setDialogOpen(true); };
  const openEdit = (e: Expense) => {
    setEditingId(e.id);
    setDescription(e.description);
    setAmount(String(e.amount));
    setCategory(e.category ?? "");
    setExpenseDate(new Date(e.date));
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const dateStr = format(expenseDate, "yyyy-MM-dd");
      if (editingId) {
        const { error } = await supabase.from("expenses").update({
          description, amount: Number(amount), category: category || null, date: dateStr,
        }).eq("id", editingId);
        if (error) throw error;
        toast({ title: "Expense updated" });
      } else {
        const { error } = await supabase.from("expenses").insert({
          description, amount: Number(amount), category: category || null, created_by: user?.id, date: dateStr,
        });
        if (error) throw error;
        toast({ title: "Expense added" });
      }
      setDialogOpen(false);
      resetForm();
      fetchExpenses();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);

  const exportPDF = () => {
    const doc = new jsPDF();
    const rangeStr = dateRange?.from
      ? `${format(dateRange.from, "MMM d, yyyy")} – ${format(dateRange.to ?? dateRange.from, "MMM d, yyyy")}`
      : "All time";

    doc.setFontSize(16);
    doc.text("Expenses Report", 14, 18);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Period: ${rangeStr}`, 14, 26);
    doc.text(`Generated: ${format(new Date(), "MMM d, yyyy HH:mm")}`, 14, 32);

    autoTable(doc, {
      startY: 40,
      head: [["Date", "Description", "Category", "Amount (KES)"]],
      body: expenses.map((e) => [
        format(new Date(e.date), "yyyy-MM-dd"),
        e.description,
        e.category ?? "—",
        Number(e.amount).toLocaleString(),
      ]),
      foot: [["", "", "Total", totalExpenses.toLocaleString()]],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [30, 41, 59] },
      footStyles: { fillColor: [241, 245, 249], textColor: 20, fontStyle: "bold" },
    });

    doc.save(`expenses-${format(new Date(), "yyyyMMdd-HHmm")}.pdf`);
    toast({ title: "PDF exported" });
  };

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Expenses</h1>
          <p className="text-sm text-muted-foreground">Total: <span className="font-mono font-semibold">KES {totalExpenses.toLocaleString()}</span></p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker value={dateRange} onChange={setDateRange} className="w-[240px]" />
          <Button variant="outline" onClick={exportPDF} disabled={expenses.length === 0}>
            <FileDown className="h-4 w-4 mr-2" /> Export PDF
          </Button>
          {canAdd && (
            <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) resetForm(); }}>
              <DialogTrigger asChild>
                <Button onClick={openNew} className="bg-accent text-accent-foreground hover:bg-accent/90">
                  <Plus className="h-4 w-4 mr-2" /> Add Expense
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{editingId ? "Edit Expense" : "Add Expense"}</DialogTitle></DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label>Date</Label>
                    <Popover open={dateOpen} onOpenChange={setDateOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          className={cn("w-full justify-start text-left font-normal", !expenseDate && "text-muted-foreground")}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {expenseDate ? format(expenseDate, "PPP") : "Pick a date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={expenseDate}
                          onSelect={(d) => { if (d) { setExpenseDate(d); setDateOpen(false); } }}
                          initialFocus
                          className={cn("p-3 pointer-events-auto")}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Input value={description} onChange={(e) => setDescription(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Amount (KES)</Label>
                    <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Category (optional)</Label>
                    <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Repairs, Salaries" />
                  </div>
                  <Button type="submit" className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
                    {editingId ? "Save Changes" : "Add Expense"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="p-4">Date</th>
                  <th className="p-4">Description</th>
                  <th className="p-4">Category</th>
                  <th className="p-4 text-right">Amount</th>
                  <th className="p-4 text-muted-foreground">Last Modified</th>
                  {canEdit && <th className="p-4 text-right w-24">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="p-4 text-muted-foreground">{format(new Date(e.date), "MMM d, yyyy")}</td>
                    <td className="p-4 font-medium">{e.description}</td>
                    <td className="p-4 text-muted-foreground">{e.category || "—"}</td>
                    <td className="p-4 text-right font-mono font-semibold">KES {Number(e.amount).toLocaleString()}</td>
                    <td className="p-4 text-xs text-muted-foreground">
                      {e.last_modified_by ? (
                        <>
                          <div className="font-medium text-foreground">{modifierNames[e.last_modified_by] ?? "…"}</div>
                          {e.last_modified_at && <div>{format(new Date(e.last_modified_at), "MMM d, HH:mm")}</div>}
                        </>
                      ) : "—"}
                    </td>
                    {canEdit && (
                      <td className="p-4 text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(e)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(e)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {expenses.length === 0 && <p className="text-center text-muted-foreground py-8">No expenses recorded</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
