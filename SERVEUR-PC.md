# Hébergement temporaire sur le PC

Le dossier autonome `Brawl-Serveur` sur le Bureau contient le serveur Node, le relais WebSocket et la base SQLite. `DEMARRER.cmd` lance le serveur et le relais HTTPS. `ARRETER.cmd` les arrête. `METTRE-A-JOUR.cmd` télécharge le code public actuel sans modifier les données.

Le lien public du jeu reste GitHub Pages. `config.js` découvre l’adresse du PC dans `server-location.json`, publié au démarrage avec la connexion GitHub déjà enregistrée sur le PC. Aucun compte, jeton de jeu, mot de passe ou contenu de base ne passe dans ce fichier public. Le relais gratuit change d’adresse, ce qui est invisible pour les joueurs qui rechargent le lien habituel.

`local-server/runtime.js` adapte le moteur existant à SQLite. Les actions sont sérialisées dans des transactions; les connexions multijoueurs utilisent des tickets courts obtenus après authentification et conservent les messages signés des joueurs. La base et les sauvegardes ne sont jamais servies comme fichiers web.

`data/brawl.sqlite` est la base active. Le premier démarrage importe seulement une base vide depuis `data/export-initial.json`. Une base existante n’est jamais réimportée. Les sauvegardes SQLite cohérentes sont prises au démarrage puis toutes les six heures. Les données personnelles restent exclusivement dans le dossier privé sur le PC, pas dans Git.

Sources du paquet : `python scripts/package-local-server.py CHEMIN_DU_DOSSIER`. Node 24 et `ws` sont nécessaires pour préparer le paquet. Le serveur empaqueté contient son propre Node et sa dépendance. Le bouton de mise à jour utilise Python déjà installé sur ce PC. Les fichiers du moteur dans `local-server/engine` sont générés depuis ceux du backend, exclus de Git; `node local-server/tests.mjs` teste le serveur après préparation.

Le PC doit rester allumé et connecté; le relais gratuit convient à cet hébergement temporaire. Supabase n’est plus utilisé par la configuration du jeu. Sa base existante est conservée comme copie antérieure.
