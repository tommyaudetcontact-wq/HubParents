# Atelier des skins 3D

Lancer `node experiments/character-gallery/serve.mjs`, puis ouvrir http://127.0.0.1:4190/.
La scène fonctionne sans compte, serveur de jeu ni sauvegarde. Le skin, la vue et le cadrage sont conservés dans le stockage de session de cet atelier. `stage.json` recharge les ressources lorsque la révision change.

Les identités et les catégories de coiffures viennent de `appearance-domain.js`, `character-art.js` et `city-three-character-identity.js`. La morphologie approuvée de Riff reste la référence de structure; les autres skins conservent leurs propres costumes. Les morphologies féminines sont dérivées avant leur propre liaison à identité, avec le même ordre de joints. Leurs buffers sources restent inchangés.

Références visuelles consultées pour les corrections demandées :
- [Halo, armure Mark VI / Master Chief](https://www.halowaypoint.com/news/customization-overview-season-5).
- [Pixar, Toy Story / Woody](https://www.pixar.com/toy-story).
- Le Danseur Écarlate reprend la tenue rouge et les motifs de l'illustration Brawl existante, inspirée de Thriller.

Cette passe comprend : surfaces oculaires plaquées sur le vrai crâne, profils modelés, coiffures exclusives (tresses sans cheveux longs superposés), cheveux longs fermés, chapeaux assis sur la tête, couronnes continues, armures articulées des membres et des mains, semelles uniques et ceintures ajustées à la taille.

Contrôles mécaniques : `city-three-anatomy-tests.cjs`, `city-three-costume-fitting-tests.cjs`, `city-three-riff-image-tests.cjs`. Les tests de caméra, motos et scène globale sont dans `test:3d`. La validation sur un Android physique reste à faire.

En cours : vérification visuelle des 32 identités, affinements demandés en direct. Cette révision n'a pas encore été distribuée dans une nouvelle APK.
