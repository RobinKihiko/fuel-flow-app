import { ReactNode } from "react";
import AppSidebar from "./AppSidebar";
import MobileNav from "./MobileNav";
import SyncStatusIndicator from "./SyncStatusIndicator";
import { Button } from "@/components/ui/button";
import { LogOut, Sun, Moon } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { useProfileName } from "@/hooks/useProfileName";
import { useUserBranches } from "@/hooks/useUserBranch";
import { Building2 } from "lucide-react";
import logo from "@/assets/logo.png";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { signOut, user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const profileName = useProfileName();
  const branches = useUserBranches();
  const branchLabel = branches.map((b) => b.name).join(", ");
  const displayName = profileName || user?.email?.split("@")[0] || "";

  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile header */}
        <header className="md:hidden flex items-center justify-between border-b border-border bg-card px-3 py-2 gap-2">
          <img src={logo} alt="Fuel Flow Pro" className="h-9 w-auto shrink-0" />
          <div className="flex-1 min-w-0 text-center">
            <p className="text-xs font-semibold truncate">{displayName}</p>
            {branchLabel && (
              <p className="text-[10px] text-muted-foreground truncate flex items-center justify-center gap-1">
                <Building2 className="h-2.5 w-2.5" />{branchLabel}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <SyncStatusIndicator compact />
            <Button size="icon" variant="ghost" onClick={toggleTheme} className="h-8 w-8" aria-label="Toggle theme">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={signOut}
              className="h-8 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {/* Desktop top bar with user name */}
        <header className="hidden md:flex items-center justify-end border-b border-border bg-card px-6 py-2 gap-3">
          <SyncStatusIndicator />
          {branchLabel && (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-accent/10 text-accent font-medium">
              <Building2 className="h-3 w-3" /> {branchLabel}
            </span>
          )}
          <span className="text-sm text-muted-foreground">Signed in as</span>
          <span className="text-sm font-semibold">{displayName}</span>
        </header>

        <main className="flex-1 overflow-y-auto pb-24 md:pb-0">
          {children}
        </main>
      </div>
      <MobileNav />
    </div>
  );
}
