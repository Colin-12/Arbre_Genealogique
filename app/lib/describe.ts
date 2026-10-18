import type { Datum } from "family-chart";

/** "née en 1984, fille de Anne et Karim" : ce qui permet de reconnaître la bonne personne. */
export function describePerson(person: Datum | undefined, people: Datum[]): string {
  if (!person) return "";
  const gender = person.data["gender"];
  const year = /^(\d{4})/.exec(String(person.data["birthday"] ?? ""))?.[1];
  const parts: string[] = [];
  if (year) parts.push(`${gender === "F" ? "née" : "né"} en ${year}`);
  const parents = person.rels.parents
    .map((id) => people.find((p) => p.id === id))
    .map((p) => String(p?.data["first name"] ?? "").trim())
    .filter(Boolean);
  if (parents.length > 0) {
    parts.push(`${gender === "F" ? "fille" : gender === "M" ? "fils" : "enfant"} de ${parents.join(" et ")}`);
  }
  return parts.join(", ");
}
