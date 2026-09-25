"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const pages = [
  { href: "/", label: "Registry" },
  { href: "/projects/new", label: "New project" },
];

export default function DashboardNav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <nav className="console-nav" aria-label="Dashboard pages">
      {pages.map((page) => (
        <Link
          key={page.href}
          href={page.href}
          aria-current={isActive(page.href) ? "page" : undefined}
          className={isActive(page.href) ? "nav-active" : ""}
        >
          {page.label}
        </Link>
      ))}
      <span className="nav-divider" />
      <span className="nav-system-status">
        <span className="online-dot" /> System online
      </span>
    </nav>
  );
}
