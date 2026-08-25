# 🚀 Déploiement GRATUIT de ChantierPro (guide pas à pas)

**Objectif** : mettre ChantierPro en ligne sur **Render.com** — 100 % gratuit, sans carte bancaire, avec HTTPS (nécessaire pour installer l'app sur les téléphones).
**Temps estimé** : 20-30 minutes la première fois.
**Matériel** : un ordinateur, ou un téléphone en mode « Version ordinateur » du navigateur.

---

## ⚠️ Les 2 limites du plan gratuit (important)

| Limite | Conséquence | Contournement |
|---|---|---|
| Le serveur s'endort après **15 min sans visite** | Premier chargement suivant ≈ 30-50 s (réveil) | **UptimeRobot** gratuit (étape 5) le garde éveillé ✅ |
| Le disque est **effacé à chaque redéploiement** | Les comptes connectés doivent se **reconnecter** | Tes données restent sur ton téléphone et se re-synchronisent automatiquement (conception offline-first) |

Pour la future version commerciale payante : disque persistant Render (~7 $/mois) ou base gratuite Neon (Postgres).

---

## ÉTAPE 1 — Créer un compte GitHub (5 min)

1. Va sur **https://github.com** → **Sign up**
2. Entre ton e-mail professionnel, crée un mot de passe, choisis un nom d'utilisateur
3. Confirme l'e-mail (code envoyé par mail)

## ÉTAPE 2 — Mettre le code sur GitHub (10 min)

1. Une fois connecté, clique sur **« + »** (en haut à droite) → **« New repository »**
2. Nom du dépôt : **`chantierpro`** → laisse **Public** → clique **« Create repository »**
3. Sur la page qui s'ouvre, clique sur le lien **« uploading an existing file »**
4. **Glisse-dépose (ou sélectionne) ces 14 fichiers** (ils sont dans le ZIP `ChantierPro-v3-cloud.zip` — décompresse-le d'abord) :

   À la racine :
   ```
   index.html · app.js · cloud.js · styles.css
   manifest.webmanifest · sw.js · icon.svg
   package.json · render.yaml · .gitignore · README.md
   ```
   Dans un dossier **`server/`** (crée-le via « Add file → Create new file → nommez `server/server.js` » OU glisse le dossier complet) :
   ```
   server/server.js · server/db.js · server/parser.js · server/package.json
   ```
   ⚠️ **Ne mets PAS** les dossiers `node_modules/`, `server/data/` ni les ZIP.

5. En bas, clique **« Commit changes »**

## ÉTAPE 3 — Déployer sur Render (5 min)

1. Va sur **https://render.com** → **Get Started for Free**
2. Inscris-toi **avec ton compte GitHub** (bouton « GitHub ») — ça relie les deux automatiquement
3. Dans le tableau de bord, clique **« + New »** → **« Web Service »**
4. Choisis ton dépôt **`chantierpro`** (s'il n'apparaît pas : « Configure account » → autorise Render sur le dépôt)
5. Render détecte le fichier `render.yaml` → tout est **pré-rempli** :
   - Name : `chantierpro` (ton adresse sera `https://chantierpro.onrender.com` — si le nom est pris, essaie `chantierpro-mg`, `chantierpro-tana`…)
   - Plan : **Free** ✔
6. Clique **« Deploy Web Service »** et attend 2-5 min (le journal défile ; le déploiement est fini quand tu vois **« Your service is live 🎉 »**)

## ÉTAPE 4 — Vérifier que ça marche (2 min)

1. Ouvre `https://TON-NOM.onrender.com/api/health` → tu dois voir :
   ```json
   {"ok":true,"app":"ChantierPro Cloud","version":"3.0"}
   ```
2. Ouvre `https://TON-NOM.onrender.com` → **ChantierPro s'affiche** avec la pastille cloud ☁️
3. Clique sur la pastille → **Créer un compte** (celui-ci sera TON compte pro)
4. Tes données locales se synchronisent automatiquement ☁️ (pastille 🌐 verte)
5. Sur ton téléphone : ouvre l'adresse → menu Chrome **⋮** → **« Installer l'application »** 🏗️

## ÉTAPE 5 — Garder le serveur éveillé (UptimeRobot, gratuit, 3 min)

Sinon le serveur s'endort après 15 min.

1. Va sur **https://uptimerobot.com** → **Register for FREE**
2. **+ Add New Monitor** :
   - Monitor Type : **HTTP(s)**
   - Friendly Name : `ChantierPro`
   - URL : `https://TON-NOM.onrender.com/api/health`
   - Interval : **5 minutes**
3. **Create Monitor** → fini ✅ UptimeRobot « ping » ton serveur toutes les 5 min → il ne dort jamais.

---

## ✅ Checklist finale

- [ ] `https://TON-NOM.onrender.com` s'ouvre et affiche ChantierPro
- [ ] Compte créé, pastille passée 🌐 verte
- [ ] App installée sur le téléphone (icône sur l'écran d'accueil)
- [ ] UptimeRobot actif (écran vert « Up »)
- [ ] Créé un lien de partage client et ouvert dans un navigateur privé (test de la vue client en lecture seule)

## 🆘 En cas de problème

| Symptôme | Solution |
|---|---|
| « Build failed » sur Render | Vérifie que `package.json` et `server/` sont bien à la racine du dépôt (pas dans un sous-dossier) |
| Page blanche après déploiement | Attends 1 min (réveil du serveur gratuit) puis recharge |
| 404 sur /api/health | Le déploiement n'est pas fini, regarde l'onglet « Logs » sur Render |
| « Session expirée » après un redéploiement | Normal (disque gratuit effacé) : reconnecte-toi, la synchro repart |

## 💰 Quand tu auras des clients payants

1. **Disque persistant Render (~7 $/mois)** → plus jamais de réinitialisation, ou
2. **Base Neon Postgres (gratuit)** → je migrerai db.js vers Postgres, ou
3. **Nom de domaine propre** (`app.chantierpro.mg` ≈ 60 000-150 000 Ar/an chez nic.mg ou Namecheap) + Render le sert gratuitement en HTTPS.
