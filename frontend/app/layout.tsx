import type { Metadata } from "next";

import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Riverline, a six-seat Hold’em hand lab",
  description: "Play one six-player no-limit Hold'em hand for every seat; the server settles the pots and keeps the history",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

