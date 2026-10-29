import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { History, FileDown, FileSpreadsheet } from "lucide-react";
import { format } from "date-fns";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import ExcelJS from "exceljs";


interface AuditEntry {
  id: string;
  table_name: string;
  record_id: string | null;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  context: any;
  user_id: string | null;
  created_at: string;
}

interface Props {
  tables: string[];
  branchId?: string;
  fieldsOnly?: string[];
  title?: string;
  limit?: number;
}

export default function AuditTrailPanel({ tables, branchId, fieldsOnly, title = "Audit Trail", limit = 100 }: Props) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});

  // Filters
  const [productFilter, setProductFilter] = useState("");
  const [fieldFilter, setFieldFilter] = useState<string>("all");
  const [userFilter, setUserFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("audit_log")
        .select("*")
        .in("table_name", tables)
        .order("created_at", { ascending: false })
        .limit(500);
      let rows = ((data as AuditEntry[]) ?? []);
      if (branchId) rows = rows.filter((r) => (r.context as any)?.branch_id === branchId);
      if (fieldsOnly?.length) rows = rows.filter((r) => !r.field || fieldsOnly.includes(r.field));
      setEntries(rows);

      const ids = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean))) as string[];
      if (ids.length) {
        const { data: nm } = await supabase.rpc("get_profile_names", { _ids: ids });
        setNames(Object.fromEntries((nm ?? []).map((n: any) => [n.user_id, n.full_name])));
      }
    };
    load();
  }, [tables.join(","), branchId, fieldsOnly?.join(",")]);

  const productNameOf = (e: AuditEntry) =>
    (e.context?.name || e.context?.fuel_name || e.context?.supplier || "") as string;

  const availableFields = useMemo(() => {
    const s = new Set<string>();
    entries.forEach((e) => e.field && s.add(e.field));
    return Array.from(s).sort();
  }, [entries]);

  const availableUsers = useMemo(() => {
    const s = new Set<string>();
    entries.forEach((e) => e.user_id && s.add(e.user_id));
    return Array.from(s);
  }, [entries]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (productFilter && !productNameOf(e).toLowerCase().includes(productFilter.toLowerCase())) return false;
      if (fieldFilter !== "all" && e.field !== fieldFilter) return false;
      if (userFilter !== "all" && e.user_id !== userFilter) return false;
      if (fromDate && new Date(e.created_at) < new Date(fromDate)) return false;
      if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        if (new Date(e.created_at) > end) return false;
      }
      return true;
    }).slice(0, limit);
  }, [entries, productFilter, fieldFilter, userFilter, fromDate, toDate, limit]);

  const labelFor = (e: AuditEntry) => {
    const t = e.table_name === "branch_fuel_types" ? "Fuel product" : e.table_name === "tanks" ? "Tank" : e.table_name === "fuel_deliveries" ? "Delivery" : e.table_name;
    const ctxName = productNameOf(e);
    return `${t}${ctxName ? ` · ${ctxName}` : ""}`;
  };

  const buildRows = () =>
    filtered.map((e) => ({
      When: format(new Date(e.created_at), "yyyy-MM-dd HH:mm"),
      Who: e.user_id ? (names[e.user_id] ?? "—") : "System",
      Item: labelFor(e),
      Action: e.action,
      Field: e.field ?? "—",
      Before: e.old_value ?? "—",
      After: e.new_value ?? "—",
    }));

  const exportExcel = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Audit Trail");
    const rows = buildRows();
    const headers = ["When", "Who", "Item", "Action", "Field", "Before", "After"];
    ws.columns = headers.map((h) => ({ header: h, key: h, width: 22 }));
    rows.forEach((r) => ws.addRow(r));
    ws.getRow(1).font = { bold: true };
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `audit-trail-${format(new Date(), "yyyyMMdd-HHmm")}.xlsx`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    doc.text(title, 14, 14);
    doc.setFontSize(9);
    const parts: string[] = [];
    if (productFilter) parts.push(`Product: ${productFilter}`);
    if (fieldFilter !== "all") parts.push(`Field: ${fieldFilter}`);
    if (userFilter !== "all") parts.push(`User: ${names[userFilter] ?? userFilter}`);
    if (fromDate) parts.push(`From: ${fromDate}`);
    if (toDate) parts.push(`To: ${toDate}`);
    doc.text(parts.length ? parts.join("  ·  ") : "All entries", 14, 20);
    const rows = buildRows();
    autoTable(doc, {
      startY: 26,
      head: [["When", "Who", "Item", "Action", "Field", "Before", "After"]],
      body: rows.map((r) => [r.When, r.Who, r.Item, r.Action, r.Field, r.Before, r.After]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 41, 59] },
    });
    doc.save(`audit-trail-${format(new Date(), "yyyyMMdd-HHmm")}.pdf`);
  };

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 flex-wrap">
        <CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4" /> {title}</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={exportExcel} disabled={filtered.length === 0}>
            <FileSpreadsheet className="h-4 w-4 mr-1" /> Excel
          </Button>
          <Button size="sm" variant="outline" onClick={exportPdf} disabled={filtered.length === 0}>
            <FileDown className="h-4 w-4 mr-1" /> PDF
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Fuel product</Label>
            <Input placeholder="Search…" value={productFilter} onChange={(e) => setProductFilter(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Field</Label>
            <Select value={fieldFilter} onValueChange={setFieldFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All fields</SelectItem>
                {availableFields.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">User</Label>
            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All users</SelectItem>
                {availableUsers.map((u) => <SelectItem key={u} value={u}>{names[u] ?? u.slice(0, 8)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No audit entries match your filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Who</th>
                  <th className="py-2 pr-3">Item</th>
                  <th className="py-2 pr-3">Action</th>
                  <th className="py-2 pr-3">Field</th>
                  <th className="py-2 pr-3">Before</th>
                  <th className="py-2">After</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 text-muted-foreground text-xs whitespace-nowrap">{format(new Date(e.created_at), "MMM d, HH:mm")}</td>
                    <td className="py-2 pr-3 text-xs">{e.user_id ? (names[e.user_id] ?? "—") : "System"}</td>
                    <td className="py-2 pr-3">{labelFor(e)}</td>
                    <td className="py-2 pr-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${e.action === "DELETE" ? "bg-destructive/10 text-destructive" : e.action === "INSERT" ? "bg-success/10 text-success" : "bg-accent/10 text-accent"}`}>
                        {e.action}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-xs">{e.field ?? "—"}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{e.old_value ?? "—"}</td>
                    <td className="py-2 font-mono text-xs">{e.new_value ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
