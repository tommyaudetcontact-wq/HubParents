## Finitions appartement — 19 octobre 2026

42 suites et 391 groupes réussis. Huit nouveaux groupes couvrent les commandes sans recouvrement du meuble, le diamant, la continuité des motifs, les raccords de dalles, les menus et le fond de gros plan réutilisé. Canvas natif et interfaces simulées ; aucune mesure sur téléphone réel. Voir **APPARTEMENT-FINITIONS.md**.

## Netteté au zoom — 19 octobre 2026

41 suites et 383 groupes réussis. `zoom-render-tests.cjs` vérifie les vrais pixels supplémentaires à 4×, le dessin direct à 12×, la réutilisation des caches, leurs limites mémoire et le retrait des objets hors écran. Gros plans contrôlés sur Canvas natif ; aucune mesure sur téléphone réel. Voir **ZOOM-NET.md**.

## Mobile, zoom et motifs — 19 octobre 2026

40 suites et 378 groupes réussis. La nouvelle suite `mobile-visual-tests.cjs` couvre la plage de zoom, le pincement en construction, les 48 vignettes rendues sur Canvas natif, le choix sans sauvegarde, les profils près des cartes et les effets isolés de la grille pendant les attaques. DOM et services simulés ; aucune vérification sur téléphone réel.

## Arène tactique — 19 octobre 2026

39 suites et 371 groupes réussis. La nouvelle suite `arena-tactics-tests.cjs` couvre les deux issues de Perce-bouclier, 10 000 tirages (7 527 succès), le malus de changement, les remplacements gratuits après K.O., les cadres proportionnels, les coûts visibles et le rejeu partagé avec le serveur. Les échanges, comptes, progression, appartement et protocoles de duel restent vérifiés. DOM et pairs simulés, Canvas natif ; aucun contrôle sur téléphone réel.

## Correctifs grille, peinture et terrain — 19 octobre 2026

38 suites et 362 groupes réussis. Nouvelle suite `house-corrections-tests.cjs` : migration 7 → 14 et 20 → 40, rejouabilité, déplacement de la maison et de ses habitants, échelle cohérente, rectangle de peinture sans sauvegarde prématurée, annulation intégrale, confirmation unique, absence de motif, zoom à deux doigts pendant la peinture, projection affine des murs et caches de rendu. Une suite arène vérifie les valeurs de vie/XP des six cartes, le niveau maximum, les règles des actions et l’ouverture des informations sans jouer de coup. La poignée de meuble est testée pour suivre le doigt avec un dégagement et rester aimantée à la grille. Syntaxe de tous les modules vérifiée. DOM, Google et WebRTC simulés, Canvas natif ; aucune mesure sur téléphone réel. Détails : **GRILLE-PEINTURE-TERRAIN.md**.

## Appartement, skins et arène — version 13

17 groupes dans refinements-tests.cjs, deux parcours supplémentaires dans sim-ui-tests.cjs : achat → placement → boutique, inventaire → Bain → placement → Bain avec défilement conservé. 36 suites et 345 groupes passent. Portraits P2P et Canvas natif vérifiés ; mise en page mobile non vérifiée dans un vrai navigateur ou sur téléphone. Voir APPARTEMENT-ARENE-SKINS.md.

## Portes et séparation de la navigation

9 groupes dans doors-nav-tests.cjs et parcours complet supplémentaire dans sim-ui-tests.cjs. API 12, portes classiques et trois modèles achetables, battants animés. Menus/HUD fixés au même viewport et bornés au-dessus de la navigation ; panneaux défilants. Rendu Canvas natif inspecté. Tests simulés ; aucun vrai navigateur ni téléphone. Voir PORTES-ET-HUD.md.

## Déplacements et barre d’action

7 groupes supplémentaires dans actor-animation-tests.cjs. Navigation basse fixée au viewport et ancien menu supérieur caché en plein écran. Vérification automatisée uniquement ; essai sur téléphone réel restant. Voir DEPLACEMENTS-ACTIONS.md.

## Cartes et retours du PDF

Progression (12 groupes) et retours PDF (8 groupes) vérifiés. API version 11. Essais DOM/Google/WebRTC simulés et rendu Canvas natif ; aucune validation sur téléphone réel ni déploiement.

Voir aussi **MENUS-PORTRAIT-COLLECTION-SIGNATURE.md** pour les menus portrait et les nouveaux skins à 50 $.

# Validation de la refonte simulation et séances

36 suites, 345 groupes automatisés ; tests supplémentaires dans sim-tests.cjs (12), sim-ui-tests.cjs (18) et sim-render-tests.cjs (11). Moteur Canvas natif inspecté : coiffures, raccords, visages, 33 motifs de sol et éclairage. Services Google, DOM et WebRTC simulés, pas de vrai navigateur mobile. Voir **REFONTE-SIMULATION-SESSIONS.md**.

## Révision mobilier et vêtements

25 géométries par type vérifiées sans tenir compte des couleurs ni du matériau ; 40 vêtements féminins ajoutés et vérifiés au rendu. Planches de douches, meubles et garde-robe générées avec Canvas natif puis inspectées visuellement. Voir **VARIETE-MOBILIER-VETEMENTS.md**.

# Validation actuelle — 17 octobre 2026

28 suites, 251 groupes réussis ; syntaxe de tous les modules frontend vérifiée. Voir **VISITES-NOTIFICATIONS.md** pour les contrôles ajoutés et les limites de validation. Services Google, DOM et WebRTC simulés ; essai réel à deux appareils restant après publication.

## Historique des vérifications

# Validation de la livraison du 15 octobre 2026

## Tests automatisés : 138 groupes

- tests.cjs : 32 groupes, règles partagées local/Apps Script, arbres et idempotence, économie, parent, achats, échanges, stockage fragmenté de la collection complète et signalisation du lobby avec services Google simulés. Rendu Canvas des 2 304 références de meubles et des skins, sans observation visuelle. 400 duels simulés.
- handwriting-tests.cjs : 12 groupes sur des tracés synthétiques, déplacements, tailles, mots par cases, points/accents et refus d’autres caractères.
- combat-tests.cjs : 8 groupes, percée/préparation, protections, K.O., blocage des doubles actions et 500 duels calculés de façon identique sur deux états ; configuration OCR avec lecteur simulé.
- feature-tests.cjs : 9 groupes, prix du catalogue, achat malgré la préférence, rythme de cinq journées, XP d’étude séparés des tâches, migration économique unique, opérations mathématiques par grandeur, gestion parent, rotation géométrique, morpion déterministe et sélection de voix française.
- interface-tests.cjs : 8 groupes avec DOM simulé. Douze routes sans erreur de démarrage, enfant choisi appliqué à sa dictée, verrouillage parent et pagination de 48 cartes avec une collection complète. Tri et filtres possédé/manquant de la boutique, affichage des trois cartes et de l’activité gagnée. Ces tests ne remplacent pas un navigateur réel.
- revision-tests.cjs : 16 groupes : accents et graphies indépendantes, confirmation/passage à 600 ms, temps actif 25 minutes, programme parent, dictée complète, énergie et détail des dégâts, entretien, 20 coupes et couleurs, achats familiaux, soins/décès/réanimation, placement à 45° et matériaux ciblés, compatibilité des cheveux avec les skins humains, ultime hebdomadaire à trois cartes/20 $/activité et récupération sans doublon.

- home-tests.cjs : 15 groupes, accessoires placés avant adoption, autonomie et réserves, contrôle exclusif et reprise, ordres et trajets, besoins du partenaire, murs et chemins, absence de rattrapage hors ligne, dessin/déplacement/redimensionnement de pièces en vue du dessus, retrait/remise de murs, suppression/annulation/rétablissement, caméra et contrôle du membre sélectionné. API maison aussi vérifiée avec les services Google simulés.

- layout-tests.cjs : 8 groupes : collisions centrées et diagonales, portes/encadrements/murs retirés, récompenses quotidiennes variées, terrain jusqu’à 20×20, hauteur uniforme et opacité des murs, diamant unique, modes construction/meubles séparés, rotation et sélection des surfaces à décorer. L’interface simulée couvre aussi les boutiques séparées, les quatre modes et la confirmation d’un meuble gagné.

- polish-tests.cjs : 10 groupes, fusion sans contours des murs identiques, meuble devant/derrière un mur, coupe caméra à opacité zéro, accents courts/décentrés, circonflexes séparés sur i/I, mauvaise casse non validée par OCR, lettres penchées indépendantes, confiance OCR minimale et interruptions vocales sans fausse alerte ni boucle.

- door-tests.cjs : 9 groupes : seuls les deux bords extérieurs du tracé rouge sont masqués, portes verticales/horizontales dans les deux sens, positions décimales conservées après relâchement, murs et fenêtres toujours bloquants, parcours au centre de la porte, meubles bloquants, boucle réelle du contrôleur de joystick avec événements et animation simulés, toucher du cadre visible, suppression des diamants automatiques des personnages non sélectionnés.

- voice-tests.cjs : 4 groupes : voix fr explicite avec préférence canadienne, aucune lecture avec seulement une voix anglaise, attente des voix retardées et annulation pendant cette attente.
- view-tests.cjs : 7 groupes : toutes les parois masquées avec repères distincts, porte et mur sélectionnables au sol, collisions préservées, placement/désélection automatique en construction et vue standard, emplacement occupé et échec de sauvegarde conservant la sélection.

Syntaxe de tous les JS principaux vérifiée. Domain.gs contient exactement cards-data.js + domain.js + parent-domain.js + appearance-domain.js + household-domain.js. Handwriting.gs utilise le même moteur de formes que le frontend. L’archive est relue, contrôlée sans doublons et comparée octet par octet aux fichiers livrés ; aucun dossier Git, donnée de déploiement ou outil de travail n’y figure.

## Vérifications précédentes réutilisées

Le vrai runtime Tesseract.js sous Node avec le modèle français local a lu les images typographiques « a », « é » et « 7 ». Cela ne mesure pas la fiabilité sur l’écriture d’enfants. Les outils Node résolvent leur propre module core ; le worker navigateur n’a pas été observé dans cette livraison.

Le lanceur PowerShell a servi la page et le fichier WASM en HTTP 200 avec le type application/wasm. Le serveur temporaire a été arrêté. Le lanceur ne demande aucune installation Node/Python.

## Limites et essais avec la famille

Aucun Google Sheets réel ni Apps Script n’a été créé/déployé : le parent le fera après livraison. Le lobby et ses invitations sont testés sur une simulation, pas en réseau réel avec Google. Faire ensuite un essai avec deux profils, deux appareils et votre déploiement. WebRTC peut nécessiter TURN selon les réseaux ; seul STUN est configuré.

L’accès automatique au navigateur avait été refusé par sa politique. Ce refus n’a pas été contourné : les planches du moteur Canvas ont été inspectées, mais l’interface complète n’a pas été validée dans un vrai navigateur et aucun essai physique sur téléphone n’a été effectué.

La reconnaissance manuscrite peut se tromper dans les deux sens. Aucun taux de fiabilité sur les graphies des enfants n’est établi. Apps Script ne refait pas l’OCR et fait confiance aux résultats déclarés du navigateur, tout en refaisant le contrôle géométrique et les limites. Voir ECRITURE.md.

Le catalogue contient 27 334 références, sans promesse de toutes les langues ou futures sorties. Les images sont distantes ; 1 801 références n’ont pas d’image connue dans l’instantané et utilisent un symbole. Les 2 304 meubles combinent modèles/styles/palettes : ce ne sont pas autant de sprites uniques. Textures et couleurs globales ou ciblées par mur/case ; terrain 20×20 maximum et aucun étage.

Les fragments de grandes collections et archives parent sont conservés sans nettoyage automatique. Les démos et anciens classeurs ne sont pas migrés vers Google automatiquement ; seule la conversion des anciens soldes du format de démo de cette application est automatique et unique.

## Refonte visuelle du 16 octobre 2026

Thème Adventure chargé après les styles existants, illustration SVG originale locale et typographie système. L’assemblage des écrans avec DOM simulé est repassé après les changements. Les tests de maison vérifient aussi le dessin sans erreur après les changements de couleurs du terrain. La syntaxe JavaScript et XML des illustrations est vérifiée. Aucun nouveau test de règles n’est ajouté pour ces changements visuels. La palette et la mise en page mobile n’ont pas été observées dans un vrai navigateur dans cette session ; l’ancien refus d’accès n’est pas contourné.


## Préparation Google Sheets et GitHub Pages

Sept groupes de tests supplémentaires dans backend-install-tests.cjs : fichier GS unique identique aux six modules, installation d’une feuille vierge, réinstallation non destructive, onglets vides/incompatibles, refus de changer de base silencieusement, premier compte créé par le parent puis connecté, configuration publique et chemins GitHub Pages relatifs. Les 32 groupes API/règles et les 8 groupes d’assemblage interface sont repassés après ces changements.

Le déploiement /exec fourni par le parent n’a pas pu être joint depuis cet environnement (outil Web inaccessible, résolution réseau indisponible). Aucune modification réelle de Google Sheets ou du déploiement, aucun test réseau CORS en navigateur ni publication GitHub n’a été réalisé. Le guide décrit les contrôles à effectuer après collage et déploiement.


## Comptes parents et familles

18 groupes dans auth-tests.cjs : inscription, mots de passe dérivés, secrets hachés, familles isolées, ajout d’enfants sans clé, refus des accès croisés, invitations ciblées/uniques/annulées/expirées, plusieurs parents et familles, retrait d’un parent, sessions enfant limitées, déconnexion, expiration, changement/récupération de mot de passe, suppression enfant et limitation des tentatives. La dérivation WebCrypto est comparée à PBKDF2 de Node avec de vrais calculs cryptographiques.

3 groupes dans auth-ui-tests.cjs exécutent les formulaires frontend réels avec le backend Google simulé : inscription, création enfant, connexion appareil, passage en mode enfant sans privilège parent, reconnexion et invitation. Les sept tests d’installation sont actualisés pour les quatorze onglets et la version 3. Aucun test visuel en navigateur réel ni connexion au déploiement utilisateur. Les sources de cette livraison incluent les tests et le support de simulation.

Vérification finale de cette livraison : les 15 suites ont été exécutées, soit 166 groupes réussis, et tous les modules frontend ont passé la vérification de syntaxe. Les champs textuels écrits dans les cellules sont protégés contre une interprétation comme formules Sheets. La configuration publique du site prévaut sur une ancienne URL locale de connexion.


## Refonte Mobilier, Prestige et Mobile

Voir NOUVEAUTES-MOBILIER-PRESTIGE.md. Dix nouveaux groupes dans refonte-tests.cjs couvrent les règles 20 min/3 $, la récompense finale complète, la migration, les niveaux cosmétiques, les envies, les 48 modèles, la rotation, les gestes, les résumés privés et les cadeaux. Planche Canvas native inspectée : Apercu-mobilier.png. Aucun essai physique sur téléphone ni connexion réelle Apps Script. Les anciennes assertions de 25 minutes/1 $/2 304 meubles sont actualisées selon les consignes utilisateur. Total : 176 groupes.


## Modèles et personnages — 17 octobre 2026

Voir NOUVEAUTES-MODELES-PERSONNAGES.md : 1 200 modèles, palettes réutilisables, personnages humains redessinés et sauvegarde des looks, corrections Placer/Besoins/Vie et retour immédiat des achats. Livraison vérifiée : 20 suites / 195 groupes ; Canvas natif et DOM/services Google simulés. Aucun test de téléphone ou serveur réel.


## Duels directs — nouvelle livraison

Voir DUELS-PEER-TO-PEER.md : invitation depuis le lobby/arène, signalisation progressive via Apps Script, puis coups et animations en WebRTC. Les profils et l’entretien restent sauvegardés dans Sheets. 23 suites / 210 groupes réussis, dont 15 nouveaux tests de duels ; réseau et WebRTC simulés. Une mise à jour du site et du déploiement Code.gs est nécessaire.


## Connexion, garde-robe, mobilier et codes courts — livraison actuelle

Lire CONNEXION-GARDE-ROBE-MOBILIER.md : connexion persistante, accès enfant par prénom/mot de passe ou code permanent, 24 visages et 68 vêtements/chaussures supplémentaires, mobilier redessiné, aperçus mobiles contenus, panneaux à second clic et invitations à quatre chiffres pour duels/maisons. API version 7. 26 suites / 234 groupes, avec Google et WebRTC simulés.
