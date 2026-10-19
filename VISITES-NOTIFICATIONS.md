# Visites partagées et notifications — 17 octobre 2026

## Ce qui change

- Depuis le lobby, « Inviter chez moi » envoie une demande de visite. Les codes à quatre chiffres restent disponibles depuis la maison. Pour une autre famille, l’hôte doit accepter la demande avant de communiquer les informations de connexion.
- Les deux enfants se retrouvent dans la même maison. Le plan, les apparences, les déplacements et les mini-jeux circulent directement entre les appareils par WebRTC. Les déplacements reçus sont interpolés pour réduire les à-coups.
- Le visiteur contrôle son personnage. Les modes Terrain / Construction, Aménager et Décorer sont réservés au propriétaire. Son propre appartement est conservé pendant toute la visite.
- Le visiteur peut toucher un meuble ou utiliser les commandes de besoins. Il marche jusqu’au meuble, l’utilise pendant dix secondes, puis remplit son propre besoin. Le serveur vérifie l’autorisation, la présence des deux joueurs, le meuble, la proximité, les murs et le délai. Il sauvegarde uniquement le profil du visiteur ; aucun meuble, besoin ou stock de l’hôte n’est modifié.
- Le compte en haut à droite affiche un badge. Un clic ouvre les invitations de maison, de duel, les demandes d’accès par code et les propositions d’échange. Les échanges montrent les deux cartes. Chaque demande peut être acceptée ou refusée. Un bouton cloche reste accessible dans les commandes de caméra en plein écran.

## Départs, coupures et doubles clics

- Quitter la visite ferme le canal et ramène l’invité dans sa propre maison. Une invitation annulée disparaît à la prochaine actualisation.
- La signalisation d’une invitation expire après trois minutes. Si l’hôte cesse de répondre, le code et l’acceptation sont refusés après environ 35 secondes. Un départ normal envoie également une fermeture au serveur.
- Une visite déjà connectée peut durer plus de trois minutes. Chaque participant renouvelle sa propre présence ; l’invité ne peut pas maintenir artificiellement celle de l’hôte. En cas de coupure silencieuse, la visite est fermée après environ 45 secondes, plus le délai de la prochaine vérification. Le canal direct dispose aussi de messages de présence.
- La boîte de notifications s’actualise toutes les huit secondes. Une perte de réseau ne peut pas être détectée instantanément : les contrôles côté serveur restent appliqués au moment d’accepter ou d’utiliser un meuble.
- Un échange exige que son auteur soit en ligne à l’acceptation. Sinon, l’enfant peut attendre son retour ou refuser. Les cartes sont revérifiées et la transaction reste idempotente : une réponse perdue ou un double clic ne donne pas une deuxième carte.
- Les informations et inventaires des autres familles restent privés. Une autorisation de visite donne seulement la lecture du plan nécessaire à l’interaction, sans droit de modifier le compte de l’hôte.

## Mise à jour

Remplacer les fichiers GitHub par le contenu du nouveau `Brawl-Academie-GitHub-Pages.zip`. Remplacer le code Apps Script par `Code-complet.gs`, puis déployer une **nouvelle version du déploiement existant** pour conserver l’URL. Le statut public doit indiquer `version: 8`, `visits: true` et `notifications: true`.

Aucune nouvelle colonne à créer manuellement. Aucune réinitialisation de la feuille ni création de nouveaux comptes n’est nécessaire. Les tables de jeu existantes sont conservées ; les autorisations temporaires sont dans CacheService. Si Google évince un cache de connexion, la rencontre est fermée proprement et il faut en créer une nouvelle.

## Validation

28 suites, 251 groupes de tests automatisés réussis. Les tests supplémentaires couvrent les notifications, les permissions, les interactions du visiteur, les échanges hors ligne, les départs et les expirations. Deux clients simulés échangent une maison et des positions via un canal WebRTC simulé, puis réalisent une interaction et sauvegardent uniquement les besoins du visiteur.

Les interfaces DOM, le réseau WebRTC et les services Google sont simulés dans ces tests. Aucun essai sur deux vrais téléphones, aucun nouveau déploiement Apps Script et aucune publication GitHub n’ont été effectués. Après publication, essayer la visite et un mini-jeu sur deux appareils, puis fermer l’onglet de l’hôte. Certains réseaux exigent toujours un relais TURN pour établir WebRTC.
