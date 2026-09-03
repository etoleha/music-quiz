import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Не по припеву",
  description: "Личная коллекция музыкальных квизов со статистикой",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
