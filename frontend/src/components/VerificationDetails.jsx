import EvidenceList from "./EvidenceList";
import WarningList from "./WarningList";

export default function VerificationDetails({ report }) {
  return (
    <div className="verification-details">
      <EvidenceList reasons={report.evidenceReasons} />
      <WarningList reasons={report.warningReasons} />
    </div>
  );
}
