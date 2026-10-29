import { ShoppingCart, DollarSign, LayoutDashboard, Fuel, Building2, Gauge, Droplet, BarChart3, Scale, Users, Wallet } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth, type PageKey } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

type NavItem = { to: string; icon: any; label: string; page: PageKey };

const allNavItems: NavItem[] = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard", page: "dashboard" },
  { to: "/sales", icon: ShoppingCart, label: "Sales", page: "sales" },
  { to: "/pumps", icon: Gauge, label: "Pumps", page: "pumps" },
  { to: "/tanks", icon: Droplet, label: "Tanks", page: "tanks" },
  { to: "/fuel", icon: Fuel, label: "Fuel", page: "fuel" },
  { to: "/expenses", icon: DollarSign, label: "Costs", page: "expenses" },
  { to: "/reports", icon: BarChart3, label: "Reports", page: "reports" },
  { to: "/reconciliation", icon: Scale, label: "Recon", page: "reconciliation" },
  { to: "/branches", icon: Building2, label: "Branches", page: "branches" },
  { to: "/users", icon: Users, label: "Users", page: "users" },
  { to: "/payroll", icon: Wallet, label: "Payroll", page: "payroll" },
  
];

export default function MobileNav() {
  const location = useLocation();
  const { canAccessPage } = useAuth();

  const navItems = allNavItems.filter((i) => canAccessPage(i.page));

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border">
      <div className="flex gap-0 overflow-x-auto py-2 px-1 scrollbar-thin">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={cn(
              "flex flex-col items-center gap-0.5 px-2.5 py-1 text-[10px] rounded-lg transition-colors shrink-0 min-w-[56px]",
              location.pathname === item.to ? "text-accent bg-accent/10" : "text-muted-foreground"
            )}
          >
            <item.icon className="h-5 w-5" />
            <span className="leading-tight">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
