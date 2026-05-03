import { MessageCircle, Send } from "lucide-react";
import { useState } from "react";

export default function ReportComments({ report, comments = [], deviceId, onAddComment }) {
  const [body, setBody] = useState("");
  const [isSending, setIsSending] = useState(false);
  const sortedComments = [...comments].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  async function submitComment(event) {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;

    setIsSending(true);
    try {
      await onAddComment(report.report_id, trimmed);
      setBody("");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <section className="comments-panel">
      <div className="comments-title">
        <MessageCircle size={16} /> Comments
        <span>{sortedComments.length}</span>
      </div>
      <div className="comments-list">
        {sortedComments.map((comment) => (
          <article className="comment-item" key={comment.comment_id}>
            <p>{comment.body}</p>
            <span>
              {comment.device_id === deviceId ? "You" : "Anonymous device"} · {new Date(comment.timestamp).toLocaleString()}
            </span>
          </article>
        ))}
        {!sortedComments.length && <p className="comments-empty">No comments yet.</p>}
      </div>
      <form className="comment-form" onSubmit={submitComment}>
        <input
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Add a quick update or context..."
          maxLength={1000}
        />
        <button type="submit" className="secondary" disabled={!body.trim() || isSending}>
          <Send size={16} /> Comment
        </button>
      </form>
    </section>
  );
}
