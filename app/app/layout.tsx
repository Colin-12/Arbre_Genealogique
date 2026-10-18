import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Arbre généalogique",
  description: "Arbre généalogique collaboratif et privé",
  // Appli familiale : on ne veut pas qu'elle apparaisse dans les moteurs de recherche
  robots: { index: false, follow: false },
  // iPhone : ouverture en plein écran depuis l'écran d'accueil
  appleWebApp: { capable: true, title: "Arbre", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#1f5f7a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
