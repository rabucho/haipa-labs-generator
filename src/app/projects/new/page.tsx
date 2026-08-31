"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/**
 * /projects/new — internal form to create a client project. POSTs to
 * /api/projects and redirects to the project workspace on success.
 */
export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [prospectName, setProspectName] = useState("");
  const [industry, setIndustry] = useState("");
  const [location, setLocation] = useState("");
  const [templateId, setTemplateId] = useState("premium-professional-services-home");
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setErrors([]);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          prospectName,
          industry,
          ...(location ? { location } : {}),
          templateId,
        }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        errors?: string[];
        project?: { id: string };
      };
      if (!res.ok || !body.ok || !body.project) {
        setErrors(body.errors ?? ["Project creation failed."]);
        return;
      }
      router.push(`/projects/${body.project.id}`);
    } catch (error) {
      setErrors([String(error)]);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="container" style={{ padding: "4rem 0" }}>
      <span className="eyebrow">Haipa Labs · Internal Website Factory</span>
      <h1 className="section-title">New client project</h1>
      <form onSubmit={handleSubmit} noValidate>
        <div>
          <label htmlFor="name">Project name</label>
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="prospectName">Prospect name</label>
          <input id="prospectName" value={prospectName} onChange={(e) => setProspectName(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="industry">Industry</label>
          <input id="industry" value={industry} onChange={(e) => setIndustry(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="location">Location (optional)</label>
          <input id="location" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div>
          <label htmlFor="templateId">Template (ready templates only)</label>
          <select id="templateId" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="premium-professional-services-home">
              Premium Professional Services — Home
            </option>
          </select>
        </div>
        {errors.length > 0 && (
          <ul role="alert">
            {errors.map((error, idx) => (
              <li key={idx}>{error}</li>
            ))}
          </ul>
        )}
        <button type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create project"}
        </button>
        <Link href="/projects">Cancel</Link>
      </form>
    </main>
  );
}
