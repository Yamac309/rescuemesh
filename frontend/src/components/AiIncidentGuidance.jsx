import { Ban, CheckCircle2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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

function localPreviewGuidance(report) {
  const guidanceByCategory = {
    "Need Help": {
      should_do: [
        "If anyone is in immediate danger, call emergency services first.",
        "Move to the safest nearby place and share the report location with responders.",
        "Keep your phone available for emergency calls and updates."
      ],
      avoid: [
        "Do not enter unstable buildings, floodwater, or blocked areas.",
        "Do not separate from your group unless a responder directs you.",
        "Do not post private personal details in public updates."
      ]
    },
    "Dangerous Area": {
      should_do: [
        "Warn people away from the area and share a safer route.",
        "Move uphill or upwind if flooding, smoke, gas, or chemicals may be involved.",
        "Update the report when trusted information changes."
      ],
      avoid: [
        "Do not enter the area to take photos or check conditions.",
        "Do not cross floodwater, unstable ground, or taped-off zones.",
        "Do not spread unconfirmed hazard details as fact."
      ]
    },
    "Blocked Road": {
      should_do: [
        "Report the exact blockage location and safest alternate route.",
        "Keep people and vehicles back from debris, wires, and unstable trees.",
        "Leave room for emergency vehicles and road crews."
      ],
      avoid: [
        "Do not drive around barricades or through debris fields.",
        "Do not touch downed wires or objects touching them.",
        "Do not move heavy debris without proper equipment."
      ]
    },
    "First Aid": {
      should_do: [
        "Call emergency services for severe bleeding, breathing trouble, chest pain, or unconsciousness.",
        "Keep the injured person still, warm, and away from hazards.",
        "Use trained first aid help if available."
      ],
      avoid: [
        "Do not move someone with a possible neck or spine injury unless they are in immediate danger.",
        "Do not give food or drink to an unconscious or severely injured person.",
        "Do not attempt advanced care without training."
      ]
    }
  };
  const guidance = guidanceByCategory[report.category] || {
    should_do: [
      "Keep the update short, specific, and tied to a location.",
      "Include what changed and when it was observed.",
      "Refresh the report if conditions change."
    ],
    avoid: [
      "Do not include rumors, private details, or unclear secondhand claims.",
      "Do not mark the update confirmed without a trusted source.",
      "Do not duplicate older reports when an update would be clearer."
    ]
  };

  return {
    ...guidance,
    safety_note: "Local safety guidance shown while Gemini responds. Follow official responder instructions when available.",
    source: "local-fallback",
    model: null,
    unavailable_reason: null
  };
}

export default function AiIncidentGuidance({ report }) {
  const [guidance, setGuidance] = useState(null);
  const [state, setState] = useState("idle");
  const requestRef = useRef(null);
  const mountedRef = useRef(true);
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
      confidence_score: report.confidenceScore,
      verification_label: report.verificationLabel,
      aging_label: report.agingLabel
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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (requestRef.current) requestRef.current.abort();
    };
  }, []);

  function generateGuidance() {
    if (state === "loading") return;

    if (requestRef.current) requestRef.current.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const previewId = window.setTimeout(() => {
      if (controller.signal.aborted || !mountedRef.current) return;
      setGuidance(localPreviewGuidance(report));
      setState("ready");
    }, 1200);
    const timeoutId = window.setTimeout(() => controller.abort(), 10000);

    setState("loading");
    getIncidentGuidance(guidancePayload, { signal: controller.signal })
      .then((nextGuidance) => {
        if (controller.signal.aborted || !mountedRef.current) return;
        window.clearTimeout(previewId);
        try {
          const serialized = JSON.stringify({ guidance: nextGuidance, cachedAt: Date.now() });
          if (nextGuidance.source === "google-ai") localStorage.setItem(cacheKey, serialized);
        } catch {
          // Guidance can still render if browser session storage is unavailable.
        }
        setGuidance(nextGuidance);
        setState("ready");
      })
      .catch((error) => {
        if (!mountedRef.current) return;
        window.clearTimeout(previewId);
        if (controller.signal.aborted) {
          setGuidance(localPreviewGuidance(report));
          setState("ready");
          return;
        }
        console.error("Gemini guidance request failed", error);
        setState("error");
      })
      .finally(() => {
        window.clearTimeout(previewId);
        window.clearTimeout(timeoutId);
        if (requestRef.current === controller) requestRef.current = null;
      });
  }

  if (state === "idle") {
    return (
      <section className="ai-guidance-panel">
        <div className="ai-guidance-title">
          <Sparkles size={16} /> Incident guidance
          <span>Gemini</span>
        </div>
        <p className="ai-guidance-loading">Generate incident-specific guidance for this report with Gemini.</p>
        <button type="button" className="secondary ai-guidance-button" onClick={generateGuidance} disabled={state === "loading"}>
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
        <p className="ai-guidance-loading">
          {guidance?.unavailable_reason || "Gemini guidance is unavailable right now."}
        </p>
        <button type="button" className="secondary ai-guidance-button" onClick={generateGuidance} disabled={state === "loading"}>
          <Sparkles size={16} /> Try Gemini Again
        </button>
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
        <p className="ai-guidance-loading">{guidance.unavailable_reason || guidance.safety_note}</p>
        <button type="button" className="secondary ai-guidance-button" onClick={generateGuidance} disabled={state === "loading"}>
          <Sparkles size={16} /> Try Gemini Again
        </button>
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
