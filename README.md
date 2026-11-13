# Maison — dashboard du foyer

Petite app web pour gérer la maison à deux : quêtes et projets, routines (chien, plantes, ménage), agenda, météo, liste de courses et wishlist. Elle s'installe comme une app sur téléphone et ordinateur (PWA). Toutes les données vivent dans un Google Sheet.

Ce document est fait pour qu'**un développeur ou une IA puisse reprendre le projet sans contexte**. Il ne contient aucune information sensible : les identifiants et le code d'accès sont rangés dans les réglages du script Google, jamais dans ce dépôt.

---

## Sommaire
1. [Vue d'ensemble](#1-vue-densemble)
2. [Fonctionnalités](#2-fonctionnalités)
3. [Architecture](#3-architecture)
4. [Arborescence](#4-arborescence)
5. [Modèle de données (Google Sheet)](#5-modèle-de-données-google-sheet)
6. [API du script Google](#6-api-du-script-google)
7. [Règles de sécurité (à respecter)](#7-règles-de-sécurité-à-respecter)
8. [Installer depuis zéro](#8-installer-depuis-zéro)
9. [Publier une modification](#9-publier-une-modification)
10. [Développer et tester en local](#10-développer-et-tester-en-local)
11. [Recettes courantes](#11-recettes-courantes)
12. [Dépannage](#12-dépannage)
13. [Pistes d'évolution](#13-pistes-dévolution)

---

## 1. Vue d'ensemble

| Élément | Choix |
|---|---|
| Interface | HTML + CSS + JavaScript « vanilla », sans framework ni étape de build |
| Hébergement | GitHub Pages, servi depuis la branche `main`, à la racine |
| Données | Un Google Sheet appartenant à un **compte Google dédié à la maison** |
| Serveur | Un Google Apps Script attaché au Sheet, déployé en « Application Web » |
| Accès | Un code d'accès partagé, demandé une fois par appareil |

Pourquoi ce montage :
- **Aucun serveur à payer ni à maintenir.**
- **Une seule source de vérité** (le Sheet), lisible et modifiable à la main en cas de besoin.
- **Les deux personnes du foyer utilisent la même source** sans avoir besoin d'accès Google elles-mêmes. C'est le script, exécuté avec le compte dédié, qui parle à Google.

## 2. Fonctionnalités

- **Onglets en bas** (petite barre discrète, sur tous les écrans) :
  - **Accueil** : le dashboard complet, sur un seul écran en paysage, en colonne sur téléphone ;
  - **Routines** : les cartes Kimchi (le chien), Plantes et Entretien Maison ;
  - **Courses** : la liste de courses et la wishlist ;
  - **Voyages** : la liste des voyages à venir, puis les voyages passés.
- **Quête principale** : la quête épinglée, avec ses mini-quêtes (étapes) à cocher.
- **Quêtes secondaires** : un résumé sur l'accueil. Un clic sur le titre ouvre une **page plein écran** (`#quetes`) avec toutes les quêtes en détail : statut, urgence, mini-quêtes, notes et liens.
- **Routines** :
  - chaque tâche a une fréquence (tous les N jours ou semaines) ;
  - la couleur passe au vert, à l'orange puis au rouge selon le temps écoulé depuis la dernière fois ;
  - « ✓ FAIT », date au choix, annulation de la dernière date.
- **À venir** :
  - les événements Google Agenda des 35 prochains jours, en lecture seule ;
  - on peut les renommer ou les masquer, mais seulement dans l'app : l'agenda n'est jamais modifié.
- **Météo** : Open-Meteo, avec un cache de 30 minutes côté script.
- **Courses** :
  - liste simple, sans icônes ni catégories, dans l'ordre d'ajout ;
  - ajout rapide (« 2 lait », « tomates x3 ») ;
  - panier, « Vider le panier » avec annulation ;
  - mise à jour toutes les 15 s quand l'onglet est ouvert, 60 s sinon.
- **Wishlist** : budget, pour qui, urgence, lien, recherche Amazon.
- **Annulation** : après chaque validation (mini-quête, quête terminée, routine « fait », article mis au panier) ou suppression, un bouton « Annuler » reste affiché 6 secondes.
- **Courses en plein écran** (`#courses`, clic sur le titre « Courses › ») : grandes cases pour le magasin, écran gardé allumé (Wake Lock) quand le navigateur le permet.
- **Voyages** :
  - sur l'accueil, dans la carte « À venir » sous le titre, le prochain voyage avec son compte à rebours (« Départ dans 12 jours »), puis « Jour 2 sur 5 » pendant le voyage, avec le prochain trajet ou la prochaine activité ;
  - une **page unique** par voyage (`#voyage`), volontairement simple : destination, icône, **départ** et **retour** (jour + heure) modifiables directement, petit lien **Billets** en haut à droite (SNCF Connect par défaut, modifiable en bas de la page), puis **Hébergement** (nom, adresse avec plan, infos), **Activités sur place** (titre, jour facultatif, note, à cocher) et **Valise** (repliée) ;
  - en haut de la liste des voyages (et seulement là), un **compte à rebours façon panneau d'aéroport** (jours, heures, minutes, secondes ; chaque chiffre bascule quand il change) jusqu'à l'heure de départ ;
  - **listes types** pour la valise : 5 sont créées au premier usage (Essentiels, Camping, Sortie à la journée, Avec Kimchi, Sans Kimchi). On peut en créer, les modifier, les supprimer (« ⚙️ Gérer les listes ») ou enregistrer la valise d'un voyage comme liste type. Ajouter une liste type à une valise n'ajoute que les objets absents. Dans le Sheet, ce sont des lignes `Valise` sans voyage parent ;
  - le programme jour par jour existe dans le code (`vProg`) mais il est masqué (`SHOW_PROG = false`). Les anciens types Trajet et Transport sur place restent lisibles dans le Sheet mais ne sont plus affichés ;
  - aucun billet n'est stocké : seulement un lien (SNCF Connect par défaut) : le script n'a pas accès à Drive. Ne jamais saisir de numéro de passeport ou de carte bancaire.
- **Hors ligne** : l'app et les dernières données restent sur l'appareil. Chaque modification va d'abord dans une **file d'attente locale** (`localStorage`, clé `maison-outbox`), puis part vers le script dès que le réseau répond, avec de nouveaux essais espacés progressivement. Un petit bandeau indique les modifs en attente. Rien n'est perdu si l'app est fermée hors ligne.

## 3. Architecture

```
 Téléphone / ordinateur                       Google (compte dédié à la maison)
┌──────────────────────────┐   HTTPS POST    ┌──────────────────────────────┐
│ App (GitHub Pages)       │ ──────────────▶ │ Apps Script « Application Web » │
│  index.html / app.js     │  {k, a, ...}    │  apps-script/Code.gs          │
│  localStorage :          │ ◀────────────── │   ├─ Google Sheet (ce fichier)│
│   adresse du script,     │   JSON          │   ├─ Google Agenda (lecture)  │
│   code d'accès, cache    │                 │   └─ Open-Meteo (météo)       │
└──────────────────────────┘                 └──────────────────────────────┘
```

- L'app envoie toutes ses requêtes en `POST` avec `Content-Type: text/plain`, ce qui évite la requête préalable CORS (preflight) que les Apps Scripts ne gèrent pas. Le corps est du JSON.
- **L'adresse du script n'est pas dans le code.** Elle est donnée une fois à chaque appareil :
  - soit par un lien d'installation `…/#setup=<adresse encodée>` (la partie après `#` n'est jamais envoyée à un serveur) ;
  - soit en la collant dans l'écran de connexion.
- Le **code d'accès** est vérifié à chaque requête par le script.
- **Écritures « optimistes » et hors ligne** : l'app met d'abord l'interface à jour, puis ajoute l'opération (`put`, `del` ou `setting`) à une file d'attente gardée sur l'appareil (`OB`, fonctions `enqueue()` et `flush()`). Plusieurs modifications d'une même ligne sont regroupées en une seule. La file est envoyée une opération à la fois, dans l'ordre. En cas d'échec réseau, elle réessaie après 3 s, puis 6 s, 12 s… jusqu'à 60 s, et reprend dès que le téléphone retrouve le réseau. À chaque chargement, les opérations pas encore envoyées sont réappliquées par-dessus les données du serveur (`overlayOutbox()`), pour que l'interface ne « revienne pas en arrière ». En cas de conflit, c'est la dernière écriture qui gagne, ligne par ligne.

## 4. Arborescence

```
index.html             Structure de la page : cartes, onglets, écran de connexion, page des quêtes
style.css              Tout le style (thème clair uniquement, responsive)
app.js                 Toute la logique : connexion, chargement, rendu, actions
sw.js                  Service worker : garde une copie de l'app pour le hors-ligne (réseau d'abord)
manifest.webmanifest   Nom, icônes et couleurs de l'app installée
assets/                Mascotte (SVG) et icônes PNG
fonts/                 Polices Fredoka et Nunito, hébergées localement (licence OFL)
apps-script/
  Code.gs              Le script Google (à copier dans l'éditeur Apps Script du Sheet)
  appsscript.json      Le manifeste du script : autorisations Google et réglages du déploiement
tools/
  smoke_test.py        Test automatique de l'app avec un faux script (voir section 10)
```

Organisation de `app.js`, de haut en bas :
1. **Connexion** : `api()`, l'écran de connexion et le lien `#setup=`.
2. **Conversion lignes ↔ objets** : `SHT`, `fromRow()`, `toRow()`.
3. **Chargement et écritures** : `load()`, `applyLoad()`, `queue()`, `shWrite()`, `shDel()`, `upd()`, `addDoc()`.
4. **Rendu de chaque carte** : `renderCare`, `renderTodo`, `renderMain`, `renderShop`, `renderCourses`, `renderCal`, `renderWeather`, `renderQView`.
   Voyages : `renderTrips` (liste), `renderTripNext` (accueil), `renderVView` (page d'un voyage), `tPanel`/`tSave` (fiche d'édition), `vClick` (clics).
5. **Fenêtres de détail** : `renderSheet` (routine, quête, envie, renommage d'événement).
6. **Onglets** (`setTab`) et **page des quêtes** (`qview`).
7. **Gestion des clics** : un seul écouteur, basé sur les attributs `data-act`.

## 5. Modèle de données (Google Sheet)

La ligne 1 de chaque onglet contient les en-têtes. Les données commencent à la ligne 2. La colonne A contient toujours un **identifiant unique** : si une ligne ajoutée à la main n'en a pas, le script lui en donne un. La dernière colonne, `_t`, contient en JSON les champs supplémentaires qui n'ont pas de colonne dédiée (par exemple `createdAt`, `prio`, `status`, `notes`, `hasPrev`).

| Onglet | Colonnes, dans l'ordre |
|---|---|
| `Entretien` | id, groupe (`Kimchi`, `Plantes` ou `Maison`), icône, tâche, dernière fois, tous les N, unité (`jours`/`semaines`), `_t` |
| `Wishlist` | id, icône, titre, budget, pour qui (prénom ou `Couple`), urgence (`Un jour`/`Bientôt`/`Vite`), lien, note, obtenu (`oui`/vide), `_t` |
| `Quetes` | id, icône, titre, principale (`oui`/vide), mini-quêtes (une par ligne, préfixe `✓ ` si faite), `_t` |
| `Courses` | id, icône, article, quantité, rayon (libellé), dans le panier (`oui`/vide), `_t`. L'onglet est créé automatiquement au premier ajout. |
| `Voyages` | id, voyage (id du voyage parent, vide pour un voyage), type (`Voyage`, `Trajet`, `Transport sur place`, `Hébergement`, `Activité`, `Valise`), titre, début, fin (`2026-12-20` ou `2026-12-20 08:35`), lieu, réf, lien, notes (pour la valise : un objet par ligne, préfixe `✓ ` si rangé), fait (`oui`/vide), `_t` (icône, mode de transport, n° de vol, place, prix, statut). Créé automatiquement. Toutes les cellules sont écrites **en texte brut** (`text: true` dans `TABS`) pour qu'une référence comme `012345` ou une date ne soit jamais convertie. |
| `Reglages` | nom, valeur (JSON). Contient `hiddenEvents` et `eventNames`, créés automatiquement. |

Les dates sont acceptées sous plusieurs formes (`2026-11-13`, `13/11/2026`, numéro de série Sheets) et normalisées par `nDate()`.

## 6. API du script Google

Toutes les requêtes ont la forme `POST <adresse du script>` avec un corps `{"k": "<code d'accès>", "a": "<action>", ...}`.

| Action | Paramètres | Effet |
|---|---|---|
| `load` | — | Renvoie `sheets` (lignes brutes de chaque onglet), `settings`, `people` (les deux prénoms), `events` (agenda), `weather`, et éventuellement `calError` |
| `put` | `t` (`routines`, `shop`, `projects` ou `courses`), `row` (tableau à la largeur exacte de l'onglet) | Crée ou remplace la ligne qui porte cet identifiant |
| `del` | `t`, `id` | Vide la ligne qui porte cet identifiant |
| `setting` | `name` (`hiddenEvents` ou `eventNames`), `value` | Enregistre ce réglage dans l'onglet `Reglages` |

Réponses : `{"ok": true, ...}`, ou `{"ok": false, "error": "auth" | "locked" | "action" | "size" | "server"}`. Le code `locked` signifie que 10 codes faux ont été envoyés : l'accès est bloqué 15 minutes.

**Réglages du script** (Paramètres du projet → Propriétés du script, **jamais dans le dépôt**) :

| Propriété | Rôle |
|---|---|
| `ACCESS_CODE` | Code d'accès, 12 caractères minimum (obligatoire) |
| `CALENDAR_IDS` | Identifiants des agendas à afficher, séparés par des virgules |
| `PERSON_1`, `PERSON_2` | Les deux prénoms affichés dans la wishlist |
| `WEATHER_LAT`, `WEATHER_LON`, `WEATHER_CITY` | Position pour la météo (Paris par défaut) |

## 7. Règles de sécurité (à respecter)

Ces règles ont été fixées par le propriétaire du projet. **Toute modification doit les respecter.**

**Côté Google**
- Le script n'a que trois autorisations, déclarées dans `appsscript.json` :
  - `spreadsheets.currentonly` (avec `@OnlyCurrentDoc`) : uniquement ce Sheet ;
  - `calendar.readonly` : lecture seule de l'agenda ;
  - `script.external_request` : uniquement pour la météo.
- N'ajoute **jamais** d'accès à Gmail, Drive, Contacts ou Tasks, ni d'écriture dans l'agenda. Toute nouvelle autorisation doit être validée explicitement par le propriétaire.
- Le script n'accepte qu'une **liste fermée d'actions et d'onglets** (`TABS`, `SETTING_RULES`). Pour ajouter un onglet, ajoute-le à cette liste ; n'ouvre jamais d'accès à une plage arbitraire.
- Toutes les entrées sont validées : taille, format de l'identifiant, largeur de la ligne. Les valeurs qui commencent par `= + - @` sont neutralisées pour empêcher l'injection de formules.
- Le script tourne avec le **compte Google dédié**, jamais avec le compte personnel du propriétaire. Les agendas personnels sont seulement **partagés en lecture** avec ce compte dédié.

**Côté dépôt (public)**
- **Aucun identifiant dans le code ni dans la documentation** : ni identifiant du Sheet, ni identifiant d'agenda, ni adresse ou identifiant de déploiement du script, ni code d'accès, ni adresse e-mail, ni prénom.
- **Aucun script ou service tiers** dans la page. Les polices sont hébergées localement. La Content-Security-Policy de `index.html` n'autorise que le site lui-même et `script.google.com` / `script.googleusercontent.com`.
- Tout texte affiché passe par `esc()`. Les liens passent par `safeUrl()` et s'ouvrent avec `rel="noopener noreferrer"`.
- L'authentification à deux facteurs doit rester activée sur GitHub et sur Google : quelqu'un qui contrôlerait ce dépôt pourrait modifier l'app pour intercepter le code d'accès.

## 8. Installer depuis zéro

À suivre si tout est à refaire, par exemple sur un nouveau compte.

1. **Compte Google dédié** : crée un compte Gmail réservé à la maison et active la validation en deux étapes.
2. **Sheet** : avec ce compte, crée un Google Sheet avec les onglets `Entretien`, `Wishlist` et `Quetes`, et leurs en-têtes (voir section 5). `Courses` et `Reglages` se créent tout seuls.
3. **Agendas** :
   - depuis chaque compte personnel, partage l'agenda avec le compte dédié, avec l'autorisation « Voir tous les détails des événements » ;
   - dans Google Agenda du compte dédié, vérifie que ces agendas apparaissent bien dans « Autres agendas ». Sinon, ajoute-les avec « S'abonner à l'agenda ».
4. **Script** :
   - dans le Sheet, ouvre Extensions → Apps Script ;
   - dans Paramètres du projet, coche « Afficher le fichier manifeste » ;
   - copie `apps-script/appsscript.json` et `apps-script/Code.gs` dans l'éditeur, puis enregistre ;
   - ajoute les propriétés du script (section 6).
5. **Autoriser et vérifier** :
   - lance la fonction `verifier` et accepte les autorisations. L'écran « appli non validée » est normal pour un script personnel : passe par Paramètres avancés ;
   - le journal doit n'afficher que des ✅.
6. **Déployer** : Déployer → Nouveau déploiement → Application Web, « Exécuter en tant que : moi », « Accès : tout le monde ». Note l'adresse qui se termine par `/exec`.
7. **GitHub Pages** : dans les réglages du dépôt, Pages → « Deploy from a branch » → `main`, dossier `/ (root)`.
8. **Appareils** : ouvre `https://<compte>.github.io/<dépôt>/#setup=<adresse /exec encodée>`, entre le code d'accès, puis ajoute l'app à l'écran d'accueil.

> Conseil : utilise un navigateur ou un profil connecté **uniquement** au compte dédié. Si plusieurs comptes Google sont connectés, Apps Script s'ouvre souvent avec le mauvais et affiche « Impossible d'ouvrir le fichier ».

## 9. Publier une modification

**Interface** (`index.html`, `style.css`, `app.js`, `assets/`…)
1. Modifie, puis teste en local (section 10).
2. **Incrémente le numéro de version** des fichiers dans `index.html` (`style.css?v=N` et `app.js?v=N`) et le nom du cache dans `sw.js` (`maison-shell-vN`). Indispensable : sans ça, GitHub Pages peut servir la nouvelle page avec l'ancien script pendant environ 10 minutes, et l'app se casse.
3. Commit et push sur `main`. Le site est à jour en une ou deux minutes. Sur les appareils, il suffit de fermer et rouvrir l'app.

**Script Google** (`apps-script/`)
1. Modifie le fichier dans le dépôt et commit.
2. Copie le nouveau contenu dans l'éditeur Apps Script, puis enregistre.
3. Va dans Déployer → **Gérer les déploiements** → crayon (Modifier) → Version : **Nouvelle version** → Déployer. **L'adresse du script ne change pas**, les appareils n'ont rien à refaire.
4. Si `appsscript.json` demande une nouvelle autorisation, relance `verifier` pour l'accepter. Cette autorisation doit d'abord être validée par le propriétaire (section 7).

## 10. Développer et tester en local

```bash
python3 -m http.server 8000   # puis ouvre http://localhost:8000
```

Sans script Google, l'app reste sur l'écran de connexion. Pour tester sans toucher aux vraies données, utilise le test automatique, qui simule le script :

```bash
pip install playwright && python -m playwright install chromium
python tools/smoke_test.py    # captures d'écran dans tools/out/
```

Il sert l'app, se connecte avec un faux code, parcourt les onglets, ajoute des courses, ouvre la page des quêtes, et échoue en cas d'erreur JavaScript. Pour tester une nouvelle fonctionnalité, étends la fonction `handle()` de ce fichier.

Vérifie toujours le rendu sur téléphone (390 × 844) et sur ordinateur (1440 × 900).

## 11. Recettes courantes

**Ajouter une carte sur l'accueil**
1. Ajoute un `<section class="card s-xxx">` dans la `.grid` de `index.html`.
2. Sur ordinateur, la grille compte 12 colonnes et 2 rangées : ajuste les `grid-column: span N` dans `style.css`.
3. Écris une fonction `renderXxx()` et appelle-la depuis `render()`.

**Ajouter un nouveau type de données (nouvel onglet du Sheet)**
1. Dans `Code.gs`, ajoute l'onglet à `TABS` avec son nom, sa largeur et éventuellement un `header` pour qu'il soit créé automatiquement. Redéploie (section 9).
2. Dans `app.js` :
   - ajoute la clé dans `S`, dans `SHT` (avec la liste des colonnes, en terminant par `_t`) et dans les listes de clés du cache ;
   - ajoute la conversion dans `fromRow()` et `toRow()` si nécessaire ;
   - écris le rendu, puis utilise `addDoc()`, `upd()` et `delUndo()` pour les actions.

**Ajouter une action dans l'interface**
1. Mets un attribut `data-act="mon-action"` (et `data-id` si besoin) sur un bouton.
2. Ajoute un `else if (a === 'mon-action')` dans l'écouteur de clics global.

**Ajouter un onglet de navigation**
1. Ajoute un bouton `data-act="tab" data-tab="xxx"` dans `.tabbar`.
2. Ajoute la valeur dans la liste acceptée par `setTab()`.
3. Ajoute les règles CSS `body[data-tab="xxx"]` qui disent quelles cartes afficher.

**Courses** : l'affichage est volontairement simple (ni icône ni catégorie). Le rayon et l'icône sont tout de même devinés et enregistrés dans le Sheet (tableau `RAY` dans `app.js`) : il suffit de modifier `renderCourses()` pour les réafficher un jour.

## 12. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| En-tête absent, onglets qui ne réagissent pas, juste après une mise à jour | GitHub Pages sert un ancien `app.js` en cache | Vérifie que les numéros `?v=` ont bien été incrémentés (section 9). Ferme puis rouvre l'app. |
| « Code d'accès refusé ou changé » | Le code a été changé dans le script | Entre le nouveau code |
| « Trop d'essais ratés » | 10 codes faux envoyés | Attends 15 minutes |
| « Le script ne répond pas » | Pas de réseau, ou script en erreur | Regarde « Exécutions » dans l'éditeur Apps Script |
| « Adresse du script invalide » | L'adresse collée ne finit pas par `/exec` | Colle le lien d'installation complet ou l'adresse `/exec` seule |
| L'agenda reste vide ou `verifier` affiche « Agenda introuvable » | L'agenda n'est pas partagé ou pas ajouté dans le compte dédié | Section 8, étape 3 |
| « Impossible d'ouvrir le fichier » en ouvrant Apps Script | Plusieurs comptes Google connectés dans le navigateur | Utilise un navigateur ou une fenêtre privée connecté au seul compte dédié |
| « Échec de l'enregistrement » dans l'éditeur Apps Script | Comptes mélangés, ou contenu mal collé | Même solution, et recolle le fichier brut (« raw ») |
| Une modif du script n'est pas prise en compte | Le déploiement n'a pas été mis à jour | Gérer les déploiements → Nouvelle version |
| Les barres du téléphone ont l'ancienne couleur | Icône installée avant le changement | Supprime l'icône de l'écran d'accueil et réinstalle-la |

## 13. Pistes d'évolution

- Notifications (rappel quand une routine passe au rouge) : demanderait un déclencheur programmé dans le script et un canal d'envoi. À valider côté sécurité avant tout.
- Historique des routines (par exemple le suivi des médicaments).
- Tri des courses par magasin ou rayon personnalisé.
- Mode sombre propre. Il est volontairement désactivé aujourd'hui (`color-scheme: only light`), parce que le mode sombre forcé de certains téléphones cassait les couleurs.
