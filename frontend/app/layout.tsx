import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Riverline — Hold’em Hand Lab",
  description: "A six-player Texas Hold'em hand simulator",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

