"use client";

import { useEffect, useState } from "react";
import { disablePush, enablePush, getPushState, type PushState } from "@/lib/push";

type Props = {
  /** Titre de la section ; sans titre, le bloc est affiché sans cadre. */
  heading?: string;
  /** Texte quand les notifications sont coupées / activées sur cet appareil. */
  offText: string;
  onText: string;
  /** Rappel de ce qui reste vrai sans notification, ajouté aux cas "bloquées", "iPhone non installé" et "non gérées". */
  fallback: string;
};

/** Active ou coupe les notifications sur l'appareil. N'affiche rien si les notifications ne sont pas configurées. */
export default function PushToggle({ heading, offText, onText, fallback }: Props) {
  const [state, setState] = useState<PushState>("unconfigured");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const s = await getPushState();
      if (alive) setState(s);
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function toggle() {
    setError(null);
    setBusy(true);
    try {
      if (state === "on") await disablePush();
      else await enablePush();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setState(await getPushState());
      setBusy(false);
    }
  }

  if (state === "unconfigured") return null;

  const body = (
    <>
      {error && (
        <div className="arbre-login-error" role="alert">
          {error}
        </div>
      )}
      {(state === "off" || state === "on") && (
        <>
          <p className="arbre-hint">{state === "on" ? onText : offText}</p>
          <div className="arbre-share-actions">
            <button type="button" className={state === "on" ? "arbre-btn" : "arbre-btn arbre-btn-accent"} onClick={toggle} disabled={busy}>
              {state === "on" ? "Désactiver sur cet appareil" : "Activer les notifications"}
            </button>
          </div>
        </>
      )}
      {state === "needs-install" && (
        <p className="arbre-hint">
          Sur iPhone, installe d&apos;abord l&apos;appli : dans Safari, touche le bouton Partager, puis « Sur l&apos;écran d&apos;accueil ». Ouvre l&apos;appli depuis l&apos;écran d&apos;accueil, puis reviens ici pour activer les
          notifications. {fallback}
        </p>
      )}
      {state === "denied" && (
        <p className="arbre-hint">Les notifications sont bloquées pour ce site dans ton navigateur. Autorise-les dans ses réglages, puis reviens ici. {fallback}</p>
      )}
      {state === "unsupported" && <p className="arbre-hint">Ce navigateur ne gère pas les notifications. {fallback}</p>}
    </>
  );

  return heading ? (
    <section className="arbre-links-section">
      <h3>{heading}</h3>
      {body}
    </section>
  ) : (
    <div className="arbre-push">{body}</div>
  );
}
