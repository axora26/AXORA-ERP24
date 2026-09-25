import React from "react";
import Link from "next/link";
import { Brand } from "../components/brand";

/** Page servie par le service worker quand une page jamais visitee est demandee hors ligne. */
export default function OfflinePage(): React.ReactElement {
  return (
    <main className="loading-screen offline-screen">
      <Brand />
      <h1>Vous êtes hors ligne</h1>
      <p>Cette page n&apos;a pas encore été ouverte sur cet appareil : elle sera disponible dès le retour du réseau. Seul le module Chantier conserve sur cet appareil sa dernière consultation et sa file de saisies, synchronisées au retour du réseau et effacées à la déconnexion.</p>
      <div className="offline-actions">
        <Link className="primary-inline-button" href="/field">
          Ouvrir le chantier (saisies hors ligne)
        </Link>
        <Link className="secondary-button" href="/">
          Réessayer
        </Link>
      </div>
    </main>
  );
}
