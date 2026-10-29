import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Building2 } from "lucide-react";

export default function BranchBadge() {
  const { user, hasRole } = useAuth();
  const [name, setName] = useState<string | null>(null);

  const isAttendantOnly = hasRole("attendant") && !hasRole("admin") && !hasRole("manager");

  useEffect(() => {
    if (!user || !isAttendantOnly) return;
    (async () => {
      const { data } = await supabase
        .from("branch_attendants")
        .select("branches(name)")
        .eq("user_id", user.id)
        .maybeSingle();
      const branchName = (data as any)?.branches?.name;
      if (branchName) setName(branchName);
    })();
  }, [user, isAttendantOnly]);

  if (!isAttendantOnly || !name) return null;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 text-accent-foreground border border-accent/40 px-3 py-1 text-xs font-semibold">
      <Building2 className="h-3.5 w-3.5 text-accent" />
      {name}
    </span>
  );
}
