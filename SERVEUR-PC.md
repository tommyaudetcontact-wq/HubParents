# Hébergement temporaire sur le PC

Le dossier autonome `Brawl-Serveur` sur le Bureau contient le serveur Node, le relais WebSocket et la base SQLite. `DEMARRER.cmd` lance le serveur et le relais HTTPS. `ARRETER.cmd` les arrête. `METTRE-A-JOUR.cmd` télécharge le code public actuel sans modifier les données.

Le lien public du jeu reste GitHub Pages. `config.js` découvre l’adresse du PC dans `server-location.json`, publié au démarrage avec la connexion GitHub déjà enregistrée sur le PC. Aucun compte, jeton de jeu, mot de passe ou contenu de base ne passe dans ce fichier public. Le relais gratuit change d’adresse, ce qui est invisible pour les joueurs qui rechargent le lien habituel.

`local-server/runtime.js` adapte le moteur existant à SQLite. Les actions sont sérialisées dans des transactions; les connexions multijoueurs utilisent des tickets courts obtenus après authentification et conservent les messages signés des joueurs. La base et les sauvegardes ne sont jamais servies comme fichiers web.

En version ville autonome, `data-ville/brawl.sqlite` est la base active. Les comptes sont neufs; aucun ancien profil n’est importé. Le premier démarrage initialise cette base depuis `data-ville/export-initial.json`, un schéma vide avec son propre secret de connexion. `data/brawl.sqlite` conserve séparément l’ancienne plateforme éducative. Une base existante n’est jamais réimportée. Les sauvegardes du jeu vont dans `sauvegardes-ville/`. Les sauvegardes SQLite cohérentes sont prises au démarrage puis toutes les six heures. Les données personnelles restent exclusivement dans le dossier privé sur le PC, pas dans Git.

Sources du paquet : `python scripts/package-local-server.py CHEMIN_DU_DOSSIER`. Node 24 et `ws` sont nécessaires pour préparer le paquet. Le serveur empaqueté contient son propre Node et sa dépendance. Le bouton de mise à jour utilise Python déjà installé sur ce PC. Les fichiers du moteur dans `local-server/engine` sont générés depuis ceux du backend, recréés avec `node scripts/build-local-engine.cjs`; la copie distribuée `backend-engine/` est suivie dans Git; `node local-server/tests.mjs` teste le serveur après préparation.

Le PC doit rester allumé et connecté; le relais gratuit convient à cet hébergement temporaire. Supabase n’est plus utilisé par la configuration du jeu. Sa base existante est conservée comme copie antérieure.


La connexion utilise courriel et mot de passe, puis le choix du personnage. À la création du compte, conserve le code de récupération privé affiché : il permet de remplacer un mot de passe oublié. Aucun service de courriel automatique n’est configuré.

Dans le menu de ville, « Contrôle parental » protège par un code de six chiffres : vocal, invitations, multijoueur, armes/jeux de combat, temps quotidien et heures de repos (Québec). Les limites sont stockées côté serveur et les nouveaux personnages peuvent les hériter. Le premier code exige le mot de passe du compte responsable; changer un code existant exige le code actuel. La récupération du compte avec son code privé réinitialise un code parental oublié.

L’APK signé est sur le Bureau dans `Brawl-Ville-Android/Brawl-Ville.apk`. Son code et ses ressources sont embarqués; le PC reste nécessaire pour les comptes et le multijoueur. `PRODUIRE-NOUVELLE-VERSION.cmd` incrémente la version et place l’APK dans `Brawl-Serveur/releases/`, distribué via `/app/version` et `/app/apk`. Les mises à jour contrôlent taille, empreinte et signature Android. Android demande l’autorisation d’installation. La clé de signature privée reste hors Git dans `.private/android/`, avec une copie privée dans `Brawl-Serveur/cles-android/`. Ne jamais perdre ces clés, ni les publier.


Le compte superutilisateur est accordé par une liste privée d’identifiants de comptes dans le réglage SQLite `CITY_SUPERUSER_PARENTS`, jamais d’après un pseudo ou un champ envoyé par le joueur. Son menu « Superutilisateur · Argent » permet d’ajouter de l’argent ou de fixer son propre solde (0 à 1 milliard). Les opérations sont authentifiées, sérialisées, idempotentes et inscrites dans `admin_money_log`. Les droits sont conservés avec la base SQLite, hors Git.

À partir de l’APK 0.1.2, la vérification automatique se fait aussi toutes les deux minutes au premier plan. L’ouverture et le retour dans l’application déclenchent également une vérification (au plus une par minute). « Plus tard » repousse les rappels de cette version de trente minutes; la vérification manuelle reste disponible. Le PC doit être en marche et Android confirme toujours l’installation.

L’APK 0.1.3 et le web essaient une seconde lecture GitHub si l’adresse publiée est encore en cache ou si l’ancien relais ne répond plus. Seul un serveur HTTPS approuvé et joignable est accepté.
