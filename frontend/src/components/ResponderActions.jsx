import { useState } from "react";
import { CheckCircle2, FileText, ShieldX } from "lucide-react";

export default function ResponderActions({ report, onVerify, onReject, onResolve, onNote }) {
  const [note, setNote] = useState(report.responderNote || "");

  async function saveNote() {
    await onNote(report.report_id, note);
  }

  return (
    <div className="responder-actions">
      <button className="secondary" onClick={() => onVerify(report.report_id)}>
        <CheckCircle2 size={16} /> Verify
      </button>
      <button className="secondary danger" onClick={() => onReject(report.report_id)}>
        <ShieldX size={16} /> Reject
      </button>
      <button className="secondary danger" onClick={() => onResolve(report.report_id)} disabled={report.status === "Resolved"}>
        Resolve
      </button>
      <label>
        Responder note
        <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} />
      </label>
      <button className="secondary" onClick={saveNote}>
        <FileText size={16} /> Save Note
      </button>
    </div>
  );
}
