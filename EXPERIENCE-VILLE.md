# Expérience : Brawl Ville autonome

La demande « reviens au dernier backup » désigne explicitement la sauvegarde complète `C:/Users/recto/Desktop/Brawl-Backup-2026-10-26-072415-avant-centre-ville`, et la branche `backup/2026-10-26-avant-centre-ville` (version plateforme éducative). Ne pas remplacer ce point de retour par une sauvegarde plus récente.

Pour ce retour : arrêter le serveur avec son lanceur, sauvegarder séparément les données de l'expérience, restaurer le code de cette branche et le dossier `Backend-PC` de cette sauvegarde, incluant `data/brawl.sqlite`. Ne jamais mélanger la base courante et les fichiers WAL avec la base restaurée. Republier la plateforme, puis relancer son serveur pour republier son adresse. Les secrets et données restent privés sur le PC.

L'expérience conserve les anciens fichiers source pour faciliter le retour, mais sa navigation, ses gains et sa progression sont centrés sur la ville. L'APK embarque les fichiers du jeu; le serveur sur le PC conserve les comptes, sauvegardes et versions d'installation. Android demande une confirmation pour installer une mise à jour téléchargée.

Objectifs autorisés : ville autonome; logement et personnalisation intégrés à la ville; interactions animées en temps réel; achat d'un terrain; économie liée aux jobs; taxi à 1 $ avec trajets éloignés; pompier à 1 $ par bâtiment sauvé et délai décroissant; APK signé, détection et distribution de nouvelles versions depuis le PC; sauvegarde du code GitHub.

Les nouveaux comptes de l’expérience utilisent exclusivement `data-ville/` et les clés de session `brawl-ville-*`. Les comptes éducatifs, leur base `data/`, et la sauvegarde de retour demeurent séparés. Les nouveaux comptes commencent avec 50 $, le terrain coûte 30 $.

Le contrôle parental et la récupération du compte fonctionnent sur le backend local; aucun appel à un service Supabase n’est nécessaire. Le code de récupération affiché à la création du compte doit être conservé : aucun envoi par courriel n’est configuré.

## Échanges et pompier — APK 0.1.10 (11)

- Amis → Échanges : argent et jusqu’à 12 objets rangés de chaque côté (meubles, vêtements/skins, livres et véhicules non sélectionnés). Une proposition peut être un cadeau. Le destinataire examine puis accepte/refuse; l’expéditeur peut annuler; expiration après 15 minutes. Les biens équipés/placés doivent être rangés avant l’échange.
- Les deux comptes doivent être présents dans la même ville. Le serveur SQLite authentifie, vérifie de nouveau les soldes et inventaires et transfère les deux profils dans une seule transaction. Les reprises de requêtes et doubles acceptations n’ajoutent aucun gain. Les contrôles parentaux s’appliquent. Aucun transfert d’argent réel.
- Pompier : bouton 💦 LANCE visible pendant le service, utilisable à pied et depuis le camion. S’approcher si le bouton indique APPROCHE-TOI. Maintenir le bouton ou la gâchette droite; E ouvre/ferme l’eau. Jet animé et progression d’extinction.
- Aucun chantier ni ouvrier tant qu’un feu actif brûle sur la bâtisse. La reconstruction normale reprend après extinction/fin du feu.
- Correction du maintien en ville autonome entre comptes distincts : le heartbeat ne rejette plus les autres familles; l’isolation reste active pour l’ancienne plateforme éducative.
- Vérifications : suites backend, échanges HTTP sur SQLite avec deux nouveaux comptes, concurrence/doublons, fonds insuffisants, expiration et contrôle parental; simulation de la lance hôte/invité et blocage des chantiers; test visuel d’envoi/acceptation avec comptes de démonstration.

## Métier policier — APK 0.1.12 (13)

Menu → Métiers → Policier : choisir une intervention de 1 à 4 voitures, ou une patrouille aléatoire de 1–2 voitures. Primes : 1 $, 2,50 $, 4,50 $, 7 $. Véhicule de service plafonné à 129,6 km/h et bandits à 111,6 km/h. Un repère suit la cible la plus proche. Chaque voiture a sa propre barre de résistance : au moins six impacts distincts et suffisamment forts, avec une seconde entre les impacts. Ensuite le suspect sort, avec sa propre barre de vie : coups de poing/pied en combo ou pistolet de service s’il est armé.

Sur mobile : boutons Frapper/Pistolet et Menotter. Clavier : J ou Espace pour combattre, E pour menotter. Manette : RB combat, X action/menottes, Y descendre. Le menottage dure 2,5 secondes, s’interrompt si l’agent s’éloigne, et utilise une pose accroupie avec les deux mains vers les poignets; le suspect reste agenouillé, mains derrière le dos. Tous les suspects doivent être menottés. Aucun paiement pour une simple voiture détruite ou un suspect mis à terre.

SQLite attribue les cibles et contrôle la séquence, les délais, les distances, les six contacts, le type de combat, le menottage et le paiement unique. L’hôte simule les bandits/impacts; les invités prédisent leur conduite, reçoivent les mêmes jauges et peuvent prendre le service. Les états et événements non validés survivent au changement d’hôte. Reprise de l’intervention lors d’une reconnexion, expiration après 20 minutes et annulation depuis le menu. Les versements fractionnaires restent utilisables dans les échanges et les ajouts du superutilisateur.

Tests : collisions physiques réelles, combats et projectiles, deux jauges par suspect, menottage interrompu/complet, six clients en réseau avec changement d’hôte, contrats et récompenses serveur, répétitions et faux événements, paiements fractionnaires. Le backend reste exclusivement sur le PC.

## Révision police et construction — APK 0.1.13 (14)

Ces règles concernent exclusivement le métier Policier; les poursuites des joueurs recherchés restent séparées. Une seule patrouille aléatoire de 1 à 3 criminels remplace les difficultés sélectionnables. Bandits plafonnés à 100 km/h, voitures détruites en quatre impacts distincts. Un criminel à pied meurt en ragdoll après deux chocs de voiture : cela termine son objectif mais ne rapporte aucune prime. Le versement dépend uniquement des suspects menottés (1 / 2,50 / 4,50 $); une patrouille entièrement mortelle rapporte zéro. Les anciens contrats aux six impacts sont retirés proprement à la mise à jour.

Le pistolet de service utilise le même joystick droit que les armes normales : viser et tirer librement sans viser automatiquement le suspect le plus proche. Joystick gauche pour marcher; clavier flèches pour viser/tirer, J/Espace pour tirer; manette stick droit/RB pour tirer, A pour frapper, X/E pour menotter. Les projectiles des invités sont prédits visuellement, mais seul l’hôte décide des touches et le serveur valide le paiement. Boutons Frapper et Menotter séparés.

Construction : l’ancien capteur tactile de l’appartement cède les gestes au contrôleur de ville; les pièces se dessinent par glissement; un mur se trace en plusieurs segments et se sauvegarde une seule fois au relâchement. Cache des arêtes invalidé après une modification réelle, sans reconstruire la structure à chaque mouvement de meuble. Suppression du calcul en double des meubles pendant l’édition et arrêt de la boucle d’animation cachée; bornes du cercle de placement calculées avec huit points. La couche de saisie transparente ne masque plus le bouton Terminer.

Vérifications : dessin/sauvegarde d’une pièce et d’un mur de quatre segments, déplacement/confirmation d’un meuble et fermeture de l’éditeur dans l’interface; conservation des faces structurelles sur cent mises à jour de déplacement; ordre réel des gestionnaires tactiles; tir manuel avec ratés possibles, quatre impacts, mort en deux renversements, prime mixte et migration multijoueurs.
