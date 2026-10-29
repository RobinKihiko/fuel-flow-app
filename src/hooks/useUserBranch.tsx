import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface UserBranch { id: string; name: string }

export function useUserBranches(): UserBranch[] {
  const { user } = useAuth();
  const [branches, setBranches] = useState<UserBranch[]>([]);

  useEffect(() => {
    if (!user) { setBranches([]); return; }
    (async () => {
      const { data } = await supabase
        .from("branch_attendants")
        .select("branch_id, branches(id, name)")
        .eq("user_id", user.id);
      const list: UserBranch[] = ((data as any[]) ?? [])
        .map((r) => r.branches)
        .filter(Boolean);
      setBranches(list);
    })();
  }, [user]);

  return branches;
}
