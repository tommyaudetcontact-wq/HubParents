## Backend Supabase — API 17

Le backend `hubparents` est déployé dans le projet `wodtiksnxpeqiipvpbdv`.
L'export XLSX a été importé dans le schéma privé `brawl_private`, inaccessible
aux rôles clients. Le transfert des secrets est terminé et le site utilise
directement Supabase. L'ancien /exec redirige les clients déjà ouverts.
Sheets et Apps Script sont conservés uniquement comme archives de migration.

Le moteur conserve le protocole parent/enfant et les règles du jeu existants.
L'adaptateur utilise des lignes PostgreSQL indexées et des lectures par plage.
Les écritures d'une action et des échanges sont transactionnelles. Un verrou
transactionnel conserve la sérialisation du backend précédent pendant cette
première migration. Les données restent dans un format compatible avec
l'export Sheets, plutôt qu'un nouveau modèle relationnel métier.

Sources : `supabase/functions/hubparents/`, migrations : `supabase/migrations/`.
Reconstruction : `npm install`, puis `npm run build:backend` et
`npm run test:backend`. Le frontend reste statique, sans compilation.
Le backend peut être déployé avec le connecteur Supabase ou la CLI :
`supabase functions deploy hubparents --project-ref wodtiksnxpeqiipvpbdv`.
La vérification JWT de la passerelle est désactivée car le moteur valide ses
propres sessions parent/enfant avant les actions. Aucune clé administrative
ne doit être placée dans le site.

Le transfert final exige `AUTH_PEPPER` et `CHILD_LOGIN_SALT`, conservés dans
ScriptProperties, absents du XLSX. Le fichier privé produit par
`scripts/prepare-migration-file.py` transfère ces secrets et un export frais,
puis redirige l'ancien `/exec`. Il faut publier cette version Apps Script avant
d'exécuter `migrerVersSupabase`. Le jeton de transfert expire et ne peut servir
qu'une fois. Les exports, jetons et fichiers `.private/` ne sont pas versionnés.

Le contrôle `migrationCheck`, réservé au jeton de transfert avant la bascule,
teste la vraie base dans une transaction toujours annulée. La clé de transfert
est supprimée après finalisation. Les prochaines mises à jour du backend
peuvent se faire directement via Supabase, sans copier du code Apps Script.

## Rendu uniforme et hitboxes corrigées

Éclairage dynamique supprimé, couleurs stables et zones de clic des personnages ajustées à leurs silhouettes. Les meubles restent prioritaires. Voir **RENDU-UNIFORME-HITBOX.md**. Le serveur API 16 actuel reste compatible.

## Quatre nouveaux skins — API 16

Cavalière Grenadine, Virtuose Pastel, Hurleur Carmin et Spectre de Minuit, à 50 $ chacun. Voir **NOUVEAUX-SKINS-COLLECTION.md**. Cette archive contient aussi toutes les corrections de fluidité et de contrôle ci-dessous. Installer le site et le serveur API 16 ensemble.

## Appartement : fluidité, précision et marche — API 16

Rendu haute densité, couches fixes du décor mémorisées, clics sur les faces des meubles, rotations de 90° stables, indicateur réseau, Boutique en bas et marche accélérée. Voir **APPARTEMENT-FLUIDITE.md**. Installer le site et le serveur API 16 ensemble ; les archives sont cumulatives.

## Finitions appartement et placement — API 15

Fond au zoom mémorisé, diamant proportionnel, portes sans poignées, motifs verticaux raccordés aux fenêtres, sol sans joints artificiels marqués, menus regroupés et commandes autour du meuble avec empreinte discrète. Voir **APPARTEMENT-FINITIONS.md**. Correctif du site uniquement si le serveur est déjà en API 15.

## Netteté des gros plans — API 15

Les caches de meubles, sols et motifs suivent la résolution du zoom. Les objets trop grands sont dessinés directement, et les éléments hors écran ne créent pas de cache. Voir **ZOOM-NET.md**. Correctif du site uniquement si le serveur est déjà en API 15.

## Correctifs mobile, zoom et motifs — API 15

Zoom de 0,15× à 12×, pincement à deux doigts aussi en construction, vignettes de motifs, profils à gauche des équipes et arène bornée pendant les attaques. Voir **MOBILE-ZOOM-MOTIFS.md**. Archives cumulatives contenant tous les changements précédents.

## Version actuelle — API 15

Arène : grande carte active, petites réserves, cadres proportionnels, K.O. assombris, coûts visibles, Perce-bouclier à 75 % et bouton Changer de carte avec un léger malus. Voir **ARENE-TACTIQUE.md**. Cette version inclut tous les changements de l’API 14 ; installer directement le site et Apps Script actuels ensemble.

## Grille, peinture et terrain — API 14 (historique)

Grille commune aux dalles, ombres allégées, pincement à deux doigts conservé, peinture avec aperçu et confirmation, 32 harmonies, terrain doublé et déplacement de toute la maison avec ses habitants. Poignée de déplacement sous le doigt, bouton Informations dans l’arène et barres de vie/XP sur les cartes. Voir **GRILLE-PEINTURE-TERRAIN.md**. Mettre à jour le site ET Apps Script ensemble. Les notes précédentes ci-dessous sont historiques.

## Appartement, skins et arène — API 13 (historique)

Appartement adapté à l’écran sans plein écran natif, nouvelles proportions et palettes, achats suivis du placement, sept nouveaux skins et arène mobile avec les deux portraits. Voir **APPARTEMENT-ARENE-SKINS.md** pour les gestes, la migration des placements et l’installation. Mettre à jour le site ET Apps Script ensemble. Les anciennes notes de version ci-dessous restent historiques.

## Portes et navigation — version actuelle API 12

Portes en boutique, battants automatiques au passage et espace réservé pour éviter le chevauchement de la barre basse avec les menus et le HUD. Voir **PORTES-ET-HUD.md**. Remplacer le site ET Apps Script, publier une nouvelle version du déploiement existant ; ne pas réinitialiser la feuille.

## Déplacements et navigation dans la maison

Déplacements fluides, barre de progression au-dessus des personnages pendant leurs actions, navigation basse visible à l’entrée et en plein écran. Voir **DEPLACEMENTS-ACTIONS.md**. Correction du site uniquement ; Apps Script reste en version 11.

## Cartes et retours du PDF

Progression des cartes jusqu’au niveau 30, points attaque/défense/résistance, bots adaptés et échanges conservant la progression : voir **PROGRESSION-CARTES.md**. Vue du dessus, poignées de pièces, retour des meubles à l’inventaire, commandes flottantes, essai avant achat et boutique de style : voir **RETOURS-PDF.md**. Site et Apps Script à remplacer ensemble (API 11).

# Refonte : vie au toucher et séances groupées

Voir **REFONTE-SIMULATION-SESSIONS.md** pour les nouveaux menus, la cuisine, le foyer, les textures, les visages gratuits et les sauvegardes par séance. Mise à jour du site ET d’Apps Script requise, API version 11.

# Nouveaux styles de mobilier et vêtements

Voir **VARIETE-MOBILIER-VETEMENTS.md** : constructions plus variées, finitions bois/inox/pierre/tissu et 40 vêtements féminins supplémentaires. Les fichiers du site et le Code-complet.gs sont à mettre à jour ensemble.

# Mise à jour : visites et notifications

Voir **VISITES-NOTIFICATIONS.md**. Visite en temps réel, besoins du visiteur, édition réservée au propriétaire et demandes centralisées dans le compte. API version 8 ; mise à jour du site ET du déploiement Apps Script nécessaire.

# Brawl Académie — version Mobilier, Prestige et Mobile

Voir **NOUVEAUTES-MOBILIER-PRESTIGE.md** pour les nouveautés et la mise à jour du site et du code Apps Script. 48 familles de modèles, 4 608 variantes, objectifs quotidiens de 20 minutes, niveaux par activité, cadeaux parent paginés et caméra tactile. Compatible GitHub Pages ou lanceur local.

Études de 4e/5e année, tâches maison, cartes Pokémon/Lorcana, maison en simili-3D et duels entre amis. Les fichiers d’origine du Bureau ne sont pas modifiés. Le frontend fonctionne avec le lanceur local ou GitHub Pages ; le backend est votre Google Sheets + Apps Script. Aucune publication externe n’est effectuée par l’agent.

## Thème Aventure

Interface claire : bleu ciel, vert vif pour avancer, jaune pour les récompenses, accents corail et boutons arrondis avec relief. L’accueil montre un renard explorateur original dans un paysage de collines, nuages et étoiles. Parcours, études, cartes, boutiques, arène et commandes de maison suivent cette palette. Les polices utilisent celles de l’appareil ; le nouveau décor SVG est inclus localement et ses mouvements respectent la réduction des animations. Sur téléphone, l’accueil s’organise en une colonne.

## Démarrer

Décompresser toute l’archive puis double-cliquer sur **Lancer.cmd**. Windows ouvre l’application avec un petit serveur de fichiers sur `http://127.0.0.1:4173/` (ou un port voisin occupé). Aucun Node/Python à installer pour ce lanceur. Il ne sert que les fichiers `dist` et écoute seulement cet ordinateur. Les données de démonstration restent dans ce navigateur, avec Alex et Charlie. Ne pas ouvrir seulement le HTML par double-clic : les workers OCR demandent un serveur web.

Le frontend est local mais les images de cartes sont distantes et demandent Internet. Le backend connecté et le lobby demandent Internet. Sur téléphone, servir le même dossier `dist` dans votre environnement web local ; pour WebRTC, le navigateur demande un contexte sécurisé (localhost ou HTTPS). Le lanceur Windows ne rend pas le site automatiquement accessible aux téléphones du réseau.

## Un rythme de cinq études par semaine

- Une bonne réponse donne **8 XP au premier essai**, **4 XP après correction**. L’écriture donne **10 XP par exercice reconnu**, sans plafond de cinq exercices ni de trente réponses. Les études ne donnent pas directement des dollars : elles font avancer les arbres.
- **Arbre quotidien : cinq étapes à 16, 32, 48, 64 et 80 XP**, avec au moins 5, 10, 15, 20 et **20 minutes actives**. Les quatre premières étapes donnent respectivement **1 $, un meuble manquant, une carte, puis 1 $** ; l’ultime donne **10 $ + une nouvelle carte** par défaut.
- **Arbre hebdomadaire : dix étapes, tous les 40 XP**, avec des paliers de temps. L’ultime demande **400 XP, au moins 120 minutes et cinq journées complètes** à 80 XP et 20 minutes chacune. Elle donne **20 $ + trois nouvelles cartes + une activité choisie par le parent** par défaut. L’activité se règle dans Espace parent → Programme d’étude. Elle est conservée parmi les activités gagnées et le parent peut la marquer réalisée. Semaines du lundi au dimanche, fuseau Toronto.
- Le parent règle les activités autorisées, la durée quotidienne (minimum 20 minutes) et les montants ultimes. Les tâches donnent de l’argent après validation du parent et ne remplacent pas les journées d’étude. **Les gains ne sont pas limités à 6 $** ; ce montant concerne les prix des articles.
- Le temps se mesure par signaux d’activité : page visible, activité d’étude ouverte, interaction récente. Une absence ou un grand saut d’horloge n’ajoute pas des heures ; en connexion Sheets, le serveur mesure les intervalles. Ce suivi familial ne prouve pas que l’enfant reste concentré.
- Le parent peut corriger séparément les XP et les minutes de chaque journée. Les XP des tâches restent séparés des XP d’étude.

## Boutique, collection et économie

Le menu Boutiques ouvre trois espaces distincts : **Style et personnalisation**, **Mobilier et bibliothèque**, **Cartes Pokémon et Lorcana**. Un comptoir Famille et soins conserve les compagnons et consommables. Chaque boutique a ses catégories, recherche, tri par nom/prix et filtre possédé/manquant. La boutique Style ouvre aussi le choix des couleurs et éléments équipés.

Tous les articles ont un prix entier de **1 à 6 dollars virtuels** : meubles, livres, skins et cartes. Réparation : 1 $. Agrandissement du terrain : 3, 4, 5 puis 6 $ par taille supplémentaire, jusqu’à 20×20. Aucun paiement réel. Les anciens soldes de démonstration sont convertis une seule fois : 20 anciennes pièces = 1 dollar, arrondi vers le haut ; les anciennes récompenses de tâches sont adaptées.

**27 334 références** sont proposées à l’achat direct : **23 829 Pokémon et 3 505 Lorcana**. Une préférence de collection influence les récompenses, jamais les cartes disponibles en boutique. Recherche par nom/identifiant/extension, catégories, prix, tri par nom ou prix et filtre déjà possédé / pas encore acheté dans toutes les catégories. Pas de doublon dans une collection. Le parent peut aussi offrir toutes les cartes. Voir CATALOGUE.md pour les sources, les langues et les images manquantes ; le catalogue est un instantané, sans promesse des futures extensions.

Collection et sélection du trio paginées par 48 cartes pour les grosses collections. Échanges visuels carte contre carte, accord du destinataire obligatoire. Les BD achetées apparaissent dans la bibliothèque de la maison ; la boutique montre seulement un aperçu du haut de l’image.

## Étudier

Addition, soustraction, multiplication, division : choisir unités, dizaines, centaines ou milliers. Les divisions générées sont exactes, avec un diviseur de 2 à 9. Autres activités : fractions, décimaux, géométrie, problèmes et français. Un cahier tactile permet de poser ses calculs avec crayon, gomme, couleurs, règle, annuler et export PNG ; la réponse est saisie séparément, sans reconnaissance du calcul dessiné.

Dictée de mots : liste hebdomadaire propre à chaque enfant, choisie par le parent. Chaque mot est présenté une fois par session quotidienne, dans l’ordre ; une bonne réponse rapporte des XP, passer un mot ne rapporte rien. La fin de liste est conservée après rechargement ; une nouvelle journée relance la liste. Dictée de chiffres/nombres : 0–9, 0–9 999 et 0–999 999. La synthèse choisit explicitement une voix française, de préférence fr-CA. La lecture attend jusqu’à 1,5 seconde le chargement des voix et exige une voix explicitement française (fr-CA en priorité, sinon une autre voix fr). Sans voix française, aucun son n’est lancé et un message demande d’en activer une. Il n’y a plus de recours à la voix par défaut du navigateur. Le son dépend des voix disponibles et des règles de lecture de l’appareil ; un bouton permet de réécouter.

Écriture libre, sans pointillés : minuscules/majuscules, chiffres et mots détachés, une case par caractère. Reconnaissance de formes avec secours OCR local en trois modes, score, série et répétition des caractères difficiles. **Ce n’est pas une certification de calligraphie** ; les graphies des enfants doivent encore être essayées. Voir ECRITURE.md.

## Maison et amis

Mode vie avec joystick tactile, marche au toucher et besoins. Un **diamant au-dessus de la tête** désigne uniquement le membre contrôlé. Les murs ont tous la même hauteur. Le bouton **Affichage des murs : coupe / auto / tous visibles / repères au sol** change leur présentation : coupe masque uniquement les deux bordures extérieures au premier plan (X = taille du terrain et Y = taille du terrain), conformément au tracé rouge fourni ; les cloisons intérieures restent visibles ; auto diminue leur opacité ; visibles montre tous les murs. L’option **Repères au sol** masque toutes les parois : ligne pleine pour les murs, tirets bleus pour les portes, pointillés turquoise pour les fenêtres. Les collisions restent actives et les repères des portes sont touchables pour traverser. En Décorer, les parois sont visibles sauf si Repères au sol est sélectionné ; on peut alors sélectionner leur ligne pour les peindre. Les pans voisins de même matière sont fusionnés sans contours entre les blocs. Murs, meubles et habitants partagent un ordre de dessin calculé d’après leur position et leur recouvrement à l’écran. Les collisions utilisent le centre réel du personnage et un rayon, contrôlent le segment parcouru et les coins ; le joystick peut glisser le long d’un mur. Une porte laisse passer au centre, son encadrement reste bloquant. Toucher son cadre visible aligne le trajet au centre de l’ouverture et traverse vers l’autre côté. Le joystick et la sauvegarde conservent les positions décimales, sans ramener le membre à la case précédente au relâchement. Les meubles doivent laisser libre le passage des deux côtés. Une paroi invisible ou transparente reste physiquement un mur.

Quatre modes dans la scène, disponibles aussi en plein écran :

- **Vie** : contrôler le membre sélectionné et interagir.
- **Terrain / Construction** : vue du dessus. Onglets Terrain (dessiner, déplacer, redimensionner ou défaire une pièce, agrandir le terrain), Construction (retirer/remettre les murs, portes/fenêtres), Caméra (déplacement, zoom, recentrage). Annuler/rétablir (40 états), sauvegarde et retour au mode vie dans une barre séparée. Les modifications valides sont sauvegardées au fur et à mesure. Un agrandissement payé réinitialise l’historique du plan pour empêcher d’annuler la taille sans annuler le coût. Défaire une pièce conserve ses meubles.
- **Aménager les meubles** : vue standard isométrique, catalogue des meubles possédés, aperçu à déplacer, rotation à 45°, taille de 50 à 200 %, grille ou quarts de case, cliquer sur un emplacement libre pour sauvegarder et désélectionner automatiquement, ou ranger. Ce placement en deux clics fonctionne aussi en construction ; si la case est occupée ou si la sauvegarde échoue, le meuble reste sélectionné. Le catalogue et les commandes restent accessibles en plein écran.
- **Décorer** : vue standard, textures et couleurs de murs/sols. Choisir une matière puis toucher une case de sol ou un mur visible. Une commande peut appliquer la décoration à toute la maison.

Terrain de 7×7 à 20×20, jusqu’à 16 pièces, sans étages. Les collisions de mobilier gardent des empreintes rectangulaires simplifiées, même quand le dessin est tourné. Si l’inventaire est plein ou aucun meuble de récompense ne manque, le cadeau meuble est remplacé par 3 $.

Mobilier classé en 24 catégories, avec 4 608 références de couleurs/styles à partir de modèles simili-3D. Ces références combinent des modèles et palettes ; ce ne sont pas 4 608 sprites uniques. Skins complets et personnalisation par éléments : **20 coupes de cheveux achetables**, 12 têtes, 8 hauts, 6 bas et 6 paires de chaussures. Dans « Personnaliser », choisir les éléments possédés et leurs couleurs (cheveux, peau, haut, bas, chaussures). Les visiteurs voient aussi cette apparence. Les coupes et habits se trouvent dans Boutiques → Style et personnalisation → Cheveux, Têtes, Hauts / chandails, Bas, Souliers ; pour les équiper et recolorer : Appartement → Cheveux et vêtements. Choisir un skin humain conserve la coupe et les habits personnalisés. Si toutes les cartes sont déjà possédées, chaque carte de récompense est remplacée par 3 $ supplémentaires.

La boutique sépare **Animaux, Famille et Soins**. Avant d’adopter un chien, acheter **et placer** un lit pour chien, une gamelle de nourriture et une gamelle d’eau (Boutiques → Famille et soins → Animaux, ou Mobilier). L’adoption est refusée sinon. Accueillir aussi un compagnon ou une compagne, puis éventuellement jusqu’à trois bébés. Les habitants non sélectionnés sont semi-autonomes : un besoin inférieur à 65 % leur fait chercher un meuble adapté et accessible. Ils vont manger, boire pour le chien, se laver, dormir ou jouer. Les repas consomment les réserves achetées ; l’eau de la gamelle reste disponible. Un objet manquant ou une pièce sans passage empêche l’action et affiche un besoin d’aide. Toucher un habitant, ou utiliser « Je contrôle » dans la barre d’état, suspend son autonomie et transfère le joystick et la marche au toucher à ce membre. Sélectionner quelqu’un d’autre réactive ses décisions. Les boutons d’ordre ou le toucher d’un meuble l’envoient réaliser l’action ; le soin est accordé après l’arrivée et une courte activité, jamais au moment de l’ordre. Les bébés utilisent ce même système simplifié, sans simulation réaliste de croissance. Les trousses de soins et la réanimation restent immédiates. Les décisions se calculent par intervalles de cinq secondes et les trajets sont animés dans la scène. Pendant un déplacement manuel au joystick, la synchronisation attend son arrêt. L’évolution est suspendue en construction, en visite et hors de l’appartement. Le personnage, le chien et la famille peuvent mourir virtuellement si faim ou énergie restent critiques ; une **réanimation coûte 6 $ virtuels par membre**. Les besoins diminuent uniquement pendant le jeu actif dans la maison : aucune mort pendant la fermeture de l’application. La mort du personnage bloque ses déplacements jusqu’à la réanimation ; les études restent accessibles pour regagner des dollars. Ce sont des interactions et besoins simplifiés, sans simulation complète de relations ou de croissance.

Le lobby affiche les élèves connectés à **votre même backend**. Les deux élèves ouvrent le lobby, l’un invite, l’autre accepte. Google Sheets transmet la présence et les codes de connexion ; la visite, les positions et les mini-jeux passent ensuite par WebRTC. Invitations de deux minutes, présence expirant après 45 secondes sans signal. Morpion et calcul à deux, sans mise ni récompense d’étude. Une visite à deux à la fois ; le visiteur ne modifie pas la maison du propriétaire. Les codes manuels restent disponibles. Certains réseaux nécessitent un relais TURN : la configuration actuelle fournit uniquement STUN.

## Combat de cartes

Règles familiales Brawl Académie, et non règles officielles Pokémon/Lorcana. Trois cartes de 60 PV chacune ; une grande carte active et deux petites réserves de chaque côté. Énergie initiale 4, maximum 6. Attaque : 16 dégâts, coûte 1 énergie. Pouvoir : 26 dégâts, coûte 3. Percée : 14 dégâts, ignore le bouclier, coûte 2. Protection : bouclier 12 et +2 énergies, jamais deux fois de suite. Préparation : +3 énergies et +6 au prochain coup, non cumulable. Changer de carte utilise le tour et rend 1 énergie à la carte qui sort. Feu > Nature > Eau > Feu : +4 à l’avantage, −4 au désavantage. L’interface détaille base, préparation, affinité, fatigue, bouclier et dégâts finaux. Toutes les raretés ont les mêmes statistiques.

Après un duel comptant au moins quatre actions, les cartes utilisées perdent 8 points d’état. À 75 % ou moins : −2 dégâts ; à 40 % ou moins : −4. Réparer une carte pour 1 $ restaure son état à 100 %. Une répétition de la même fin de duel ne double pas l’usure.

Déplacement des cartes, projectiles, impacts, K.O., dégâts flottants et changements sont animés, avec commandes bloquées durant le coup. Respect du réglage de réduction des animations. Robot ou duel WebRTC par codes ; les deux joueurs doivent utiliser cette même version. Aucun argent gagné/perdu en combat.

## Espace parent

Créer un enfant, supprimer un compte avec confirmation du prénom, modifier prénom, âge facultatif, année, icône, notes, solde, XP, préférences, personnage équipé et besoins. Modifier tâches et leur montant, choisir les mots de chaque semaine, corriger les XP quotidiens. Ajouter/retirer des cartes, meubles ou skins, modifier l’état des cartes, régler le programme et les récompenses, offrir animaux/soins, offrir la collection entière, réinitialiser études/maison et renouveler la clé enfant. Le choix de l’enfant s’applique aussi à sa dictée et sa maison.

En mode connecté, ces opérations demandent une session parent authentifiée par courriel et mot de passe. Plusieurs parents peuvent gérer une famille, et un parent peut rejoindre plusieurs familles sur invitation. Une suppression enfant révoque ses sessions et conserve une copie dans ProfilsArchives. La démo locale est une démonstration, sans protection de sécurité parent.

## Installer ou mettre à jour le backend

Suivre **INSTALLATION-GOOGLE-GITHUB.md**. Code-complet.gs est le fichier unique à coller dans Apps Script ; il remplace les huit modules backend. Une seule mise à jour du déploiement existant est nécessaire pour passer aux comptes. Ensuite : inscription, connexion, ajout d’enfants, invitations de parents, mots de passe et gestion de la famille se font dans l’application. Les nouveaux onglets sont créés automatiquement. La feuille et les données existantes sont conservées.

Le courriel est un identifiant, sans vérification ni courriel automatique de récupération. Conserver le code privé de récupération. Les sessions restent enregistrées sur l’appareil entre les visites, jusqu’à déconnexion, révocation ou suppression des données du site. Le mode enfant ferme la session parent. L’ancienne clé parent sert seulement à rattacher d’anciens enfants, dans le formulaire de migration de l’application.

Les enfants de familles différentes ne figurent pas dans le même répertoire d’échanges/lobby automatique. Les connexions manuelles WebRTC restent disponibles. Les quotas Apps Script/Sheets s’appliquent. Le déploiement réel n’est pas vérifié depuis cet environnement ; les tests utilisent des services Google simulés. La reconnaissance manuscrite n’est pas une preuve inviolable ; voir ECRITURE.md.


## Modèles et personnages — 17 octobre 2026

Voir NOUVEAUTES-MODELES-PERSONNAGES.md : 1 200 modèles, palettes réutilisables, personnages humains redessinés et sauvegarde des looks, corrections Placer/Besoins/Vie et retour immédiat des achats. Livraison vérifiée : 20 suites / 195 groupes ; Canvas natif et DOM/services Google simulés. Aucun test de téléphone ou serveur réel.


## Duels directs — nouvelle livraison

Voir DUELS-PEER-TO-PEER.md : invitation depuis le lobby/arène, signalisation progressive via Apps Script, puis coups et animations en WebRTC. Les profils et l’entretien restent sauvegardés dans Sheets. 23 suites / 210 groupes réussis, dont 15 nouveaux tests de duels ; réseau et WebRTC simulés. Une mise à jour du site et du déploiement Code.gs est nécessaire.


## Connexion, garde-robe, mobilier et codes courts — livraison actuelle

Lire CONNEXION-GARDE-ROBE-MOBILIER.md : connexion persistante, accès enfant par prénom/mot de passe ou code permanent, 24 visages et 68 vêtements/chaussures supplémentaires, mobilier redessiné, aperçus mobiles contenus, panneaux à second clic et invitations à quatre chiffres pour duels/maisons. API version 7. 26 suites / 234 groupes, avec Google et WebRTC simulés.


## Ville, dictées et appartement — 20 octobre 2026

La ville propose sept magasins avec allées adaptées au catalogue, 25 voitures (100 $, luxe 200 $), un garage, une station-service et un terrain de soccer. Déplacements, conduite et soccer utilisent le joystick ou le clavier. Les parties Supabase Realtime accueillent six joueurs, hôte compris ; les changements de lieu suivent l’hôte. L’école prévient avant de fermer la partie pour les cours individuels. Le carburant coûte 1 $ pour 5 minutes ou 2 $ pour 10 minutes de conduite ; le réservoir contient au maximum dix minutes.

Les parents disposent d’une bibliothèque de mots modifiable, archivable et fusionnable, applicable à plusieurs enfants. La dictée prononce chaque mot, donne progressivement ses premières lettres après les erreurs et avance à la réussite. Les majuscules sont acceptées ; les accents restent vérifiés.

L’appartement regroupe les sauvegardes silencieuses, évite les réécritures complètes à chaque seconde et conserve les couches statiques dans des caches recadrés. La cuisine nourrit directement après sa progression. Les poignées de pièce capturent le geste sans déplacer la caméra ; les agrandissements et réductions conservent les finitions des murs et du sol.

Validation : 45 suites historiques, tests supplémentaires de ville/économie/listes, backend asynchrone, messages multijoueurs signés et redimensionnement. Transport Realtime vérifié entre deux connexions réelles. Les tests Canvas et DOM locaux ne constituent pas un essai sur téléphone ni un match complet sur plusieurs appareils.
