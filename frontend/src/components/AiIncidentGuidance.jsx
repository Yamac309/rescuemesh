import { Ban, CheckCircle2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getIncidentGuidance } from "../api/client";

function cacheKeyFor(report) {
  return [
    "rescuemesh-ai-guidance",
    report.report_id,
    report.title,
    report.description || "",
    report.category,
    report.urgency,
    report.status,
    report.agingLabel || "",
    report.verificationLabel || "",
    report.confidenceScore ?? ""
  ].join(":");
}

export default function AiIncidentGuidance({ report }) {
  const [guidance, setGuidance] = useState(null);
  const [state, setState] = useState("idle");
  const cacheKey = useMemo(() => cacheKeyFor(report), [report]);
  const guidancePayload = useMemo(
    () => ({
      title: report.title,
      category: report.category,
      description: report.description || "",
      urgency: report.urgency,
      status: report.status,
      timestamp: report.timestamp,
      latitude: report.latitude,
      longitude: report.longitude,
      confidenceScore: report.confidenceScore,
      verificationLabel: report.verificationLabel,
      agingLabel: report.agingLabel
    }),
    [
      report.title,
      report.category,
      report.description,
      report.urgency,
      report.status,
      report.timestamp,
      report.latitude,
      report.longitude,
      report.confidenceScore,
      report.verificationLabel,
      report.agingLabel
    ]
  );

  useEffect(() => {
    let cached = null;

    try {
      cached = localStorage.getItem(cacheKey) || sessionStorage.getItem(cacheKey);
    } catch {
      cached = null;
    }

    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        const cachedGuidance = parsed.guidance || parsed;
        if (cachedGuidance.source === "google-ai") {
          setGuidance(cachedGuidance);
          setState("ready");
          return;
        }
      } catch {
        try {
          sessionStorage.removeItem(cacheKey);
          localStorage.removeItem(cacheKey);
        } catch {
          // Ignore cache cleanup failures.
        }
        setGuidance(null);
      }
    }

    setGuidance(null);
    setState("idle");
  }, [cacheKey]);

  function generateGuidance() {
    let cancelled = false;
    setState("loading");
    getIncidentGuidance(guidancePayload)
      .then((nextGuidance) => {
        if (cancelled) return;
        try {
          const serialized = JSON.stringify({ guidance: nextGuidance, cachedAt: Date.now() });
          if (nextGuidance.source === "google-ai") {
            localStorage.setItem(cacheKey, serialized);
          } else {
            sessionStorage.setItem(cacheKey, serialized);
          }
        } catch {
          // Guidance can still render if browser session storage is unavailable.
        }
        setGuidance(nextGuidance);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });

    return () => {
      cancelled = true;
    };
  }

  if (state === "idle") {
    return (
      <section className="ai-guidance-panel">
        <div className="ai-guidance-title">
          <Sparkles size={16} /> Incident guidance
          <span>Gemini</span>
        </div>
        <p className="ai-guidance-loading">Generate incident-specific guidance for this report with Gemini.</p>
        <button type="button" className="secondary ai-guidance-button" onClick={generateGuidance}>
          <Sparkles size={16} /> Generate Gemini Guidance
        </button>
      </section>
    );
  }

  if (state === "loading") {
    return (
      <section className="ai-guidance-panel">
        <div className="ai-guidance-title">
          <Sparkles size={16} /> Incident guidance
        </div>
        <p className="ai-guidance-loading">Generating incident-specific guidance with Gemini...</p>
      </section>
    );
  }

  if (state === "error" || !guidance) {
    return (
      <section className="ai-guidance-panel">
        <div className="ai-guidance-title">
          <Sparkles size={16} /> Incident guidance
        </div>
        <p className="ai-guidance-loading">Gemini guidance is unavailable right now.</p>
      </section>
    );
  }

  if (!guidance.should_do.length && !guidance.avoid.length) {
    return (
      <section className="ai-guidance-panel">
        <div className="ai-guidance-title">
          <Sparkles size={16} /> Incident guidance
          <span>Gemini unavailable</span>
        </div>
        <p className="ai-guidance-loading">{guidance.safety_note}</p>
      </section>
    );
  }

  return (
    <section className="ai-guidance-panel">
      <div className="ai-guidance-title">
        <Sparkles size={16} /> Incident guidance
        <span>{guidance.source === "google-ai" ? "Google AI" : "Local safety guide"}</span>
      </div>
      <div className="ai-guidance-grid">
        <div>
          <strong>
            <CheckCircle2 size={15} /> Best things to do
          </strong>
          {guidance.should_do.map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
        <div>
          <strong>
            <Ban size={15} /> Avoid
          </strong>
          {guidance.avoid.map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
      </div>
      <p className="ai-guidance-note">{guidance.safety_note}</p>
    </section>
  );
}
