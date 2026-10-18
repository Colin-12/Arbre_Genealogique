import type { MetadataRoute } from "next";

/** Permet d'installer l'application sur l'écran d'accueil du téléphone ("Ajouter à l'écran d'accueil"). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Arbre généalogique",
    short_name: "Arbre",
    description: "Arbre généalogique collaboratif et privé",
    lang: "fr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f4ee",
    theme_color: "#1f5f7a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
