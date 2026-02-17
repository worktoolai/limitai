[English](README.md) | [한국어](README.ko.md) | [中文](README.zh-CN.md) | [日本語](README.ja.md) | [Español](README.es.md) | [Português](README.pt.md)

# limitai

> Outil CLI qui surveille l'utilisation des limites de débit LLM sur Claude, Codex et CLIProxyAPI

**Tirez-vous vraiment le meilleur parti de votre abonnement LLM ?**

Des outils comme [ccusage](https://github.com/yohasebe/ccusage) suivent le nombre de tokens que vous avez consommés — mais ce n'est pas la question qui compte. La vraie question est : *quelle part du quota que vous payez utilisez-vous réellement ?* Et si vous jonglez avec plusieurs comptes sur Claude, Codex ou des services proxy, il n'y a aucun endroit unique pour tout visualiser.

**limitai** est un **moniteur CLI de limites de débit** pour les utilisateurs avancés de LLM. Il affiche votre **utilisation des limites de débit** sur chaque compte et fournisseur dans une seule vue terminal — non pas combien vous avez dépensé, mais à quel point vous êtes proche du plafond que vous payez déjà, et quand ce plafond se réinitialise.

- **Dashboard multi-fournisseur** — Claude (Anthropic), Codex (OpenAI), CLIProxyAPI dans une seule vue
- **Support multi-compte** — comptes personnels, d'équipe et proxy, tous en même temps
- **Axé sur l'utilisation** — suivi du % d'utilisation par rapport à votre limite de débit, pas des comptages bruts de tokens
- **Zéro configuration** — découvre automatiquement les identifiants sur votre machine
- **Enregistrement en arrière-plan** — `limitai install` configure un daemon LaunchAgent/systemd pour le suivi historique

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

S'installe dans `~/.local/bin` et met à jour automatiquement le PATH de votre shell.

### Options

```bash
# Specific version
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash -s -- --version v0.1.0

# Custom directory
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

## Démarrage Rapide

```bash
# See your rate limits right now
limitai status

# Discover all accounts on this machine
limitai list
```

## Activer le Suivi Historique

Par défaut, limitai affiche uniquement des instantanés **en direct**. Exécutez `install` une fois pour débloquer la vue complète :

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
| **Daily utilization report** | Voyez à quel point vous avez sollicité chaque compte, fenêtre par fenêtre |
| **Monthly trends** | Repérez les tendances — atteignez-vous régulièrement 90%+ les mardis ? |
| **Peak tracking** | Connaissez votre utilisation maximale par fenêtre, pas seulement la moyenne |
| **Adaptive polling** | Interrogation toutes les 1 min près des réinitialisations, 5–10 min sinon — capture les moments qui comptent |
| **Survives reboots** | Planificateur natif de l'OS (LaunchAgent / systemd) — pas un processus fragile en arrière-plan |
| **30-day rolling history** | Instantanés bruts conservés 30 jours, résumés quotidiens conservés indéfiniment |
| **Zero maintenance** | Pas de rotation de logs, pas de gonflement du disque. SQLite gère tout |

### Comment ça fonctionne en interne

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

### Désinstallez à tout moment

```bash
limitai uninstall
# ✔ LaunchAgent removed. No data deleted.
# To also remove history: rm -rf ~/.limitai
```

## Toutes les Commandes

```bash
limitai status          # Live rate limit dashboard (auto-refreshes)
limitai list            # Show all discovered accounts
limitai daily           # Daily utilization history
limitai monthly         # Monthly utilization history
limitai install         # Start background recording daemon
limitai uninstall       # Remove daemon
limitai doctor          # Diagnose connection issues
limitai watch           # Run foreground polling loop
```

## Licence

MIT