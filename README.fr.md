[English](README.md) | [한국어](README.ko.md) | [中文](README.zh-CN.md) | [日本語](README.ja.md) | [Español](README.es.md) | [Português](README.pt-BR.md)

# limitai

> Outil CLI qui surveille l'utilisation des rate limits LLM sur Claude, Codex et CLIProxyAPI

**Tirez-vous vraiment le maximum de votre abonnement LLM ?**

Des outils comme [ccusage](https://github.com/yohasebe/ccusage) vous indiquent combien de tokens vous avez consommés — mais ce n'est pas la question qui compte. La vraie question est : *quelle part du quota que vous payez utilisez-vous réellement ?* Et si vous jonglez entre plusieurs comptes Claude, Codex ou services proxy, il n'existe aucun endroit unique pour tout visualiser.

**limitai** est un **moniteur CLI de rate limit** pour les utilisateurs avancés de LLM. Il affiche votre **utilisation des rate limits** sur chaque compte et provider dans une seule vue terminal — non pas combien vous avez dépensé, mais à quel point vous êtes proche du plafond que vous payez déjà, et quand ce plafond se réinitialise.

- **Multi-provider dashboard** — Claude (Anthropic), Codex (OpenAI), CLIProxyAPI dans une seule vue
- **Multi-account support** — comptes personnels, d'équipe et proxy, tous en même temps
- **Utilization-focused** — suivi du % d'utilisation par rapport à votre rate limit, pas des quantités brutes de tokens
- **Zero config** — détection automatique des credentials sur votre machine
- **Background recording** — `limitai install` configure un daemon LaunchAgent/systemd pour le suivi historique

<table align="center">
  <tr>
    <td colspan="2" align="center">
      <code>limitai status</code><br><br>
      <img src="img/status.png" alt="limitai status" width="600">
    </td>
  </tr>
  <tr>
    <td align="center">
      <code>limitai daily</code><br><br>
      <img src="img/daily.png" alt="limitai daily" width="400">
    </td>
    <td align="center">
      <code>limitai monthly</code><br><br>
      <img src="img/monthly.png" alt="limitai monthly" width="400">
    </td>
  </tr>
</table>

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash
```

S'installe dans `~/.local/bin` et met à jour votre PATH shell automatiquement.

### Options

```bash
# Version spécifique
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash -s -- --version v0.1.0

# Répertoire personnalisé
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash -s -- --dir /usr/local/bin
```

### Désinstallation

```bash
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash -s -- --uninstall
```

Supprime le binaire et nettoie les entrées PATH de vos profils shell.

### Plateformes supportées

| Plateforme | Architecture |
|----------|-------------|
| macOS | Apple Silicon (arm64) |
| macOS | Intel (x64) |
| Linux | x64 |
| Linux | arm64 |

## Démarrage rapide

```bash
# Voir vos rate limits maintenant
limitai status

# Découvrir tous les comptes sur cette machine
limitai list
```

## Activer le suivi historique

Par défaut, limitai n'affiche que des snapshots **en direct**. Exécutez `install` une seule fois pour débloquer la vue complète :

```bash
limitai install
# ✔ LaunchAgent registered (macOS) — polling every 5 min
# ✔ SQLite database created at ~/.limitai/data.db
# ✔ Adaptive polling active — speeds up near resets
#
# Done. limitai is now recording in the background.
# Run `limitai daily` anytime to see your history.
```

### Ce qui change après `install`

```
                    Before                              After
              ┌──────────────────┐             ┌──────────────────────────┐
              │                  │             │                          │
              │  limitai status  │             │  limitai status          │
              │  (live only)     │             │  limitai daily    ← NEW  │
              │                  │             │  limitai monthly  ← NEW  │
              │                  │             │                          │
              └──────────────────┘             └──────────────────────────┘
                  Manual run                      Automatic background
                  Point-in-time                   Continuous recording
```

> **Une seule commande. Pas de cron. Pas de fichiers de configuration.** Juste `limitai install` et oubliez-le.

### Ce que vous obtenez

| Avantage | Détail |
|---------|--------|
| **Daily utilization report** | Voyez l'intensité d'utilisation de chaque compte, fenêtre par fenêtre |
| **Monthly trends** | Repérez les tendances — atteignez-vous régulièrement 90%+ les mardis ? |
| **Peak tracking** | Connaissez votre utilisation maximale par fenêtre, pas seulement la moyenne |
| **Adaptive polling** | Interrogation toutes les 1 min près des resets, 5–10 min sinon — capture les moments qui comptent |
| **Survives reboots** | Scheduler natif de l'OS (LaunchAgent / systemd) — pas un processus d'arrière-plan fragile |
| **30-day rolling history** | Snapshots bruts conservés 30 jours, résumés quotidiens conservés indéfiniment |
| **Zero maintenance** | Pas de rotation de logs, pas de gonflement disque. SQLite gère tout |

### Fonctionnement interne

```
┌──────────────┐     poll      ┌───────────────┐    store     ┌──────────────┐
│  Codex API   │◄─────────────►│               │─────────────►│              │
│  Claude CLI  │   every 1-10  │   limitai     │              │   SQLite     │
│  CLIProxyAPI │   min (smart) │   background  │              │   ~/.limitai │
└──────────────┘               │   daemon      │              │   /data.db   │
                               └───────────────┘              └──────┬───────┘
                                                                     │
                                                        ┌────────────┼────────────┐
                                                        │            │            │
                                                        ▼            ▼            ▼
                                                   limitai      limitai      limitai
                                                    status       daily       monthly
```

### Désinstaller à tout moment

```bash
limitai uninstall
# ✔ LaunchAgent removed. No data deleted.
# To also remove history: rm -rf ~/.limitai
```

## Toutes les commandes

```bash
limitai status          # Dashboard rate limit en direct (rafraîchissement automatique)
limitai list            # Afficher tous les comptes découverts
limitai daily           # Historique d'utilisation quotidienne
limitai monthly         # Historique d'utilisation mensuelle
limitai install         # Démarrer le daemon d'enregistrement en arrière-plan
limitai uninstall       # Supprimer le daemon
limitai doctor          # Diagnostiquer les problèmes de connexion
limitai watch           # Exécuter la boucle de polling en avant-plan
```

## Licence

MIT
