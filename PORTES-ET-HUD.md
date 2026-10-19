# Portes et menus — API 12

La barre Vie / Maison / Personnage / Plus et les panneaux partagent désormais le viewport comme repère. Une zone basse de 64 px, la marge de sécurité du téléphone et 12 px de séparation sont réservés. Les menus Maison, Personnage, Plus, l’inventaire, les outils de construction/décoration, les besoins et le HUD s’arrêtent au-dessus. Les panneaux trop grands défilent dans l’espace disponible. Les commandes flottantes de placement restent au-dessus de la barre, et se cachent lorsqu’un autre panneau est ouvert ou que l’espace vertical ne permet pas de les montrer intégralement.

Les portes existantes reçoivent gratuitement un cadre et un battant classique. L’ouverture n’est plus représentée par un vide sous une bande de mur. Le battant pivote progressivement à l’approche du joueur, du partenaire, du chien ou d’un visiteur et se referme après leur passage. Les collisions et les chemins conservent une ouverture franchissable ; une fenêtre reste bloquante.

Boutique → Mobilier → Portes propose trois modèles : chêne (3 $), blanche moderne (4 $) et vitrée atelier (5 $), en monnaie du jeu. Dans Appartement → Maison → Portes, choisis un modèle possédé puis touche un mur en vue du dessus pour le poser ou remplacer une porte. Les modèles restent réutilisables. « Retirer une porte » permet de supprimer une ouverture existante. Les modèles posés sont enregistrés avec la maison et suivent les sauvegardes de séance ; le serveur vérifie la possession et le prix.

Installation : remplacer le site et Code-complet.gs, puis publier une nouvelle version Apps Script. Le statut /exec doit annoncer version 12. Aucune feuille à réinitialiser et aucun compte à recréer.

Validation : 35 suites / 326 groupes, Google/DOM/WebRTC simulés et Canvas natif. Tests des achats, refus de modèles non possédés, pose et sauvegarde, ouverture/fermeture, traversée, rendu des modèles et géométrie HUD en portrait/paysage avec marges de sécurité. Le parcours complet achat → Maison → pose est testé avec le routeur Apps Script simulé. Validation sur téléphone ou navigateur réel encore à faire.
