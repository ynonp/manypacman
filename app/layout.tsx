import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "manypac. — One maze. Many Pacs.",
  description: "A classic, with company. Join a shared multiplayer Pac-Man maze, team up with friends, and clear every dot together. No sign-up. Just show up.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
