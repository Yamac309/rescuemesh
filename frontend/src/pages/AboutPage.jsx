export default function AboutPage() {
  return (
    <div className="page-grid">
      <section className="section-header">
        <div>
          <p className="eyebrow">How it works</p>
          <h1>About RescueMesh</h1>
        </div>
      </section>
      <section className="info-panel">
        <h2>Offline-first by default</h2>
        <p>
          Every report is created with a device ID and globally unique report ID before it ever reaches a server. The browser stores reports in IndexedDB, so refreshes,
          weak internet, and temporary outages do not erase field notes.
        </p>
      </section>
      <section className="info-panel">
        <h2>LAN sync for the MVP</h2>
        <p>
          Clients exchange known report IDs with the FastAPI node. The node returns missing reports, accepts reports it has not seen, and broadcasts updates over WebSockets.
          This simulates mesh-style movement of information without requiring Bluetooth, LoRa, or special hardware yet.
        </p>
      </section>
      <section className="info-panel">
        <h2>Future transport hooks</h2>
        <p>
          Clean TODOs are left in the backend WebSocket stream and frontend map setup where Bluetooth, Wi-Fi Direct, Raspberry Pi relay nodes, LoRa radios, and offline tile
          packs can be added later.
        </p>
      </section>
      <section className="info-panel">
        <h2>Trust and freshness</h2>
        <p>
          Emergency information gets old quickly, so RescueMesh marks reports as Fresh, Recent, Aging, or Stale based on age. Each report also shows a confidence score
          derived from confirmations, report age, resolved status, and similar nearby reports from other devices.
        </p>
      </section>
      <section className="info-panel">
        <h2>Privacy model</h2>
        <ul className="plain-list">
          <li>No real names are required.</li>
          <li>Each browser uses an anonymous device ID instead of a personal profile.</li>
          <li>Location is attached only to the report being created; the app does not continuously track users.</li>
          <li>Reports can be exported as JSON or CSV for incident handoff.</li>
          <li>Trusted or responder workflows should not expose private user data.</li>
        </ul>
      </section>
      <section className="info-panel">
        <h2>Category guidance</h2>
        <p>
          Report cards include simple safety guidance for each category, such as avoiding blocked roads, checking report age before relying on water or food locations, and
          calling emergency services for life-threatening first aid situations when possible.
        </p>
      </section>
    </div>
  );
}
