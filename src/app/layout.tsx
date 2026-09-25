import type { Metadata } from "next";
import DemoLayout from "../components/DemoLayout";
import "../styles.css";
import "./dashboard.css";
import "./canvas.css";

export const metadata: Metadata = {
  title: "GPU VTEC — Adaptive kernel intelligence",
  description:
    "An interactive, mock-data demonstration of hardware-aware kernel selection.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <DemoLayout>{children}</DemoLayout>
      </body>
    </html>
  );
}
