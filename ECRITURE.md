# Écriture libre : fonctionnement et limites

Minuscules et majuscules mélangées, chiffres ou mots détachés : une case par caractère, sans pointillés. L’enfant écrit librement ; l’exemple animé est facultatif et ne remplit jamais sa réponse. Les mots peuvent venir de la liste hebdomadaire du parent ou être saisis manuellement : 1 à 16 lettres françaises, sans espace ni apostrophe.

Le premier contrôle compare les traits à plusieurs formes de lettres/chiffres, en tolérant position, largeur, hauteur et ordre des traits. Des variantes couvrent notamment n, r, zéro barré et neuf à tige droite. Le corps et l’accent sont examinés séparément ; la direction aiguë/grave reste significative même si le trait est dessiné en sens inverse. Si une forme est reconnue, une mauvaise lecture de Tesseract ne la fait plus échouer. Si elle reste incertaine, le lecteur **Tesseract.js 5.0.3** essaie jusqu’à trois modes de lecture (caractère isolé, mot, ligne brute) sur une image du dessin seul, en noir sur blanc, recentrée et agrandie. L’alphabet autorisé contient toutes les lettres ou tous les chiffres ; le lecteur n’est pas limité à la réponse attendue.

Une forme reconnue OU une lecture OCR compatible valide la case. Pour un caractère accentué, l’accent dessiné doit aussi être plausible ; une hallucination OCR ne remplace pas un accent absent. Une base E lue par OCR peut valider È si le grave dessiné est correct. La comparaison OCR respecte la casse et les accents et n’accepte pas simplement une sous-chaîne (« 12 » ne valide pas « 1 »). Une case vide ou un tout petit trait ne suffit pas. En cas d’erreur, les cases orange montrent ce qui a été lu ; les cases réussies restent à conserver. Score et série d’entraînement sont locaux. Les lettres/chiffres difficiles reviennent plus souvent dans le tirage suivant.

## Ce que le lecteur ne garantit pas

Tesseract n’est pas spécialisé dans l’écriture d’enfants. Le contrôle de formes peut aussi accepter ou refuser une graphie à tort. Une réussite signifie que l’un des contrôles a reconnu le caractère ; elle ne certifie ni la calligraphie, ni la posture, ni l’ordre des traits. Les tests synthétiques ne remplacent pas des essais avec les enfants sur leurs appareils. Les images typographiques « a », « é », « 7 » ont été lues par un vrai runtime OCR local, mais cela ne mesure pas la fiabilité manuscrite.

## Local et Google Sheets

Les scripts, les quatre variantes du moteur WebAssembly et le modèle français sont inclus dans dist/vendor/ocr avec licences et sources. Aucun service OCR tiers ne reçoit les dessins. Démarrer avec Lancer.cmd ou votre serveur local : l’ouverture directe du fichier HTML ne permet pas les workers OCR.

En mode connecté, les traits compactés et les résultats OCR sont envoyés à votre Apps Script. Il refait le contrôle géométrique, vérifie les données OCR déclarées, vérifie que l’activité est autorisée par le parent et empêche le double paiement. Il ne conserve pas les coordonnées dans le profil. **Apps Script ne refait pas l’OCR : un client modifié peut falsifier ce résultat.** Il s’agit d’un mécanisme familial, pas d’une preuve inviolable d’apprentissage.

Un exercice reconnu donne 10 XP d’étude ; aucun dollar directement. Ces XP font avancer les arbres du jour et de la semaine. Un mot entier compte pour un exercice. Il n’y a plus de plafond quotidien de cinq exercices. La réussite affiche « reconnu », puis passe à un autre symbole après 0,6 seconde.

Pour votre futur backend, copier les six fichiers gs, dont Handwriting.gs. Les tests de formes sont dans handwriting-tests.cjs ; tests.cjs couvre aussi l’API simulée. Documentation : https://github.com/naptha/tesseract.js/blob/master/docs/api.md

La comparaison inclut désormais minuscules et majuscules ensemble, avec variantes penchées. Les formes différentes A/a, E/e, etc. sont vérifiées contre leur contrepartie ; une déclaration OCR ne remplace pas un diagnostic de mauvaise casse. Les formes identiques c/C, o/O, s/S, v/V, w/W, x/X et z/Z sont acceptées dans les deux casses : en écriture libre sans taille imposée, leur seule forme ne permet pas de déterminer la casse.

Les accents sont isolés par rapport au corps réel de la lettre, avec davantage de tolérance sur leur taille et leur position. La pente utilise l’ensemble du trait plutôt que ses seules extrémités ; le circonflexe peut être fait en deux traits, notamment sur î/Î. Le lecteur OCR peut aussi relire le corps seul quand l’accent est géométriquement valide. Les lectures de confiance inférieure à 35/100 ne valident pas à elles seules une forme incertaine. Ces améliorations ne constituent toujours pas une mesure de fiabilité sur des écritures d’enfants.
