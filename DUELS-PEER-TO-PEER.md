# Duels : connexion automatique et échanges directs

## Jouer

Les deux enfants se connectent à leur profil, sur deux onglets ou appareils, puis ouvrent **Arène** ou **Lobby des amis**.

- Dans le lobby : **Défier au duel** à côté de l’ami.
- Dans l’arène : choisir trois cartes, **Créer un duel**, puis choisir l’ami en ligne.
- L’ami clique **Accepter le duel** dans ses invitations. La connexion se prépare automatiquement, sans échange de gros codes.
- Le dialogue affiche les étapes et permet d’annuler. Une invitation expire au bout de trois minutes.

Le mode par codes reste disponible pour les personnes qui ne figurent pas dans le même lobby familial : **Créer un duel > Utiliser un code à copier**. En démo locale, Créer un duel utilise directement ce mode. **Rejoindre** accepte aussi ces codes. Un code manuel se prépare dès qu’un candidat public est disponible, avec une courte marge de 250 ms ; à défaut, le premier code est produit après un maximum de 4,5 secondes. Sur un réseau lent, **Compléter le code** actualise les informations sur la connexion existante ; recopier alors le nouveau code.

## Répartition du travail

| Google Sheets / Apps Script | Connexion directe WebRTC |
| --- | --- |
| Comptes, profils, inventaires et autorisations | Équipes et état initial du duel |
| Destinataire, création, acceptation et annulation d’une invitation | Attaques, énergie, défense, changements et tours |
| Échange temporaire des informations de connexion | Effets et animations calculés sur les deux appareils |
| Sauvegarde de l’entretien des cartes et de la progression | Positions et mini-jeux des visites, comme auparavant |

La création automatique n’attend plus la fin de la recherche ICE : offre, réponse et adresses sont échangées progressivement. C’est le principe de signalisation progressive décrit dans la [documentation WebRTC](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Connectivity). Les coups utilisent un canal direct fiable et ordonné. Les animations existantes sont conservées ; leur durée ne correspond pas à une attente de Google.

L’onglet **Duels** contient uniquement les invitations et leur statut. Les descriptions SDP et candidats réseau restent dans le cache temporaire Apps Script, accessible uniquement aux deux participants authentifiés. Ils ne sont pas enregistrés dans les cellules. Si le cache est évincé, une nouvelle invitation est nécessaire. La période de signalisation est limitée à trois minutes. Dès que le canal direct s’ouvre, le client arrête ses requêtes de signalisation. Les lectures sans nouveaux signaux ne prennent pas le verrou global des sauvegardes. Le lobby ne décode plus le profil complet de l’enfant à chaque présence.

Les invitations d’une autre famille et les accès d’un troisième enfant sont refusés. Les familles continuent à partager le même backend avec isolation des données. Les codes manuels gardent leur fonctionnement antérieur.

## Mise à jour

1. Remplacer les fichiers du site par le contenu décompressé de **Brawl-Academie-GitHub-Pages.zip**.
2. Remplacer tout Code.gs par le nouveau **Code-complet.gs** puis enregistrer.
3. Dans **Déployer > Gérer les déploiements > Modifier**, sélectionner **Nouvelle version** puis déployer. Conserver le déploiement existant et son URL.
4. Actualiser les deux appareils pour qu’ils utilisent la même version.

Le statut public indique désormais **version 6** et **duels: true**. L’onglet Duels se crée automatiquement au premier duel ; ne pas relancer initializeBrawl sur une feuille existante. Aucun serveur Node ou service de signalisation supplémentaire n’est requis.

## Limites et vérifications

Google est encore nécessaire pour découvrir une invitation et établir la connexion. Il reste donc un délai initial lié à ses requêtes et au rafraîchissement : trois secondes entre recherches dans l’arène, cinq secondes dans le lobby, et 1,5 seconde entre échanges de connexion, avec une seule requête en vol par session. Ces délais ne s’ajoutent pas aux coups une fois connectés. Aucun délai réel mesuré sur le déploiement utilisateur n’est annoncé.

WebRTC requiert HTTPS ou localhost. Certains réseaux bloquent une connexion directe et demandent un relais TURN. Le jeu accepte une liste optionnelle **BRAWL_CONFIG.iceServers** ; aucun relais payant ou tiers n’a été ajouté automatiquement. Une coupure suspend le duel ; la reprise automatique d’un combat après fermeture de l’onglet n’est pas incluse.

15 nouveaux groupes couvrent : familles et destinataires isolés, données invalides, cache perdu, expiration, annulation, échange progressif, réponse réseau perdue, deux clients jouant un duel entier avec états identiques et sans appel Google par coup, arrêt du polling, entretien final, génération des codes, navigation réelle de l’application dans un DOM simulé et dialogue visible.

Vérification complète : **23 suites, 210 groupes**. Google, le réseau et WebRTC sont simulés. Aucun essai entre deux téléphones réels, aucune mesure du réseau réel, aucune publication GitHub et aucun redéploiement Google n’ont été réalisés depuis cet environnement.
