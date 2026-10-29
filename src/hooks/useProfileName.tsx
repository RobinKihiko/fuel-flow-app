import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function useProfileName(): string {
  const { user } = useAuth();
  const [name, setName] = useState<string>("");

  useEffect(() => {
    if (!user) {
      setName("");
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("user_id", user.id)
        .maybeSingle();
      setName(data?.full_name || user.email?.split("@")[0] || "");
    })();
  }, [user]);

  return name;
}
