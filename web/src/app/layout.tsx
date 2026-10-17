import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { AppStateProvider } from "@/components/AppState";
import { Nav } from "@/components/Nav";
import "./globals.css";

const sans = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const mono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Lore",
  description: "The company brain that shows up to your incidents — on FalkorDB",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} dark`}>
      <body className="flex h-dvh flex-col bg-canvas font-sans text-zinc-200 antialiased">
        <AppStateProvider>
          <Nav />
          <main className="min-h-0 flex-1">{children}</main>
        </AppStateProvider>
      </body>
    </html>
  );
}
