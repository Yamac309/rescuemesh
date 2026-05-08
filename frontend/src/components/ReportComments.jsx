import { ImagePlus, MessageCircle, Send, X } from "lucide-react";
import { useRef, useState } from "react";

const MAX_IMAGE_FILE_BYTES = 8_000_000;
const MAX_IMAGE_SIDE = 1400;
const IMAGE_QUALITY = 0.82;

export default function ReportComments({ report, comments = [], deviceId, onAddComment }) {
  const [body, setBody] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [attachmentMessage, setAttachmentMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const fileInputRef = useRef(null);

  const sortedComments = [...comments].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function compressImage(dataUrl) {
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", IMAGE_QUALITY));
      };
      image.onerror = () => resolve(dataUrl);
      image.src = dataUrl;
    });
  }

  async function attachImageFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > MAX_IMAGE_FILE_BYTES) {
      setAttachmentMessage("Image is too large. Use an image under 8 MB.");
      return;
    }

    try {
      setAttachmentMessage("Preparing image...");
      const rawDataUrl = await fileToDataUrl(file);
      const nextDataUrl = await compressImage(rawDataUrl);
      setImageDataUrl(nextDataUrl);
      setAttachmentMessage("Image attached. Add text if needed, then send.");
    } catch (error) {
      console.error("Unable to attach pasted image", error);
      setAttachmentMessage("Could not attach that image. Try copying it again or choose a file.");
    }
  }

  function handlePaste(event) {
    const clipboard = event.clipboardData;
    const file =
      [...(clipboard.files || [])].find((item) => item.type.startsWith("image/")) ||
      [...(clipboard.items || [])]
        .find((item) => item.type.startsWith("image/"))
        ?.getAsFile();
    if (!file) return;
    event.preventDefault();
    attachImageFile(file);
  }

  function handleFilePick(event) {
    const file = event.target.files?.[0];
    attachImageFile(file);
    event.target.value = "";
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
      setAttachmentMessage("");
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

      <form className="comment-form" onSubmit={submitComment} onPaste={handlePaste}>
        {imageDataUrl && (
          <div className="comment-image-preview">
            <img src={imageDataUrl} alt="Pasted comment preview" />
            <button
              type="button"
              className="icon-button small"
              onClick={() => {
                setImageDataUrl("");
                setAttachmentMessage("");
              }}
              title="Remove image"
            >
              <X size={14} />
            </button>
          </div>
        )}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add an update or paste an image..."
          maxLength={1000}
          rows={2}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="visually-hidden"
          onChange={handleFilePick}
        />
        <div className="comment-form-actions">
          <button
            type="button"
            className="link-button"
            onClick={() => fileInputRef.current?.click()}
          >
            <ImagePlus size={13} /> Paste or choose image
          </button>
          <button
            type="submit"
            className="secondary"
            disabled={(!body.trim() && !imageDataUrl) || isSending}
          >
            <Send size={14} /> {isSending ? "Sending..." : "Send"}
          </button>
        </div>
        {attachmentMessage && <p className="comment-attachment-message">{attachmentMessage}</p>}
      </form>
    </section>
  );
}
