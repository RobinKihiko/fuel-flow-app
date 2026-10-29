import { useState, useEffect, createContext, useContext, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

export type PageKey =
  | "dashboard" | "sales" | "pumps" | "tanks" | "fuel"
  | "expenses" | "reports" | "reconciliation" | "branches"
  | "users" | "payroll";


interface AuthContextType {
  session: Session | null;
  user: User | null;
  roles: AppRole[];
  pagePermissions: PageKey[];
  mustChangePassword: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string) => Promise<void>;
  signOut: () => Promise<void>;
  hasRole: (role: AppRole) => boolean;
  canAccessPage: (page: PageKey) => boolean;
  refreshPermissions: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Default page access derived from roles (admin/manager get everything, attendant baseline)
const ROLE_DEFAULT_PAGES: Record<AppRole, PageKey[]> = {
  admin: ["dashboard","sales","pumps","tanks","fuel","expenses","reports","reconciliation","branches","users","payroll"],
  manager: ["dashboard","sales","pumps","tanks","fuel","expenses","reports","reconciliation","branches","payroll"],
  attendant: ["sales","pumps","fuel","expenses"],
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [pagePermissions, setPagePermissions] = useState<PageKey[]>([]);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchRolesAndPerms = async (userId: string) => {
    const [{ data: r }, { data: p }, { data: prof }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("user_page_permissions").select("page_key").eq("user_id", userId),
      supabase.from("profiles").select("must_change_password").eq("user_id", userId).maybeSingle(),
    ]);
    setRoles(r ? r.map((x) => x.role) : []);
    setPagePermissions(p ? (p.map((x: any) => x.page_key) as PageKey[]) : []);
    setMustChangePassword(!!prof?.must_change_password);
  };

  useEffect(() => {
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (!active) return;
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          setTimeout(async () => {
            await fetchRolesAndPerms(session.user.id);
            if (active) setLoading(false);
          }, 0);
        } else {
          setRoles([]);
          setPagePermissions([]);
          setLoading(false);
        }
      }
    );

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!active) return;
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) await fetchRolesAndPerms(session.user.id);
      if (active) setLoading(false);
    });

    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  // Live-refresh a user's own permissions when admin grants change
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`perm-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_page_permissions", filter: `user_id=eq.${user.id}` },
        () => fetchRolesAndPerms(user.id))
      .on("postgres_changes", { event: "*", schema: "public", table: "user_roles", filter: `user_id=eq.${user.id}` },
        () => fetchRolesAndPerms(user.id))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) throw error;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const hasRole = (role: AppRole) => roles.includes(role);

  const canAccessPage = (page: PageKey) => {
    if (pagePermissions.includes(page)) return true;
    return roles.some((r) => ROLE_DEFAULT_PAGES[r]?.includes(page));
  };

  const refreshPermissions = async () => {
    if (user?.id) await fetchRolesAndPerms(user.id);
  };
  const refreshProfile = refreshPermissions;

  return (
    <AuthContext.Provider value={{ session, user, roles, pagePermissions, mustChangePassword, loading, signIn, signUp, signOut, hasRole, canAccessPage, refreshPermissions, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}

export const ALL_PAGE_KEYS: PageKey[] = [
  "dashboard","sales","pumps","tanks","fuel","expenses","reports","reconciliation","branches","users","payroll",
];

export const PAGE_LABELS: Record<PageKey, string> = {
  dashboard: "Dashboard",
  sales: "Sales",
  pumps: "Pumps",
  tanks: "Tanks",
  fuel: "Fuel Management",
  expenses: "Expenses",
  reports: "Reports",
  reconciliation: "Reconciliation",
  branches: "Branches",
  users: "Users",
  payroll: "Payroll",
};
