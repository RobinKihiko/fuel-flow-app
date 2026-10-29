import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Resolves a list of user_ids to their display names from the profiles table.
 * Returns a map of user_id -> full_name (falls back to "Unknown" if missing).
 */
export function useModifierNames(userIds: (string | null | undefined)[]) {
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    const ids = Array.from(new Set(userIds.filter((x): x is string => !!x)));
    if (ids.length === 0) {
      setNames({});
      return;
    }
    supabase
      .from("profiles")
      .select("user_id, full_name")
      .in("user_id", ids)
      .then(({ data }) => {
        const map: Record<string, string> = {};
        (data ?? []).forEach((p: any) => {
          map[p.user_id] = p.full_name || "Unnamed";
        });
        setNames(map);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userIds.join("|")]);

  return names;
}
