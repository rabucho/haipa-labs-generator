"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ValidatedBrandBrief } from "@/lib/projects/brief-repository";

type BriefState = {
  businessName: string;
  industry: string;
  offer: string;
  location: string;
  audience: string;
  differentiators: string;
  tone: string;
  primaryGoal: string;
  contactPhone: string;
  contactEmail: string;
  contactAddress: string;
  contactWebsite: string;
};

function toState(brief: ValidatedBrandBrief | null): BriefState {
  return {
    businessName: brief?.businessName ?? "",
    industry: brief?.industry ?? "",
    offer: brief?.offer ?? "",
    location: brief?.location ?? "",
    audience: brief?.audience ?? "",
    differentiators: brief?.differentiators ?? "",
    tone: brief?.tone ?? "",
    primaryGoal: brief?.primaryGoal ?? "",
    contactPhone: brief?.contactDetails?.phone ?? "",
    contactEmail: brief?.contactDetails?.email ?? "",
    contactAddress: brief?.contactDetails?.address ?? "",
    contactWebsite: brief?.contactDetails?.website ?? "",
  };
}

function toPayload(state: BriefState): Record<string, unknown> {
  return {
    businessName: state.businessName,
    industry: state.industry,
    offer: state.offer,
    ...(state.location && { location: state.location }),
    ...(state.audience && { audience: state.audience }),
    ...(state.differentiators && { differentiators: state.differentiators }),
    ...(state.tone && { tone: state.tone }),
    ...(state.primaryGoal && { primaryGoal: state.primaryGoal }),
    ...((state.contactPhone ||
      state.contactEmail ||
      state.contactAddress ||
      state.contactWebsite) && {
      contactDetails: {
        ...(state.contactPhone && { phone: state.contactPhone }),
        ...(state.contactEmail && { email: state.contactEmail }),
        ...(state.contactAddress && { address: state.contactAddress }),
        ...(state.contactWebsite && { website: state.contactWebsite }),
      },
    }),
  };
}

const HINTS = {
  offer:
    "e.g. “Installations and maintenance of commercial solar systems” — describe the real offer only.",
  audience: "e.g. “Facilities managers of mid-size office buildings”.",
  tone: "e.g. “Calm, plain-spoken, technical”.",
  differentiators:
    "Only facts supplied by the client. No awards or claims you cannot verify.",
};

export default function BriefForm({
  projectId,
  initialBrief,
}: {
  projectId: string;
  initialBrief: ValidatedBrandBrief | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<BriefState>(toState(initialBrief));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<boolean>(initialBrief !== null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  function update(field: keyof BriefState, value: string) {
    setState((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const res = await fetch(`/api/projects/${projectId}/brief`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(state)),
      });
      const body = (await res.json()) as { ok: boolean; errors?: string[] };
      if (!res.ok || !body.ok) {
        const next: Record<string, string> = {};
        for (const raw of body.errors ?? ["Save failed."]) {
          const [path, ...rest] = raw.split(":");
          next[path.trim() === "(root)" ? "_root" : path.trim()] = rest
            .join(":")
            .trim();
        }
        setErrors(next);
        setSaved(false);
        return;
      }
      setSaved(true);
      setSavedAt(new Date().toLocaleTimeString());
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const field = (
    name: keyof BriefState,
    label: string,
    options?: { required?: boolean; textarea?: boolean; hint?: string }
  ) => (
    <div>
      <label htmlFor={name}>
        {label}
        {options?.required && " *"}
      </label>
      {options?.textarea ? (
        <textarea
          id={name}
          rows={3}
          value={state[name]}
          onChange={(e) => update(name, e.target.value)}
        />
      ) : (
        <input
          id={name}
          value={state[name]}
          onChange={(e) => update(name, e.target.value)}
        />
      )}
      {options?.hint && <small>{options.hint}</small>}
      {errors[name] && <p role="alert">{errors[name]}</p>}
    </div>
  );

  return (
    <form onSubmit={handleSave} noValidate>
      <fieldset>
        <legend>Business basics</legend>
        {field("businessName", "Business name", { required: true })}
        {field("industry", "Industry", { required: true })}
        {field("location", "Location (optional)")}
      </fieldset>

      <fieldset>
        <legend>The offer</legend>
        {field("offer", "What does the business offer?", {
          required: true,
          textarea: true,
          hint: HINTS.offer,
        })}
        {field("audience", "Who is the intended audience?", {
          textarea: true,
          hint: HINTS.audience,
        })}
        {field("differentiators", "What makes this business different?", {
          textarea: true,
          hint: HINTS.differentiators,
        })}
      </fieldset>

      <fieldset>
        <legend>Voice & goal</legend>
        {field("tone", "Desired tone (optional)", { hint: HINTS.tone })}
        {field("primaryGoal", "Primary goal of the website (optional)")}
      </fieldset>

      <fieldset>
        <legend>Contact details (optional — used only when supplied)</legend>
        {field("contactPhone", "Phone")}
        {field("contactEmail", "Email")}
        {field("contactAddress", "Address")}
        {field("contactWebsite", "Website (https://…)")}
      </fieldset>

      {errors._root && <p role="alert">{errors._root}</p>}

      <div>
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save brief"}
        </button>
        <span>
          {saved
            ? savedAt
              ? `Saved at ${savedAt}`
              : "Saved"
            : "Unsaved changes"}
        </span>
      </div>
    </form>
  );
}
