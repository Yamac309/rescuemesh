import { KeyRound, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { getSecurityConfig, getSecurityTokens, saveSecurityTokens } from "../api/client";

export default function SecurityAccessPanel() {
  const [config, setConfig] = useState(null);
  const [tokens, setTokens] = useState(() => getSecurityTokens());
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSecurityConfig()
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  function updateToken(field, value) {
    setSaved(false);
    setTokens((current) => ({ ...current, [field]: value }));
  }

  function saveTokens(event) {
    event.preventDefault();
    saveSecurityTokens(tokens);
    setSaved(true);
  }

  return (
    <section className="security-panel">
      <div className="security-panel-header">
        <ShieldCheck size={20} />
        <div>
          <p className="eyebrow">Access Control</p>
          <h2>Security Tokens</h2>
        </div>
      </div>
      <p>
        Admin and responder routes can require shared tokens from the backend environment. Tokens stay in this browser and are sent as request headers.
      </p>
      {config && (
        <div className="security-status-row">
          <span>{config.adminTokenRequired ? "Admin token required" : "Admin token optional locally"}</span>
          <span>{config.responderTokenRequired ? "Responder token required" : "Responder token optional locally"}</span>
          <span>{config.rateLimitingEnabled ? "Rate limiting on" : "Rate limiting off"}</span>
          <span>{config.httpsRequired ? "HTTPS required" : "HTTPS optional locally"}</span>
        </div>
      )}
      <form className="security-token-form" onSubmit={saveTokens}>
        <label>
          Admin token
          <input
            type="password"
            value={tokens.adminToken}
            onChange={(event) => updateToken("adminToken", event.target.value)}
            placeholder="Required for clearing reports when configured"
            autoComplete="off"
          />
        </label>
        <label>
          Responder token
          <input
            type="password"
            value={tokens.responderToken}
            onChange={(event) => updateToken("responderToken", event.target.value)}
            placeholder="Required for responder review when configured"
            autoComplete="off"
          />
        </label>
        <button type="submit" className="secondary">
          <KeyRound size={15} /> Save Tokens
        </button>
      </form>
      {saved && <p className="security-save-note">Tokens saved locally for this browser.</p>}
    </section>
  );
}
