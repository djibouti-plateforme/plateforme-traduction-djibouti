// Configuration du stockage distant.
// La clé « publishable » est faite pour être publique : l'accès aux données est protégé par
// l'authentification et les règles RLS de la base (seuls les membres autorisés voient quelque chose).
export const SUPABASE = {
  url: 'https://klppbbucaslphagjbmth.supabase.co',
  publishableKey: 'sb_publishable_GGkrlll9jTq6XH5GK14vuA_SmbFjCiM',
  region: 'Francfort, UE',
  audioBucket: 'recordings',
};

/** `?demo` dans l'adresse : mode démonstration 100 % local, sans compte. */
export const useLocalDemo = () => new URLSearchParams(location.search).has('demo');
