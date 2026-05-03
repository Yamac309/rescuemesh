import { ImagePlus, MessageCircle, Send, X } from "lucide-react";
import { useState } from "react";

export default function ReportComments({ report, comments = [], deviceId, onAddComment }) {
  const [body, setBody] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [isSending, setIsSending] = useState(false);

  const sortedComments = [...comments].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );

  function readImageFile(file) {
    if (!file.type.startsWith("image/")) return;
    if (file.size > 1_500_000) {
      window.alert("Image too large for comment paste. Use an image under 1.5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImageDataUrl(String(reader.result || ""));
    reader.readAsDataURL(file);
  }

  function handlePaste(event) {
    const imageItem = [...event.clipboardData.items].find((item) =>
      item.type.startsWith("image/")
    );
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    event.preventDefault();
    readImageFile(file);
  }

  async function submitComment(event) {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed && !imageDataUrl) return;
    setIsSending(true);
    try {
      await onAddComment(report.report_id, trimmed, imageDataUrl);
      setBody("");
      setImageDataUrl("");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <section className="comments-panel">
      <div className="comments-title">
        <MessageCircle size={14} />
        Comments
        <span>{sortedComments.length}</span>
      </div>

      <div className="comments-list">
        {sortedComments.map((comment) => (
          <article className="comment-item" key={comment.comment_id}>
            {comment.body && <p>{comment.body}</p>}
            {comment.image_data_url && (
              <img
                className="comment-image"
                src={comment.image_data_url}
                alt="Evidence attached to comment"
              />
            )}
            <span>
              {comment.device_id === deviceId ? "You" : "Anonymous device"} ·{" "}
              {new Date(comment.timestamp).toLocaleString()}
            </span>
          </article>
        ))}
        {!sortedComments.length && (
          <p className="comments-empty">No comments yet.</p>
        )}
      </div>

      <form className="comment-form" onSubmit={submitComment}>
        {imageDataUrl && (
          <div className="comment-image-preview">
            <img src={imageDataUrl} alt="Pasted comment preview" />
            <button
              type="button"
              className="icon-button small"
              onClick={() => setImageDataUrl("")}
              title="Remove image"
            >
              <X size={14} />
            </button>
          </div>
        )}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onPaste={handlePaste}
          placeholder="Add an update or paste an image..."
          maxLength={1000}
          rows={2}
        />
        <div className="comment-form-actions">
          <span>
            <ImagePlus size={13} /> Paste image to attach
          </span>
          <button
            type="submit"
            className="secondary"
            disabled={(!body.trim() && !imageDataUrl) || isSending}
          >
            <Send size={14} /> {isSending ? "Sending..." : "Send"}
          </button>
        </div>
      </form>
    </section>
  );
}
