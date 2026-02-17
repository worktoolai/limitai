[English](README.md) | [한국어](README.ko.md) | [中文](README.zh-CN.md) | [日本語](README.ja.md) | [Français](README.fr.md) | [Português](README.pt-BR.md)

# limitai

> Herramienta CLI que monitorea la utilización de rate limit de LLM en Claude, Codex y CLIProxyAPI

**¿Estás aprovechando al máximo tu suscripción de LLM?**

Herramientas como [ccusage](https://github.com/yohasebe/ccusage) te dicen cuántos tokens consumiste, pero esa no es la pregunta que importa. La pregunta real es: **¿cuánto de la cuota que estás pagando realmente estás usando?** Y si manejas múltiples cuentas entre Claude, Codex o servicios proxy, no hay un solo lugar donde puedas verlo todo.

**limitai** es un **monitor CLI de rate limit** para usuarios avanzados de LLM. Muestra tu **utilización de rate limit** en cada cuenta y provider en una sola vista de terminal — no cuánto gastaste, sino qué tan cerca estás del techo que ya estás pagando, y cuándo se reinicia.

- **Multi-provider dashboard** — Claude (Anthropic), Codex (OpenAI), CLIProxyAPI en una sola vista
- **Multi-account support** — cuentas personales, de equipo y proxy, todas a la vez
- **Utilization-focused** — rastrea el % de uso contra tu rate limit, no cantidades brutas de tokens
- **Zero config** — detecta automáticamente las credenciales de tu máquina
- **Background recording** — `limitai install` configura un daemon LaunchAgent/systemd para seguimiento histórico

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

## Instalación

```bash
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash
```

Se instala en `~/.local/bin` y actualiza tu PATH del shell automáticamente.

### Opciones

```bash
# Versión específica
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash -s -- --version v0.1.0

# Directorio personalizado
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash -s -- --dir /usr/local/bin
```

### Desinstalar

```bash
curl -fsSL https://raw.githubusercontent.com/worktoolai/limitai/main/install.sh | bash -s -- --uninstall
```

Elimina el binario y limpia las entradas de PATH de tus perfiles de shell.

### Plataformas soportadas

| Plataforma | Arquitectura |
|----------|-------------|
| macOS | Apple Silicon (arm64) |
| macOS | Intel (x64) |
| Linux | x64 |
| Linux | arm64 |

## Inicio rápido

```bash
# Ver tus rate limits ahora mismo
limitai status

# Descubrir todas las cuentas en esta máquina
limitai list
```

## Habilitar seguimiento histórico

Por defecto, limitai solo muestra snapshots **en vivo**. Ejecuta `install` una vez para desbloquear la visión completa:

```bash
limitai install
# ✔ LaunchAgent registered (macOS) — polling every 5 min
# ✔ SQLite database created at ~/.limitai/data.db
# ✔ Adaptive polling active — speeds up near resets
#
# Done. limitai is now recording in the background.
# Run `limitai daily` anytime to see your history.
```

### Qué cambia después de `install`

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

> **Un comando. Sin cron. Sin archivos de configuración.** Solo `limitai install` y olvídate.

### Lo que obtienes

| Beneficio | Detalle |
|---------|--------|
| **Daily utilization report** | Mira qué tan intensamente usaste cada cuenta, ventana por ventana |
| **Monthly trends** | Detecta patrones — ¿estás alcanzando consistentemente el 90%+ los martes? |
| **Peak tracking** | Conoce tu uso más alto por ventana, no solo el promedio |
| **Adaptive polling** | Consulta cada 1 min cerca de resets, 5–10 min en otro caso — captura los momentos que importan |
| **Survives reboots** | Scheduler nativo del OS (LaunchAgent / systemd) — no un proceso frágil en segundo plano |
| **30-day rolling history** | Snapshots crudos conservados 30 días, resúmenes diarios conservados para siempre |
| **Zero maintenance** | Sin rotación de logs, sin inflación de disco. SQLite se encarga de todo |

### Cómo funciona internamente

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

### Desinstalar en cualquier momento

```bash
limitai uninstall
# ✔ LaunchAgent removed. No data deleted.
# To also remove history: rm -rf ~/.limitai
```

## Todos los comandos

```bash
limitai status          # Dashboard de rate limit en vivo (auto-refresco)
limitai list            # Mostrar todas las cuentas descubiertas
limitai daily           # Historial de utilización diaria
limitai monthly         # Historial de utilización mensual
limitai install         # Iniciar daemon de grabación en segundo plano
limitai uninstall       # Eliminar daemon
limitai doctor          # Diagnosticar problemas de conexión
limitai watch           # Ejecutar bucle de polling en primer plano
```

## Licencia

MIT
