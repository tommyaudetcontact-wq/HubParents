# Tank approuvé dans l’atelier

Ouvrir http://127.0.0.1:4187/ ; démarrer depuis la racine avec `node experiments/tank-lab/serve.mjs`.
Le runtime Three provient de `.private/img2-preview/package`.

Modèle original créé en code, style Brawl semi réaliste/cartoon. Le joueur a approuvé ce modèle avant son intégration. La copie dans `assets3d/brawl-tank.js` est le modèle du jeu ; `city-three-tank.js` relie ses animations aux états partagés.

Boutons pour les vues, les chenilles et le tir ; curseurs de tourelle et de canon pour inspecter les articulations. Les commandes de prévisualisation ne modifient pas le gameplay.

Vérifications : `node experiments/tank-lab/model-tests.cjs` et `node city-three-tank-tests.cjs`.
