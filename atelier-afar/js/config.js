// Connexion au serveur de données.
// La clé « publishable » est publique par conception : l'accès aux données est protégé par
// l'authentification et les règles d'accès de la base (seuls les membres du projet voient quelque chose).
export const BACKEND = {
  url: 'https://klppbbucaslphagjbmth.supabase.co',
  publishableKey: 'sb_publishable_GGkrlll9jTq6XH5GK14vuA_SmbFjCiM',
  audioBucket: 'recordings',
  adminFunction: 'admin-users',
};

/** Un segment ouvert reste réservé tant que son verrou a moins de LOCK_TTL_MS. */
export const LOCK_TTL_MS = 5 * 60 * 1000;
export const LOCK_HEARTBEAT_MS = 60 * 1000;
