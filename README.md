# Dressing

Appli web installable (iPhone, Android, ordinateur). Page statique sur GitHub Pages, données et photos sur Supabase, IA via un petit relais qui garde ta clé Claude à l'abri.

## Mise en place (environ 20 minutes, une seule fois)

1. **Supabase.** Crée un compte sur supabase.com, puis un projet. Choisis une région en Europe (Paris ou Francfort). Note le mot de passe de la base, même si l'app n'en a pas besoin.
2. **Base de données.** Menu *SQL Editor*, colle tout le contenu de `supabase/schema.sql`, puis *Run*. Il crée les tables, les règles de sécurité, le dossier de photos et le compteur anti-dérapage.
3. **Ton compte.** *Authentication > Sign In / Providers* : désactive *Allow new users to sign up* (personne d'autre ne pourra créer de compte). Puis *Authentication > Users > Add user* : ton e-mail, un mot de passe, et coche *Auto Confirm User*.
4. **Clé Claude.** Sur console.anthropic.com, crée une clé API. Ajoute 10 $ de crédit et fixe une limite de dépense mensuelle (10 $ suffisent largement pour toi seul).
5. **Relais Claude.** Dans Supabase, *Edge Functions > Deploy a new function > Via Editor*. Nom : `claude-proxy`. Colle le contenu de `supabase/functions/claude-proxy/index.ts`, puis *Deploy*. Désactive *Verify JWT* (la fonction vérifie elle-même la session). Ensuite *Edge Functions > Secrets* : ajoute `ANTHROPIC_API_KEY` avec ta clé.
   Réglages facultatifs, en secrets : `DAILY_CAP` (appels par jour, 300 par défaut), `ALLOWED_ORIGIN` (l'adresse de ton site, pour fermer le relais aux autres sites), `MODEL_QUICK` et `MODEL_DEFAULT` (par exemple `claude-haiku-5-5` pour payer moins).
6. **Brancher l'app.** *Project Settings > API* : copie *Project URL* et la clé *anon public*. Colle-les dans `config.js`. La clé anon est publique par conception, ce n'est pas un secret.
7. **Publier.** Sur GitHub, dépôt public, puis *Settings > Pages > Deploy from a branch > main / (root)*. Ton adresse sera `https://TON-PSEUDO.github.io/NOM-DU-DEPOT/`.
8. **iPhone.** Ouvre l'adresse dans Safari, connecte-toi, puis *Partager > Sur l'écran d'accueil*.

## Reprendre un dressing existant

Dans l'ancienne version : *Bilan > Sauvegarde (JSON)*, et si le bouton existe *Photos (ZIP)*. Dans la nouvelle : *Bilan > Restaurer une sauvegarde*, choisis le JSON, ajoute le ZIP de photos si tu en as un.

## Mise à jour de l'app

Remplace les fichiers dans le dépôt. L'app se met à jour à l'ouverture suivante, quand le téléphone est en ligne.

## À savoir

- Les photos sont dans un dossier public de Supabase, mais chaque adresse contient un identifiant aléatoire impossible à deviner. Pour un usage à plusieurs, il faudra passer en dossier privé.
- Mode hors ligne : l'app, les fiches déjà chargées et les photos s'ouvrent sans réseau. Les modifications demandent une connexion.
- Coût estimé pour toi seul : environ 1 à 2 € par mois (Claude), le reste est gratuit.
