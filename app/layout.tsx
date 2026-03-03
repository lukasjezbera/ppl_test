import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PPL Quiz Trainer",
  description: "Příprava na zkoušku PPL — ÚCL ČR",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="cs">
      <body
        className={`${geistSans.variable} antialiased bg-primary text-white min-h-screen font-sans`}
      >
        {children}
      </body>
    </html>
  );
}
