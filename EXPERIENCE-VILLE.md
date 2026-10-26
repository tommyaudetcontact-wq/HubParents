# Expérience : Brawl Ville autonome

La demande « reviens au dernier backup » désigne explicitement la sauvegarde complète `C:/Users/recto/Desktop/Brawl-Backup-2026-10-26-072415-avant-centre-ville`, et la branche `backup/2026-10-26-avant-centre-ville` (version plateforme éducative). Ne pas remplacer ce point de retour par une sauvegarde plus récente.

Pour ce retour : arrêter le serveur avec son lanceur, sauvegarder séparément les données de l'expérience, restaurer le code de cette branche et le dossier `Backend-PC` de cette sauvegarde, incluant `data/brawl.sqlite`. Ne jamais mélanger la base courante et les fichiers WAL avec la base restaurée. Republier la plateforme, puis relancer son serveur pour republier son adresse. Les secrets et données restent privés sur le PC.

L'expérience conserve les anciens fichiers source pour faciliter le retour, mais sa navigation, ses gains et sa progression sont centrés sur la ville. L'APK embarque les fichiers du jeu; le serveur sur le PC conserve les comptes, sauvegardes et versions d'installation. Android demande une confirmation pour installer une mise à jour téléchargée.

Objectifs autorisés : ville autonome; logement et personnalisation intégrés à la ville; interactions animées en temps réel; achat d'un terrain; économie liée aux jobs; taxi à 1 $ avec trajets éloignés; pompier à 1 $ par bâtiment sauvé et délai décroissant; APK signé, détection et distribution de nouvelles versions depuis le PC; sauvegarde du code GitHub.

Les nouveaux comptes de l’expérience utilisent exclusivement `data-ville/` et les clés de session `brawl-ville-*`. Les comptes éducatifs, leur base `data/`, et la sauvegarde de retour demeurent séparés. Les nouveaux comptes commencent avec 50 $, le terrain coûte 30 $.

Le contrôle parental et la récupération du compte fonctionnent sur le backend local; aucun appel à un service Supabase n’est nécessaire. Le code de récupération affiché à la création du compte doit être conservé : aucun envoi par courriel n’est configuré.
