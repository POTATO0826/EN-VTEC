import type { Metadata } from "next";
import AppProviders from "@/components/providers/AppProviders";
import Background from "@/components/shell/Background";
import Header from "@/components/shell/Header";
import "./globals.css";

export const metadata: Metadata = {
  title: "Opti-om",
  description: "Tuned local agents for Web3 workloads, verified by real humans and settled on Sui.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;800&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen">
        <AppProviders>
          <Background />
          <div className="relative z-[2] flex min-h-screen flex-col">
            <Header />
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 md:px-8 md:py-14">
              {children}
            </main>
          </div>
        </AppProviders>
      </body>
    </html>
  );
}
