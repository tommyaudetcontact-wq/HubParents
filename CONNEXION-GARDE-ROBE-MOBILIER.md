# Connexion, personnages, mobilier et rencontres

## Installer cette livraison

Remplacer le site par le contenu décompressé de **Brawl-Academie-GitHub-Pages.zip**. Remplacer tout Code.gs par le nouveau **Code-complet.gs**, enregistrer puis déployer une **nouvelle version du déploiement existant**. Le site et le backend doivent être mis à jour ensemble. Le statut public indique version 7, childLogin:true et shortCodes:true.

Ne pas relancer initializeBrawl sur une feuille déjà initialisée. L’onglet **AccesEnfants** est créé automatiquement. Les profils et possessions restent conservés. Les anciens codes d’appareil temporaires restent utilisables pendant leurs dix minutes de validité.

## Connexion au démarrage et aux prochaines visites

Sans connexion enregistrée, le jeu s’ouvre sur la page **Connexion enfant / Compte parent**, même si l’adresse contient un ancien lien vers Accueil. La démo locale reste accessible explicitement depuis cette page.

Les sessions parent et enfant sont enregistrées dans les données locales du navigateur et restent actives entre les visites, sans expiration automatique au bout de sept jours. Un profil enfant déjà enregistré peut s’afficher depuis son cache local puis se réactualise auprès de Google. Les requêtes au serveur restent authentifiées. Déconnexion, suppression des données du site, suppression du compte, réinitialisation du mot de passe ou remplacement des accès peuvent terminer la connexion. Un ancien jeton déjà expiré demande une première reconnexion après cette mise à jour.

Le cache HTTP et les données locales du site sont distincts : vider uniquement les images/fichiers en cache ne supprime pas les sessions ; effacer les **données du site** les supprime. Aucun mot de passe n’est conservé dans le navigateur.

Dans **Espace parent > enfant > Prénom, mot de passe et code d’accès**, définir un mot de passe enfant (6 à 128 caractères) et/ou générer un code permanent. Le prénom est celui du profil, sans identifiant technique supplémentaire. L’enfant peut entrer **prénom + mot de passe**, ou ouvrir **J’utilise mon code d’accès**. Les accents et la casse du prénom n’empêchent pas la connexion.

Si plusieurs enfants portent le même prénom et utilisent le même mot de passe, le jeu demande de choisir la famille après vérification du mot de passe. Un changement de prénom conserve les accès. Le code permanent reste valable jusqu’à son remplacement ; sa valeur n’est affichée qu’à sa création. Le parent peut toujours en générer un nouveau. Changer les accès révoque les sessions enfant existantes. Le passage au mode enfant déconnecte le parent.

Les mots de passe sont dérivés dans le navigateur (PBKDF2 SHA-256, 600 000 tours), puis les preuves sont hachées avec un secret serveur et l’identifiant de l’enfant. Les codes et jetons ne sont pas stockés en clair dans Sheets. Les parents gardent leurs règles de mot de passe et de récupération existantes.

## Mon personnage et la boutique de vêtements

Un accès **Mon personnage** est ajouté au menu. Choisir **Personnaliser mon personnage** pour modifier présentation masculine, féminine ou tous les styles, visage, coupe, haut, bas et chaussures. Peau, cheveux, haut, bas et chaussures ont des couleurs indépendantes.

24 visages humains supplémentaires (12 masculins et 12 féminins), 32 hauts, 20 bas et 16 paires de chaussures supplémentaires. Les 20 coiffures et les anciennes pièces sont conservées. Les vêtements supplémentaires doivent être achetés ou offerts par le parent ; les couleurs restent libres. La boutique Style possède un filtre masculin/féminin/mixte, initialisé depuis la présentation du personnage. Les pièces mixtes restent disponibles.

Les tenues ont des coupes et détails différenciés : polos, chemises, pulls col V/roulé, vestes en jean, bombers, blazers, gilets, robes, tuniques, pantalons cargo, shorts, jupes, salopettes, baskets et bottes. Les visages et chaque pièce d’une catégorie/présentation ont été comparés par rendu Canvas réel pour éviter les duplications visuelles.

Référence fournie par le parent : https://sims2defaults.dreamwidth.org/ . Cette page n’a pas pu être chargée par l’outil de recherche (expiration/cache indisponible). Aucun sprite ni fichier de ce site n’a été importé. Les illustrations de vêtements sont originales, dans l’esprit des tenues quotidiennes des Sims 2 ; aucune reproduction exacte de ce catalogue inaccessible n’est revendiquée.

## Mobilier

Les formes ont été reprises pour supprimer les structures arbitraires autour des objets. Lits avec véritables pieds et tête à lattes, panneaux de teck, métal, capitonnage ou baldaquin ; canapés avec assises, dossiers et accoudoirs cohérents ; aquariums fermés sur buffets, tiroirs, portes ou supports ; bureaux, armoires, commodes et bibliothèques reconstruits selon leur fonction. Les autres appareils conservent leur forme reconnaissable avec des déclinaisons de proportions, sans cadres ou poteaux ajoutés au hasard.

Les 25 déclinaisons par type et les anciennes possessions restent présentes ; les identifiants des articles ne changent pas. Toutes les déclinaisons ne prétendent pas reproduire 25 objets officiels différents des Sims : une partie varie les proportions et les constructions d’une même famille. Les palettes et couleurs manuelles restent disponibles à l’achat et dans Décorer. Les noms ont été ajustés au nouveau dessin.

Références consultées : [catégorie Objets des Sims 2](https://sims.fandom.com/wiki/Category:Objects_in_The_Sims_2), [sièges des Sims 2](https://sims.fandom.com/wiki/List_of_seating_(The_Sims_2)), [aquariums](https://sims.fandom.com/wiki/Aquarium), [lits](https://sims.fandom.com/wiki/Bed). Les dessins restent ceux du jeu, et non des sprites extraits des Sims.

## Mobile et panneaux

Les aperçus d’objets, vêtements et cartes gardent leur ratio et sont contenus entièrement dans leur vignette, avec une hauteur réduite sur téléphone. Les BD gardent volontairement leur aperçu partiel demandé précédemment.

**Vie** : premier clic ouvre les commandes/besoins, deuxième clic les réduit, troisième les rouvre. Le même principe ferme/rouvre les panneaux Construction, Aménager et Décorer quand leur mode est déjà sélectionné. Le mode de jeu reste sélectionné. Les petites jauges d’état restent disponibles lorsque les besoins sont réduits.

## Rejoindre un ami avec quatre chiffres

**Créer un duel** génère un code à **4 chiffres**, valable trois minutes. L’ami clique **Rejoindre** et saisit ce code. Dans l’appartement, **Inviter un ami** génère le même type de code pour une visite de maison ; **Visiter un ami** affiche la saisie à quatre chiffres. Le code conserve son zéro initial, le cas échéant.

Les deux joueurs doivent être connectés à leurs profils et garder le jeu ouvert. Pour un ami d’une autre famille, l’hôte voit son prénom et clique **Accepter cet ami** avant que la description réseau soit fournie. Dans la même famille, la connexion peut commencer directement. Les codes sont temporaires et réservés au premier invité ; les collisions sont évitées et les essais sont limités. Aucun long code WebRTC n’est nécessaire dans ces parcours.

Une fois connectés, coups, positions et mini-jeux passent directement en WebRTC. Les comptes, autorisations, possessions et sauvegardes restent dans Google. Certains réseaux nécessitent toujours un relais TURN ; cette livraison n’ajoute aucun service externe obligatoire. Les invitations directes du lobby restent disponibles.

## Lectures de la feuille Google

La connexion à la feuille et les lectures d’authentification sont réutilisées au sein d’une requête. La structure des onglets de comptes n’est plus revérifiée en entier à chaque action. Une consultation enfant lit sa ligne de profil, avec un index de ligne en cache vérifié contre l’identifiant pour éviter un mauvais compte après suppression. Les gros profils nouvellement enregistrés indiquent la plage exacte de fragments à relire ; les anciens pointeurs restent compatibles. Le lobby utilise uniquement identifiant/prénom/année.

Ces optimisations réduisent les lectures et volumes transférés dans Apps Script ; elles ne constituent pas une mesure du temps réel de Google ou du réseau du parent.

## Validation

26 suites, **234 groupes** : règles existantes, accès enfant, familles avec prénoms identiques, codes permanents, sessions après plusieurs mois, nouvelle visite sans sessionStorage, révocation, lectures ciblées, gros profils, formes et couleurs, 24 nouveaux visages et vêtements distincts, panneaux, codes à quatre chiffres et rencontres entre familles.

Un duel entier et une visite de maison ont été exécutés entre deux clients avec WebRTC et Google simulés, sans appel Sheets par coup ou déplacement. Les planches de lits, aquariums, visages et vêtements ont été produites par le vrai moteur Canvas et inspectées. Aucun navigateur réel, téléphone physique, publication GitHub ni redéploiement Google n’a été utilisé pour valider cette livraison.
