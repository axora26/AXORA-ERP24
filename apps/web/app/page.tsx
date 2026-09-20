/**
 * Command Center — shell applicatif minimal (INC-00).
 * Reference : docs/foundation/04-ux-design-system.md.
 * Statut reel : FOUNDATION — aucune donnee metier connectee a ce stade.
 */
export default function HomePage(): React.ReactElement {
  return (
    <main style={{ padding: "2rem" }}>
      <h1 style={{ color: "var(--axora-brand-900)" }}>AXORA-ERP24</h1>
      <p>
        Command Center — socle applicatif. Statut module Core :{" "}
        <strong>FOUNDATION</strong> (voir <code>docs/MODULE_STATUS.md</code>).
      </p>
    </main>
  );
}
