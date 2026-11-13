# Maison

Le dashboard de la maison : quêtes, routines (Kimchi, plantes, maison), wishlist, agenda et météo.

## Comment ça marche
- **Interface** : une app web statique (ce dépôt), hébergée sur GitHub Pages et installable sur téléphone et ordinateur.
- **Données** : un Google Sheet appartenant à un compte Google dédié à la maison.
- **Lien entre les deux** : le script Google Apps Script `apps-script/Code.gs`, attaché au Sheet. L'app ne parle qu'à lui, avec un code d'accès.

## Sécurité
- Aucun identifiant n'est dans ce dépôt : ni ID du Sheet, ni ID d'agenda, ni code d'accès, ni adresse du script.
- Le script n'a que trois autorisations : **ce Sheet uniquement** (`spreadsheets.currentonly`), **lecture seule de l'agenda** (`calendar.readonly`) et les appels sortants pour la météo.
- Le script n'accepte qu'une liste fermée d'actions. Les valeurs qui pourraient devenir des formules sont neutralisées.
- Après 10 codes faux, l'accès est bloqué pendant 15 minutes.
- Pour changer le code d'accès : modifie `ACCESS_CODE` dans les propriétés du script. Tous les appareils seront déconnectés.

## Installer le script (une seule fois)
1. Dans le Sheet : **Extensions → Apps Script**.
2. Dans **Paramètres du projet** (roue dentée), coche « Afficher le fichier manifeste appsscript.json ».
3. Remplace le contenu de `appsscript.json` et de `Code.gs` par ceux du dossier `apps-script/`.
4. Toujours dans les Paramètres du projet, ajoute les **propriétés du script** :
   - `ACCESS_CODE` : un code long (12 caractères minimum) ;
   - `CALENDAR_IDS` : les identifiants des agendas, séparés par des virgules.
5. Lance la fonction `verifier` une fois et accepte les autorisations.
6. **Déployer → Nouveau déploiement → Application Web** : « Exécuter en tant que : moi », « Accès : tout le monde ».

## Ajouter un appareil
Ouvre `https://victorr666.github.io/dashboard-house/#setup=<adresse du script>`, puis entre le code d'accès.
