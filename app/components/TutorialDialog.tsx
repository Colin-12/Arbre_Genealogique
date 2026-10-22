"use client";

import { useState, type ReactNode } from "react";
import Modal from "./Modal";

type Props = {
  /** Rôle dans l'arbre ouvert (undefined : pas d'arbre ouvert). Le tutoriel ne parle que de ce que la personne peut faire. */
  role?: string;
  /** Fermer sans rien retenir : le tutoriel pourra revenir à une prochaine visite. */
  onClose: () => void;
  /** « Ne plus me montrer ça » : ne revient plus tout seul (il reste dans « Mes arbres »). */
  onNeverShow: () => void;
};

type Step = { title: string; body: ReactNode };

function stepsFor(role?: string): Step[] {
  const owner = role === "owner";
  const canEdit = owner || role === "editor";

  const steps: Step[] = [
    {
      title: "Bienvenue",
      body: (
        <>
          <p>Cette appli sert à construire ensemble l&apos;arbre généalogique de la famille : chacun peut le consulter, et ceux qui le souhaitent le complètent.</p>
          <p>Un petit tour d&apos;une minute pour voir comment ça marche.</p>
        </>
      ),
    },
    {
      title: "Se déplacer dans l'arbre",
      body: (
        <>
          <p>L&apos;arbre est affiché autour d&apos;une personne, celle du centre.</p>
          <ul>
            <li>Touche une carte pour recentrer la vue sur cette personne.</li>
            <li>Glisse pour déplacer l&apos;arbre, pince (ou molette) pour zoomer.</li>
            <li>« Remonter » va vers un parent, « Vue initiale » revient au départ, « Recadrer » recentre l&apos;écran.</li>
            <li>La recherche retrouve quelqu&apos;un par son nom, même sans accent.</li>
          </ul>
        </>
      ),
    },
    {
      title: "La fiche d'une personne",
      body: (
        <>
          <p>Le bouton « Fiche » ouvre la fiche de la personne au centre : dates, lieux, nom de naissance, commentaire.</p>
          <p>Elle contient aussi sa photo de profil et une galerie de photos, où l&apos;on peut identifier les personnes présentes.</p>
        </>
      ),
    },
  ];

  if (canEdit) {
    steps.push(
      {
        title: "Ajouter des personnes",
        body: (
          <>
            <p>Le bouton « Ajouter » se fait toujours à partir de la personne au centre : un enfant, un conjoint, un parent, un frère ou une sœur.</p>
            <ul>
              <li>L&apos;appli propose les personnes déjà saisies : choisis-la plutôt que de créer un doublon.</li>
              <li>La date de naissance peut être partielle (juste l&apos;année, ou le mois).</li>
              <li>Pour un conjoint qui a déjà des enfants dans l&apos;arbre, l&apos;appli demande lesquels sont aussi les siens.</li>
            </ul>
          </>
        ),
      },
      {
        title: "Corriger sans risque",
        body: (
          <>
            <p>Le bouton « Modifier » permet de changer les informations, de corriger les liens (un parent mal placé, par exemple) ou de supprimer une personne.</p>
            <p>Après un ajout ou une suppression, un bouton « Annuler » reste affiché quelques instants en bas de l&apos;écran. Une erreur se rattrape donc facilement.</p>
          </>
        ),
      }
    );
  } else {
    steps.push({
      title: "Ce que tu peux faire",
      body: (
        <>
          <p>
            {role === "commenter"
              ? "Tu peux consulter l'arbre et les fiches, et compléter les légendes des photos."
              : "Tu peux consulter l'arbre, les fiches et les photos."}
          </p>
          <p>Pour ajouter ou corriger des personnes, demande au propriétaire de l&apos;arbre de te donner le rôle d&apos;éditeur.</p>
        </>
      ),
    });
  }

  if (owner) {
    steps.push({
      title: "Inviter la famille",
      body: (
        <>
          <p>Le bouton « Inviter » propose deux façons :</p>
          <ul>
            <li>Un lien à envoyer (WhatsApp, SMS...) : la personne fait une demande d&apos;accès et tu l&apos;acceptes, en choisissant son rôle.</li>
            <li>Une invitation par e-mail, pour une ou plusieurs adresses à la fois.</li>
          </ul>
          <p>Tu es prévenu par e-mail et par notification des demandes. Active-les dans la fenêtre « Inviter ».</p>
        </>
      ),
    });
  }

  steps.push({
    title: "Tes arbres et ton compte",
    body: (
      <>
        <p>Touche le nom de l&apos;arbre en haut à gauche pour ouvrir « Mes arbres » : changer d&apos;arbre, en créer un, en quitter un, exporter l&apos;arbre en image ou en PDF, voir avec quelle adresse tu es connecté, te déconnecter.</p>
        <p>Sur téléphone, tu peux ajouter l&apos;appli à l&apos;écran d&apos;accueil, depuis le menu de ton navigateur, pour l&apos;ouvrir comme une vraie application.</p>
        <p>Tu retrouveras ce tutoriel à tout moment dans « Mes arbres », avec le bouton « Comment ça marche ? ».</p>
      </>
    ),
  });

  return steps;
}

/** Tutoriel en quelques étapes, avec « Ne plus me montrer ça ». */
export default function TutorialDialog({ role, onClose, onNeverShow }: Props) {
  const steps = stepsFor(role);
  const [i, setI] = useState(0);
  const step = steps[i];
  const last = i === steps.length - 1;

  return (
    <Modal title="Comment ça marche ?" onClose={onClose}>
      <div className="arbre-tuto-dots" aria-hidden="true">
        {steps.map((s, k) => (
          <span key={s.title} className={k <= i ? "arbre-tuto-dot is-done" : "arbre-tuto-dot"} />
        ))}
      </div>
      <p className="arbre-tuto-step">
        Étape {i + 1} sur {steps.length}
      </p>
      <h3>{step.title}</h3>
      <div className="arbre-tuto-body">{step.body}</div>

      <button type="button" className="arbre-link arbre-tuto-never" onClick={onNeverShow}>
        Ne plus me montrer ça
      </button>

      <div className="arbre-modal-actions">
        {i === 0 ? (
          <button type="button" className="arbre-btn" onClick={onClose}>
            Plus tard
          </button>
        ) : (
          <button type="button" className="arbre-btn" onClick={() => setI(i - 1)}>
            Précédent
          </button>
        )}
        {last ? (
          <button type="button" className="arbre-btn arbre-btn-accent" onClick={onClose}>
            Terminer
          </button>
        ) : (
          <button type="button" className="arbre-btn arbre-btn-accent" onClick={() => setI(i + 1)}>
            Suivant
          </button>
        )}
      </div>
    </Modal>
  );
}
