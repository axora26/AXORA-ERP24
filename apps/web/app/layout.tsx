import type { Metadata, Viewport } from "next";
// Polices auto-hebergees (aucune requete vers un CDN tiers, fonctionne hors ligne).
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/montserrat/600.css";
import "@fontsource/montserrat/700.css";
import "@fontsource/montserrat/800.css";
import "./globals.css";
import { ServiceWorkerRegister } from "./components/sw-register";

export const metadata: Metadata = {
  title: "AXORA-ERP24",
  description: "Plateforme entreprise integree AXORA-ERP24",
  manifest: "/manifest.json",
  icons: { apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "AXORA", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#1E3A8A",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html lang="fr">
      <body>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
