## Finitions de l’appartement et placement

Les archives actuelles incluent les optimisations du fond au zoom, les motifs muraux raccordés, les menus réorganisés et les commandes autour des meubles. Remplacer le site ; si le serveur est déjà en API 15, son code reste compatible. Sinon, installer aussi le Code-complet.gs actuel et publier une nouvelle version du déploiement existant. Voir **APPARTEMENT-FINITIONS.md**.

## Netteté des gros plans

Les archives actuelles incluent des caches dont la résolution suit le zoom. Remplacer le site ; si le serveur est déjà en API 15, son code reste compatible. Sinon, installer aussi le Code-complet.gs actuel et publier une nouvelle version du déploiement existant. Voir **ZOOM-NET.md**.

## Correctifs mobile, zoom et motifs

Les archives incluent le zoom étendu, les choix de motifs illustrés et les corrections de disposition de l’arène. Le serveur reste en API 15 : si cette version est déjà installée, seul le site doit être remplacé. Sinon, installer directement les deux archives actuelles, sans passer par les versions précédentes. Voir **MOBILE-ZOOM-MOTIFS.md**.

## Arène tactique — API 15

Installer directement les archives actuelles du site et Apps Script : elles contiennent aussi tous les correctifs précédents non installés. Remplacer **Code-complet.gs** puis publier une nouvelle version du déploiement existant ; `/exec` doit annoncer **version 15**. Ne pas réinitialiser les données. Les deux joueurs doivent utiliser le nouveau site pour les duels (protocole 5). Voir **ARENE-TACTIQUE.md**.

## Grille, peinture et terrain — API 14

Remplacer le site et **Code-complet.gs** ensemble, puis publier une nouvelle version du déploiement existant. `/exec` doit annoncer **version 15**. Le terrain est doublé à l’entrée sans perdre les achats ; ne pas réinitialiser la feuille. Voir **GRILLE-PEINTURE-TERRAIN.md** dans l’archive complète.

## Appartement, skins et arène — API version 15

Installer le site et Code-complet.gs ensemble, puis publier une nouvelle version Apps Script. Le statut /exec doit annoncer version 15. La migration des dimensions se fait à l’entrée dans la maison ; les achats restent conservés. Ne pas réinitialiser la feuille. Voir APPARTEMENT-ARENE-SKINS.md dans l’archive complète.

## Portes et menus — API version 15

Installer le site et Code-complet.gs ensemble, puis publier une nouvelle version Apps Script. Le statut /exec doit annoncer version 15. Ne pas réinitialiser la feuille. Voir PORTES-ET-HUD.md dans l’archive complète.

## Refonte séances et maison — API version 15

Remplacer le site et le **Code-complet.gs**, puis publier une nouvelle version du déploiement existant. Le statut /exec indique **version: 15**, **batches: true**, **visits: true** et **notifications: true**. Aucune remise à zéro de la feuille. Voir **REFONTE-SIMULATION-SESSIONS.md** dans l’archive complète.

## Mise à jour du 17 octobre : visites et notifications

Installe le nouveau site et le nouveau **Code-complet.gs**, puis publie une nouvelle version du déploiement Apps Script existant. Le statut /exec doit indiquer **version: 15**, **visits: true** et **notifications: true**. Aucune colonne ni compte à recréer ; ne réinitialise pas ta feuille. Voir **VISITES-NOTIFICATIONS.md** dans l’archive complète.

Pour la nouvelle refonte, lire aussi **NOUVEAUTES-MOBILIER-PRESTIGE.md**.

# Comptes parents et familles — mise à jour

## Tu as déjà installé Apps Script : une dernière mise à jour

1. Dans Apps Script, remplace TOUT le contenu de Code.gs par le nouveau **Code-complet.gs**. Ce fichier unique contient aussi Auth.gs et les règles du jeu. Ne conserve pas en parallèle les modules séparés qui définissent les mêmes fonctions. Si tu utilisais la variante modulaire, remplace les huit fichiers du dossier backend, dont le nouveau Auth.gs.
2. Enregistre. Dans **Déployer > Gérer les déploiements > crayon**, choisis **Nouvelle version**, puis **Déployer**. Exécution en tant que **Moi**, accès **Tout le monde**, sans connexion Google requise. Mets à jour le déploiement existant pour garder ton URL /exec.
3. Remplace les fichiers de ton site GitHub par le contenu décompressé de **Brawl-Academie-GitHub-Pages.zip**. index.html reste directement à la racine. Attends la publication, puis actualise la page (Ctrl+F5 sur ordinateur).
4. Ouvre **Espace parent > Créer mon compte parent**. Entre ton prénom, ton courriel, le nom de ta famille et un mot de passe d’au moins 12 caractères.

Puisque initializeBrawl a déjà été exécuté sur ta feuille, **tu n’as pas besoin de le relancer**. Les huit onglets des comptes s’ajoutent automatiquement à la première requête de connexion/inscription. Les onglets et données existants restent en place. Pour une toute nouvelle feuille seulement : crée son script depuis Extensions > Apps Script et exécute initializeBrawl une fois avant le déploiement.

L’URL publique fournie est déjà dans config.js. Si tu crées un NOUVEAU déploiement plutôt que de mettre à jour l’existant, il faut remplacer cette URL dans config.js. Le fichier Code.gs reste dans Google Apps Script ; publie uniquement les fichiers du ZIP GitHub Pages sur GitHub.

## Ensuite, toute la gestion se fait dans l’application

- **Ajouter un enfant** : prénom et année scolaire. Aucun identifiant technique ni clé à copier. Sélectionne ensuite son compte pour modifier ses informations, études, dictées, tâches, récompenses, inventaire et maison.
- **Jouer avec un enfant** : bouton Jouer avec [prénom]. La session parent est fermée et remplacée par une session enfant sans droits parent. Pour revenir à la gestion, reconnecte-toi avec ton mot de passe.
- **Connecter un autre appareil** : génère un code depuis le compte de l’enfant. Sur son appareil, ouvre Espace parent/famille > Connexion enfant et saisis le code. Usage unique, valable 10 minutes. Une session enfant dure au maximum 7 jours ; demande ensuite un nouveau code dans l’application.
- **Ajouter un autre parent** : dans Ma famille et mon compte, saisis son courriel puis Créer une invitation. Transmets-lui le code affiché. Cette personne crée son compte avec ce courriel et le code d’invitation, ou utilise Rejoindre une autre famille si elle a déjà un compte. Les invitations expirent après 7 jours ; tu peux les annuler.
- **Plusieurs familles** : un parent peut appartenir à plusieurs familles, avec un sélecteur dans Ma famille et mon compte. Les enfants et réglages restent séparés. Chaque parent associé peut gérer les enfants et inviter/retirer d’autres parents. Une famille doit conserver au moins un parent.
- **Mot de passe oublié** : utilise le code de récupération remis à l’inscription. Tu peux renouveler ce code depuis ton compte. Le mot de passe peut être changé dans l’application ; cette modification ferme les anciennes sessions parent.
- **Anciens enfants** : si tu avais déjà créé des profils dans l’ancienne version, ouvre Récupérer les enfants de l’ancienne version et saisis l’ancienne clé parent une seule fois. Ils seront rattachés à ta famille. Ils ne sont jamais attribués automatiquement au premier inscrit. Si aucun enfant n’avait été créé dans le Sheet, ignore cette option. Les profils de démo du navigateur ne sont pas importés.

Le courriel sert d’identifiant : il n’y a pas encore de vérification du courriel ni d’envoi automatique d’invitations ou de réinitialisation par courriel. Les invitations sont des codes à transmettre et la récupération utilise le code privé. Garde ce code à l’abri ; l’application n’affiche pas les mots de passe des parents.

## Hébergement et contrôles

GitHub Pages : Settings > Pages > Deploy from a branch > main > /(root) > Save. Décompresse le ZIP avant l’envoi avec Add file > Upload files ; garde les dossiers assets/vendor et .nojekyll.

Le Sheet reste privé. Les nouveaux onglets sont Parents, Familles, ParentsFamilles, EnfantsFamilles, Sessions, InvitationsParents et ConnexionsEnfants, en plus des sept onglets du jeu. Les jetons, invitations et codes de récupération sont stockés sous forme de hachages. Les mots de passe sont dérivés dans le navigateur avec PBKDF2-SHA256 (600 000 tours, sel aléatoire), puis protégés côté serveur par un HMAC et un secret conservé dans ScriptProperties. Les preuves de connexion ne sont jamais placées dans les exports des enfants.

Le serveur vérifie la famille à chaque demande : enfants, réglages, échanges et lobby. Pour cette version, les répertoires d’échanges et le lobby automatique sont limités aux enfants de la même famille. Les duels et visites par codes WebRTC restent disponibles. La plateforme reste dépendante des quotas Google Sheets/Apps Script ; ce n’est pas une infrastructure prévue pour un grand site public.

Ouvre ton URL /exec : le statut de cette version comporte **version: 15** et **accounts: true**. Si l’application annonce encore une ancienne version, vérifie que tu as publié une Nouvelle version et remplacé les fichiers GitHub. Aucune clé de connexion ne doit être publiée dans config.js.

Teste ensuite : inscription de deux familles, ajout d’un enfant, connexion d’un second parent invité, modification d’une dictée, connexion enfant, exercice et rechargement. Le développement a été vérifié avec une simulation de Google et des formulaires ; le déploiement réel fourni n’a pas pu être joint depuis cet environnement. La publication Google et GitHub reste à effectuer par toi.

Documentation : https://developers.google.com/apps-script/guides/web ; https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site ; https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html


Mise à jour mobilier et personnages : utiliser ensemble le nouveau ZIP GitHub Pages et le nouveau Code-complet.gs. Les palettes et les 1 200 nouveaux modèles exigent les mêmes règles dans le navigateur et Apps Script.


Duels automatiques : le nouveau Code-complet.gs annonce API version 6 / duels:true. Remplacer le script et redéployer une nouvelle version du déploiement existant ; l’onglet Duels sera ajouté automatiquement, sans réinitialisation. Lire DUELS-PEER-TO-PEER.md dans le projet complet.


Livraison actuelle : version 7, childLogin:true et shortCodes:true. Mettre à jour ensemble le ZIP GitHub et Code-complet.gs, puis redéployer la nouvelle version. AccesEnfants est créé automatiquement. Dans Espace parent, ouvrir l’enfant puis la section « Prénom, mot de passe et code d’accès » ; aucun réglage par enfant n’est nécessaire dans Apps Script. Les sessions sont maintenant persistantes dans les données du navigateur, contrairement aux anciennes sections de ce guide décrivant sept jours/une session d’onglet. Voir CONNEXION-GARDE-ROBE-MOBILIER.md pour les parcours actuels et les codes amis à quatre chiffres.
