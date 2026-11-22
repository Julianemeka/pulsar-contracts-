import React from "react";
import { createRoot } from "react-dom/client";
import { PayerDashboard } from "./components/PayerDashboard";
import { MerchantAnalytics } from "./components/MerchantAnalytics";

function App() {
  const [view, setView] = React.useState<"payer" | "merchant">("payer");

  return (
    <div>
      <nav style={{ display: "flex", gap: "0.5rem", padding: "0.75rem" }}>
        <button
          type="button"
          onClick={() => setView("payer")}
          aria-pressed={view === "payer"}
        >
          Payer Dashboard
        </button>
        <button
          type="button"
          onClick={() => setView("merchant")}
          aria-pressed={view === "merchant"}
        >
          Merchant Analytics
        </button>
      </nav>
      {view === "payer" ? <PayerDashboard /> : <MerchantAnalytics />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);