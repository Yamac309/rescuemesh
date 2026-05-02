export default function EvidenceList({ reasons = [] }) {
  if (!reasons.length) return null;
  return (
    <div className="reason-list evidence-list">
      <strong>Evidence</strong>
      {reasons.map((reason) => (
        <p key={reason}>✓ {reason}</p>
      ))}
    </div>
  );
}
