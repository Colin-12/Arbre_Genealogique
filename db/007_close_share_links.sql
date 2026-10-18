-- 007 : les invitations passent uniquement par e-mail (le lien de partage n'est plus proposé dans l'application).
-- On désactive les liens de partage encore actifs, pour qu'aucun ancien lien ne puisse ouvrir l'arbre.
update share_links set revoked_at = now() where revoked_at is null;
