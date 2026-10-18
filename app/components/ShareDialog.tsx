"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { disablePush, enablePush, getPushState, type PushState } from "@/lib/push";
import {
  GRANTABLE,
  MAX_BATCH,
  ROLE_HELP,
  ROLE_LABEL,
  accessUrl,
  answerAccessRequest,
  changeMemberRole,
  createInvitations,
  getJoinCode,
  listAccessRequests,
  listInvitations,
  listMembers,
  parseEmails,
  regenerateJoinCode,
  removeMember,
  revokeInvitation,
  sendInvitationEmail,
  type AccessRequest,
  type BatchResult,
  type GrantableRole,
  type Invitation,
  type Member,
} from "@/lib/sharing";

type Props = {
  treeId: string;
  treeName: string;
  /** Compte connecté (pour repérer "toi" dans la liste). */
  userId: string;
  /** Appelé à la fermeture, avec le nombre de demandes d'accès encore en attente. */
  onClose: (pendingRequests: number) => void;
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

  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [requestRole, setRequestRole] = useState<Record<string, GrantableRole>>({});
  const [code, setCode] = useState<string | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [push, setPush] = useState<PushState>("unconfigured");

  const [emails, setEmails] = useState("");
  const [inviteRole, setInviteRole] = useState<GrantableRole>("editor");
  const [results, setResults] = useState<BatchResult[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const parsed = parseEmails(emails);

  const refresh = useCallback(async () => {
    const [m, i, r, c] = await Promise.all([
      listMembers(treeId),
      listInvitations(treeId),
      listAccessRequests(treeId).catch(() => [] as AccessRequest[]),
      getJoinCode(treeId).catch(() => null),
    ]);
    setMembers(m);
    setInvitations(i);
    setRequests(r);
    setCode(c);
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
    let alive = true;
    (async () => {
      const state = await getPushState();
      if (alive) setPush(state);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  function close() {
    onClose(requests.length);
  }

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
    if (parsed.invalid.length > 0 || parsed.valid.length === 0 || parsed.valid.length > MAX_BATCH) return;
    setNotice(null);
    setResults(null);
    run(async () => {
      const out = await createInvitations(treeId, parsed.valid, inviteRole);
      setResults(out);
      // on garde dans la zone de saisie seulement les adresses qui ont échoué, pour pouvoir corriger
      const failed = out.filter((r) => r.status === "failed").map((r) => r.address);
      setEmails(failed.join("\n"));
    });
  }

  async function togglePush() {
    setError(null);
    setBusy(true);
    try {
      if (push === "on") await disablePush();
      else await enablePush();
      setPush(await getPushState());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPush(await getPushState());
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(accessUrl(code));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Impossible de copier automatiquement : sélectionne le lien ci-dessus et copie-le à la main.");
    }
  }

  async function shareLink() {
    if (!code) return;
    try {
      await navigator.share({ title: treeName, text: `Rejoins l'arbre généalogique « ${treeName} » :`, url: accessUrl(code) });
    } catch {
      // partage annulé : rien à signaler
    }
  }

  function resend(address: string) {
    setResults(null);
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
        if (e.target === e.currentTarget && !busy) close();
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

        {push !== "unconfigured" && (
          <section className="arbre-links-section">
            <h3>Être prévenu des demandes</h3>
            {(push === "off" || push === "on") && (
              <>
                <p className="arbre-hint">
                  {push === "on"
                    ? "Les notifications sont activées sur cet appareil : tu en reçois une à chaque nouvelle demande d'accès, en plus de l'e-mail."
                    : "Reçois une notification sur cet appareil à chaque nouvelle demande d'accès. Tu recevras aussi un e-mail, à l'adresse de ton compte."}
                </p>
                <div className="arbre-share-actions">
                  <button type="button" className={push === "on" ? "arbre-btn" : "arbre-btn arbre-btn-accent"} onClick={togglePush} disabled={busy}>
                    {push === "on" ? "Désactiver sur cet appareil" : "Activer les notifications"}
                  </button>
                </div>
              </>
            )}
            {push === "needs-install" && (
              <p className="arbre-hint">
                Sur iPhone, installe d&apos;abord l&apos;appli : dans Safari, touche le bouton Partager, puis « Sur l&apos;écran d&apos;accueil ». Ouvre l&apos;appli depuis l&apos;écran d&apos;accueil, puis reviens ici pour activer les
                notifications. En attendant, tu reçois les demandes par e-mail.
              </p>
            )}
            {push === "denied" && (
              <p className="arbre-hint">
                Les notifications sont bloquées pour ce site dans ton navigateur. Autorise-les dans ses réglages, puis reviens ici. En attendant, tu reçois les demandes par e-mail.
              </p>
            )}
            {push === "unsupported" && <p className="arbre-hint">Ce navigateur ne gère pas les notifications. Tu reçois quand même les demandes par e-mail.</p>}
          </section>
        )}

        {requests.length > 0 && (
          <section className="arbre-links-section arbre-requests">
            <h3>Demandes d&apos;accès ({requests.length})</h3>
            <ul>
              {requests.map((r) => (
                <li key={r.id} className="arbre-link-row arbre-share-member">
                  <div className="arbre-link-person">
                    <span>{r.display_name}</span>
                    {r.email && <span className="arbre-hint arbre-share-email">{r.email}</span>}
                    {r.message && <span className="arbre-request-msg">« {r.message} »</span>}
                  </div>
                  <div className="arbre-link-confirm">
                    <RoleSelect
                      value={requestRole[r.id] ?? "viewer"}
                      disabled={busy}
                      label={`Rôle à donner à ${r.display_name}`}
                      onChange={(role) => setRequestRole((m) => ({ ...m, [r.id]: role }))}
                    />
                    <button type="button" className="arbre-btn arbre-btn-accent" disabled={busy} onClick={() => run(() => answerAccessRequest(r.id, true, requestRole[r.id] ?? "viewer"))}>
                      Accepter
                    </button>
                    <button type="button" className="arbre-btn" disabled={busy} onClick={() => run(() => answerAccessRequest(r.id, false, "viewer"))}>
                      Refuser
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {code && (
          <section className="arbre-links-section">
            <h3>Inviter avec un lien</h3>
            <p className="arbre-hint">
              Envoie ce lien à tes proches (message, WhatsApp...). Chacun crée son compte puis fait une demande : tu valides ici, une par une.
              Le lien seul ne donne accès à rien.
            </p>
            <input className="arbre-field" readOnly value={accessUrl(code)} onFocus={(e) => e.currentTarget.select()} aria-label="Lien à envoyer à tes proches" />
            <div className="arbre-share-actions">
              <button type="button" className="arbre-btn arbre-btn-accent" onClick={copyLink} disabled={busy}>
                {copied ? "Lien copié" : "Copier le lien"}
              </button>
              {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
                <button type="button" className="arbre-btn" onClick={shareLink} disabled={busy}>
                  Envoyer le lien...
                </button>
              )}
            </div>
            {confirmRegen ? (
              <div className="arbre-picked">
                <div>L&apos;ancien lien cessera de fonctionner (les demandes déjà reçues restent). Changer le lien ?</div>
                <div className="arbre-share-actions">
                  <button
                    type="button"
                    className="arbre-btn arbre-btn-danger-solid"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await regenerateJoinCode(treeId);
                        setConfirmRegen(false);
                      })
                    }
                  >
                    Changer le lien
                  </button>
                  <button type="button" className="arbre-btn" onClick={() => setConfirmRegen(false)}>
                    Garder
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="arbre-link" onClick={() => setConfirmRegen(true)} disabled={busy}>
                Le lien a circulé trop loin ? Le changer
              </button>
            )}
          </section>
        )}

        <section className="arbre-links-section">
          <h3>Inviter par e-mail</h3>
          <form onSubmit={invite}>
            <textarea
              className="arbre-field"
              rows={3}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={"adresse1@exemple.fr\nadresse2@exemple.fr\n(une par ligne, ou séparées par des virgules)"}
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              aria-label="Adresses e-mail des personnes à inviter"
            />
            {parsed.invalid.length > 0 && (
              <div className="arbre-login-error" role="alert">
                Adresse non reconnue : {parsed.invalid.join(", ")}
              </div>
            )}
            {parsed.valid.length > MAX_BATCH && (
              <div className="arbre-login-error" role="alert">
                {MAX_BATCH} adresses au plus à la fois ({parsed.valid.length} saisies). Envoie les autres ensuite.
              </div>
            )}
            <div className="arbre-share-row">
              <RoleSelect value={inviteRole} onChange={setInviteRole} label="Rôle des personnes invitées" />
              <button
                type="submit"
                className="arbre-btn arbre-btn-accent"
                disabled={busy || parsed.valid.length === 0 || parsed.invalid.length > 0 || parsed.valid.length > MAX_BATCH}
              >
                {parsed.valid.length > 1 ? `Inviter ${parsed.valid.length} personnes` : "Inviter"}
              </button>
            </div>
            <span className="arbre-hint">{ROLE_LABEL[inviteRole]} : {ROLE_HELP[inviteRole]}.</span>
          </form>

          {results && (
            <div className="arbre-picked arbre-share-done" role="status">
              {results.every((r) => r.status === "sent") ? (
                <div>
                  {results.length === 1 ? (
                    <>
                      Un e-mail avec le lien de connexion vient d&apos;être envoyé à <strong>{results[0].address}</strong>. La personne n&apos;a qu&apos;à cliquer dessus pour ouvrir l&apos;arbre.
                    </>
                  ) : (
                    <>Les {results.length} e-mails sont partis. Chaque personne n&apos;a qu&apos;à cliquer sur son lien pour ouvrir l&apos;arbre.</>
                  )}
                </div>
              ) : (
                <ul className="arbre-batch">
                  {results.map((r) => (
                    <li key={r.address}>
                      <strong>{r.address}</strong> :{" "}
                      {r.status === "sent" && "e-mail envoyé."}
                      {r.status === "recorded" && <>invitation enregistrée, mais l&apos;e-mail n&apos;est pas parti ({r.detail}) Tu pourras le renvoyer depuis la liste ci-dessous.</>}
                      {r.status === "failed" && <>non invitée : {r.detail}</>}
                    </li>
                  ))}
                </ul>
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
          <button type="button" className="arbre-btn arbre-btn-accent" onClick={close} disabled={busy}>
            Terminé
          </button>
        </div>
      </div>
    </div>
  );
}
