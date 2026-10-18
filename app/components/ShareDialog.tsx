"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import {
  GRANTABLE,
  ROLE_HELP,
  ROLE_LABEL,
  changeMemberRole,
  createInvitation,
  listInvitations,
  listMembers,
  removeMember,
  revokeInvitation,
  sendInvitationEmail,
  type GrantableRole,
  type Invitation,
  type Member,
} from "@/lib/sharing";

type Props = {
  treeId: string;
  treeName: string;
  /** Compte connecté (pour repérer "toi" dans la liste). */
  userId: string;
  onClose: () => void;
};

function dateFr(iso: string | null): string {
  if (!iso) return "sans limite";
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
}

function RoleSelect({ value, onChange, disabled, label }: { value: GrantableRole; onChange: (r: GrantableRole) => void; disabled?: boolean; label: string }) {
  return (
    <select className="arbre-field arbre-share-select" value={value} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.value as GrantableRole)}>
      {GRANTABLE.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABEL[r]}
        </option>
      ))}
    </select>
  );
}

/** Partage de l'arbre (propriétaire) : inviter par e-mail, liens de partage et gestion des membres. */
export default function ShareDialog({ treeId, treeName, userId, onClose }: Props) {
  const titleId = useId();
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<GrantableRole>("editor");
  const [invited, setInvited] = useState<{ address: string; mailError: string | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [m, i] = await Promise.all([listMembers(treeId), listInvitations(treeId)]);
    setMembers(m);
    setInvitations(i);
    setLoaded(true);
  }, [treeId]);

  useEffect(() => {
    (async () => {
      try {
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setLoaded(true);
      }
    })();
  }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  /** Exécute une action puis recharge les listes, en affichant l'erreur éventuelle. */
  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function invite(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;
    setNotice(null);
    run(async () => {
      const mailError = await createInvitation(treeId, address, inviteRole);
      setInvited({ address, mailError });
      setEmail("");
    });
  }

  function resend(address: string) {
    setInvited(null);
    setNotice(null);
    run(async () => {
      const mailError = await sendInvitationEmail(address);
      if (mailError) throw new Error(mailError);
      setNotice(`E-mail renvoyé à ${address}.`);
    });
  }

  return (
    <div
      className="arbre-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="arbre-modal arbre-share" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>
          Inviter des proches dans <span className="arbre-modal-name">{treeName}</span>
        </h2>

        {error && (
          <div className="arbre-login-error arbre-share-error" role="alert">
            {error}
          </div>
        )}

        <section className="arbre-links-section">
          <h3>Inviter par e-mail</h3>
          <form onSubmit={invite}>
            <input
              className="arbre-field"
              type="email"
              inputMode="email"
              autoComplete="off"
              placeholder="adresse@exemple.fr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Adresse e-mail de la personne à inviter"
              required
            />
            <div className="arbre-share-row">
              <RoleSelect value={inviteRole} onChange={setInviteRole} label="Rôle de la personne invitée" />
              <button type="submit" className="arbre-btn arbre-btn-accent" disabled={busy || !email.trim()}>
                Inviter
              </button>
            </div>
            <span className="arbre-hint">{ROLE_LABEL[inviteRole]} : {ROLE_HELP[inviteRole]}.</span>
          </form>

          {invited && (
            <div className="arbre-picked arbre-share-done" role="status">
              {invited.mailError ? (
                <div>
                  L&apos;invitation de <strong>{invited.address}</strong> est enregistrée, mais l&apos;e-mail n&apos;est pas parti : {invited.mailError}{" "}
                  Tu pourras le renvoyer depuis la liste ci-dessous.
                </div>
              ) : (
                <div>
                  Un e-mail avec le lien de connexion vient d&apos;être envoyé à <strong>{invited.address}</strong>. La personne n&apos;a qu&apos;à
                  cliquer dessus pour ouvrir l&apos;arbre.
                </div>
              )}
            </div>
          )}
          {notice && (
            <div className="arbre-picked arbre-share-done" role="status">
              {notice}
            </div>
          )}
        </section>

        {invitations.length > 0 && (
          <section className="arbre-links-section">
            <h3>Invitations en attente</h3>
            <ul>
              {invitations.map((inv) => (
                <li key={inv.id} className="arbre-link-row">
                  <div className="arbre-link-person">
                    <span className="arbre-share-email">{inv.email}</span>
                    <span className="arbre-hint">
                      {ROLE_LABEL[inv.role]}, valable jusqu&apos;au {dateFr(inv.expires_at)}
                    </span>
                  </div>
                  <div className="arbre-link-confirm">
                    <button type="button" className="arbre-btn" disabled={busy} onClick={() => resend(inv.email)}>
                      Renvoyer
                    </button>
                    <button type="button" className="arbre-btn" disabled={busy} onClick={() => run(() => revokeInvitation(inv.id))}>
                      Annuler
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="arbre-links-section">
          <h3>Personnes qui ont accès</h3>
          {!loaded && <span className="arbre-hint">Chargement...</span>}
          <ul>
            {members.map((m) => {
              const isOwner = m.role === "owner";
              return (
                <li key={m.user_id} className="arbre-link-row arbre-share-member">
                  <div className="arbre-link-person">
                    <span>
                      {m.display_name}
                      {m.user_id === userId ? " (toi)" : ""}
                    </span>
                    {m.email && <span className="arbre-hint">{m.email}</span>}
                  </div>
                  {isOwner ? (
                    <span className="arbre-share-role">{ROLE_LABEL.owner}</span>
                  ) : confirmRemove === m.user_id ? (
                    <div className="arbre-link-confirm">
                      <button type="button" className="arbre-btn arbre-btn-danger-solid" disabled={busy} onClick={() => run(async () => {
                        await removeMember(treeId, m.user_id);
                        setConfirmRemove(null);
                      })}>
                        Retirer
                      </button>
                      <button type="button" className="arbre-btn" onClick={() => setConfirmRemove(null)}>
                        Garder
                      </button>
                    </div>
                  ) : (
                    <div className="arbre-link-confirm">
                      <RoleSelect
                        value={m.role as GrantableRole}
                        disabled={busy}
                        label={`Rôle de ${m.display_name}`}
                        onChange={(r) => run(() => changeMemberRole(treeId, m.user_id, r))}
                      />
                      <button type="button" className="arbre-btn arbre-btn-danger" disabled={busy} onClick={() => setConfirmRemove(m.user_id)}>
                        Retirer
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <div className="arbre-modal-actions">
          <button type="button" className="arbre-btn arbre-btn-accent" onClick={onClose} disabled={busy}>
            Terminé
          </button>
        </div>
      </div>
    </div>
  );
}
