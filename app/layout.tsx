import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Brighter Future",
  description: "A personal workspace for your money.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
