export default function WarningList({ reasons = [] }) {
  if (!reasons.length) return null;
  return (
    <div className="reason-list warning-list">
      <strong>Warnings</strong>
      {reasons.map((reason) => (
        <p key={reason}>! {reason}</p>
      ))}
    </div>
  );
}
