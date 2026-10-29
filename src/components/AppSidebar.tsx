import { LayoutDashboard, ShoppingCart, DollarSign, LogOut, BarChart3, Users, Building2, Fuel, Sun, Moon, Gauge, Droplet, Scale, Wallet } from "lucide-react";
import { useAuth, type PageKey } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { useProfileName } from "@/hooks/useProfileName";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import logo from "@/assets/logo.png";

type NavItem = { to: string; icon: any; label: string; page: PageKey };

const allNavItems: NavItem[] = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard", page: "dashboard" },
  { to: "/sales", icon: ShoppingCart, label: "Sales", page: "sales" },
  { to: "/pumps", icon: Gauge, label: "Pumps", page: "pumps" },
  { to: "/tanks", icon: Droplet, label: "Tanks", page: "tanks" },
  { to: "/fuel", icon: Fuel, label: "Fuel", page: "fuel" },
  { to: "/expenses", icon: DollarSign, label: "Expenses", page: "expenses" },
  { to: "/reports", icon: BarChart3, label: "Reports", page: "reports" },
  { to: "/reconciliation", icon: Scale, label: "Reconciliation", page: "reconciliation" },
  { to: "/branches", icon: Building2, label: "Branches", page: "branches" },
  { to: "/users", icon: Users, label: "Users", page: "users" },
  { to: "/payroll", icon: Wallet, label: "Payroll", page: "payroll" },
  
];

export default function AppSidebar() {
  const { signOut, user, hasRole, canAccessPage } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const profileName = useProfileName();
  const location = useLocation();

  const navItems = allNavItems.filter((i) => canAccessPage(i.page));

  const roleLabel = hasRole("admin") ? "Admin" : hasRole("manager") ? "Manager" : hasRole("attendant") ? "Attendant" : "";

  return (
    <aside className="hidden md:flex w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border h-screen overflow-hidden">
      <div className="flex flex-col items-center gap-2 px-6 py-5 border-b border-sidebar-border shrink-0">
        <img src={logo} alt="Fuel Flow Pro" className="h-20 w-auto" />
        <p className="text-xs text-sidebar-foreground/60 tracking-wider">CONVENIENCE AT FINGERTIPS</p>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              location.pathname === item.to
                ? "bg-sidebar-accent text-sidebar-primary"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="px-3 py-4 border-t border-sidebar-border space-y-2 shrink-0">
        <button
          onClick={toggleTheme}
          className="flex items-center justify-between w-full px-3 py-2 rounded-lg text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent transition-colors"
          aria-label="Toggle theme"
        >
          <span className="flex items-center gap-3">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </span>
          <span className="text-xs text-sidebar-foreground/50">{theme === "dark" ? "☼" : "☾"}</span>
        </button>

        <div className="px-3 py-2 rounded-lg bg-sidebar-accent/40">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-sidebar-primary/20 text-sidebar-primary flex items-center justify-center text-xs font-bold">
              {(profileName || user?.email || "?").charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-sidebar-foreground truncate">{profileName || user?.email}</p>
              {roleLabel && <p className="text-[10px] uppercase tracking-wider text-sidebar-foreground/50">{roleLabel}</p>}
            </div>
          </div>
        </div>

        <button
          onClick={signOut}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-destructive transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
