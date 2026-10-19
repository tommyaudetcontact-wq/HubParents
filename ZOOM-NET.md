# Netteté des gros plans — site avec API 15

Les caches de meubles, sols et motifs muraux étaient dessinés à petite résolution puis agrandis avec la caméra. Leur résolution suit désormais le zoom, jusqu’à 12×. Un meuble ou un motif trop grand pour un cache raisonnable est dessiné directement avec sa géométrie, sans agrandir une petite image.

Le fond global de faible résolution reste utilisé pour la vue éloignée. En gros plan, seules les dalles visibles utilisent des caches détaillés. Le lissage des images est activé en qualité haute. Le style et les proportions des personnages et meubles restent ceux du jeu.

Pour limiter la mémoire : caches de sols plafonnés à 4 millions de pixels, meubles à 2 millions, motifs de murs à 2 millions. Les éléments hors écran ne créent pas de nouveaux caches. Une vue identique réutilise les images déjà calculées.

Validation : 41 suites, 383 groupes de tests. La suite `zoom-render-tests.cjs` vérifie les résolutions réelles des caches, leur réutilisation, le dessin direct à 12×, les budgets mémoire, les motifs et l’exclusion des éléments hors écran. Des aperçus à 4× et 12× sont produits avec le moteur de rendu Canvas natif. Cela ne constitue pas une mesure de fluidité sur téléphone réel.

Installer le site actuel. Le serveur reste en API 15 ; il n’a pas besoin d’une nouvelle version si l’API 15 est déjà installée. Les archives sont cumulatives et conservent les autres correctifs.
