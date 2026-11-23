import type { Metadata } from "next";
import { VaultProvider } from "@/components/auth/vault-provider";
import { LogoFilter } from "@/components/ovi-logo";
import "./globals.css";

export const metadata: Metadata = {
  title: "Talk to OVI",
  description: "A quiet space to talk to OVI.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><LogoFilter /><VaultProvider>{children}</VaultProvider></body></html>;
}
