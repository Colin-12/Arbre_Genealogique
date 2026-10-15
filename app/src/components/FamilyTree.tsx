/* Thème clair, sobre. À régler à ta guise : c'est ici que se joue le rendu final. */
.f3.arbre {
  --female-color: #e8b4bc;
  --male-color: #a9c7d3;
  --genderless-color: #d9d9d9;
  --background-color: #faf8f4;
  --text-color: #2b2b2b;

  width: 100%;
  height: 100vh;
  background-color: var(--background-color);
  color: var(--text-color);
}

/* Cartes : texte lisible sur fond pastel */
.f3.arbre .card-inner,
.f3.arbre svg.main_svg text {
  color: var(--text-color);
}
