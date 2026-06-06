// Map a free-form greytHR department label onto an office Department, or null.

import { DEPARTMENTS, type Department } from "@pixeloffice/shared";

/** Lower-cased greytHR/org labels → office department. */
const ALIASES: Record<string, Department> = {
  engineering: "Engineering",
  engg: "Engineering",
  eng: "Engineering",
  tech: "Engineering",
  technology: "Engineering",
  "software development": "Engineering",
  development: "Engineering",
  product: "Product",
  "product management": "Product",
  pm: "Product",
  design: "Design",
  "ui/ux": "Design",
  "ux": "Design",
  ui: "Design",
  hr: "HR",
  "human resources": "HR",
  "people ops": "HR",
  "people operations": "HR",
  people: "HR",
};

/** Returns the matching office Department, or null when nothing matches. */
export function mapGreytHrDepartment(raw: string | null | undefined): Department | null {
  if (typeof raw !== "string") return null;
  const norm = raw.trim().toLowerCase();
  if (norm.length === 0) return null;

  // Exact (normalized) match first, then aliases.
  for (const d of DEPARTMENTS) {
    if (d.toLowerCase() === norm) return d;
  }
  return ALIASES[norm] ?? null;
}
