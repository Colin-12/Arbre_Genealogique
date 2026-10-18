"use client";

import { type PartialInput } from "@/lib/editTree";

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

export default function DateFields({ label, value, onChange }: { label: string; value: PartialInput; onChange: (v: PartialInput) => void }) {
  return (
    <fieldset className="arbre-fieldset">
      <legend>{label}</legend>
      <div className="arbre-date-row">
        <input
          className="arbre-field"
          inputMode="numeric"
          placeholder="Année"
          maxLength={4}
          value={value.year}
          onChange={(e) => onChange({ ...value, year: e.target.value.replace(/\D/g, "") })}
          aria-label={`${label} : année`}
        />
        <select
          className="arbre-field"
          value={value.month}
          onChange={(e) => onChange({ ...value, month: e.target.value, day: e.target.value ? value.day : "" })}
          aria-label={`${label} : mois`}
        >
          <option value="">Mois</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={String(i + 1)}>
              {m}
            </option>
          ))}
        </select>
        <input
          className="arbre-field"
          inputMode="numeric"
          placeholder="Jour"
          maxLength={2}
          value={value.day}
          disabled={!value.month}
          onChange={(e) => onChange({ ...value, day: e.target.value.replace(/\D/g, "") })}
          aria-label={`${label} : jour`}
        />
      </div>
    </fieldset>
  );
}
