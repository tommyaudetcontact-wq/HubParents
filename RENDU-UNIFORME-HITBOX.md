# Rendu uniforme et sélection des personnages — 19 octobre 2026

Le moteur d’éclairage dynamique est supprimé : plus de rayons d’occlusion, de recherche des sources, de dégradés d’assombrissement du sol ni de recoloration des personnages et des meubles selon les lampes ou les fenêtres. Les lampes deviennent des objets décoratifs ; le bouton Allumer / éteindre disparaît. Les nuances fixes des faces des objets restent présentes pour lire leurs volumes.

Les caches du sol ne dépendent plus des lampes ni de leurs interrupteurs. Les fenêtres restent correctement rendues dans les murs, sans recalculer le sol. Les anciennes valeurs d’interrupteurs dans les sauvegardes restent compatibles mais n’influencent plus le rendu.

Une ancienne surcharge du menu d’interaction utilisait encore une boîte de 27 × 130 unités sans suivre l’échelle du personnage. Elle est remplacée par une détection commune aux interactions et à la sélection : tête, buste et jambes, position interpolée et taille réelle du personnage. Les chiens et bébés ont leur propre silhouette. Les zones vides, le texte du nom et le diamant ne capturent pas les taps. Un meuble touché garde la priorité sur un personnage.

Validation : 45 suites, 409 groupes réussis. Le nouveau test apartment-uniform-hitbox-tests.cjs charge le vrai menu d’interaction et les surcharges du rendu. Il vérifie les clics près de la silhouette à plusieurs échelles, la priorité du meuble sous le personnage avec caméra et écran dense, les couleurs identiques avec ou sans sources et la réutilisation des caches. Les tests précédents d’éclairage vérifient désormais le rendu uniforme et l’absence des calculs retirés. Canvas natif et interfaces/services simulés ; pas de test sur téléphone réel.

Correctif du site uniquement. Le serveur Apps Script API 16 actuel reste compatible.
