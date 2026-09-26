"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";
import OrbLogo from "./OrbLogo";

const NAV = [
  { href: "/", label: "Get started" },
  { href: "/tuners", label: "Tuners" },
];

export default function Header() {
  const pathname = usePathname();
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header className="relative z-10 border-b border-border/60">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-6 px-4 md:px-8">
        <Link href="/" className="flex items-center gap-2.5 text-foreground hover:text-foreground">
          <OrbLogo size={28} />
          <span className="text-sm font-semibold tracking-[0.08em]">VTEC</span>
        </Link>
        <nav className="flex items-center gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active(item.href) ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                active(item.href)
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
