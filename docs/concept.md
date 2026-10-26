# Mood Board App — Konzept

> Stand: 2026-10-26 · Status: Entwurf zur Review

## 1. Leitidee

Ein selbst gehostetes, team-weites **Design-Gedächtnis**. Kein Bildarchiv, sondern eine
durchsuchbare, maschinenlesbare Referenz-Datenbank.

Entscheidend ist die Konsumenten-Reihenfolge:

1. **Claude Code / Claude Design** — der wichtigste Konsument. Holt strukturierte Referenzen,
   um daraus Code und Designs zu bauen.
2. **Menschen** — pflegen Inhalte ein, kuratieren und stöbern.

Daraus folgt die wichtigste Architekturregel des Projekts:

> **Die Qualität der strukturierten Metadaten ist das Produkt.** Das Frontend ist Zubehör.
> Ein Bild mit dem Tag „schön" ist wertlos. Ein Bild mit
> `{pattern: hero, layout: split-left-text, motion: parallax-on-scroll, palette: [...], type_pairing: [...]}`
> ist das, was die App wertvoll macht.

Jede Abwägung in diesem Dokument fällt zugunsten der Metadatenqualität.

## 2. Entschiedener Rahmen

| Thema | Entscheidung |
|---|---|
| Hosting | Linux-Server mit k3s. Zielgröße: 16 GB verfügbarer RAM |
| Deployment | **k3s** via **ArgoCD**, generisches Helm-Chart, **HostPath-Volumes** (§4.2) |
| Ingress | **Traefik `IngressRoute`** als Standard, `Ingress` als Option (§4.4) |
| Domain | per Chart-Value, z. B. `moodboard.example.com` |
| Postgres | **Externe Abhängigkeit** — per Values angebunden, nicht im Chart enthalten (§4.3) |
| IdP | **Externe Abhängigkeit** — Authentik per OIDC (§4.5) |
| Queue | **Valkey** statt Redis (BSD-Lizenz), `deploy`-Flag im Chart |
| Registry | **GHCR**, Build und Push über GitHub Actions (§4.8) |
| Erreichbarkeit | Über Internet, via Cloudflare Tunnel (kein offener Port) |
| Sichtbarkeit | **Alle Assets für alle Nutzer sichtbar**, nach Autor filterbar. Keine privaten Assets. |
| Taxonomie | Kontrolliertes Facetten-Vokabular **+** freie Tags — Vokabular in §6 **freigegeben** |
| Volumen | Einige hundert Assets pro Jahr |
| Vorgehen | **Phasen** (§11). Phase 1: Übersicht + Klassifizierung + Website-Capture |
| Embeddings | **Nicht in Phase 1** — Begründung in §7.6 |
| Boards | **Phase 3.** Zweck: Übergabepaket an die KI (§5.4, §10.1) |
| LLM | Claude als Default, Provider austauschbar |

### Volumen-Konsequenz

Einige hundert Assets pro Jahr ist nach Datenbank-Maßstäben **nichts**. Das erlaubt bewusst
einfache Entscheidungen, die bei Millionen Assets falsch wären:

- Keine Sharding-, Caching- oder CDN-Komplexität.
- Filter-Performance ist irrelevant. Das Schema wird nach **Korrektheit und Pflegbarkeit**
  entworfen, nicht nach Query-Geschwindigkeit.
- Semantische Suche ist verzichtbar (§7.6).
- Pro Asset darf die Klassifizierung ruhig teuer sein (§7.4). Qualität vor Durchsatz.
- Horizontale Skalierung ist kein Entwurfsziel. k3s wird hier als *Betriebsmodell* genutzt
  (deklaratives Deployment, Secrets, Rollouts, Neustart-Verhalten), nicht als Skalierungswerkzeug.

### Was von Anfang an stehen muss

Die meisten Features sind **additiv** und jederzeit nachrüstbar — Boards etwa sind drei Tabellen
mit Fremdschlüsseln auf `asset`. Nur drei Dinge sind es nicht und gehören deshalb in Phase 1,
obwohl sie dort noch keinen sichtbaren Nutzen haben:

| Was | Warum nicht nachrüstbar |
|---|---|
| `origin`-Spalte (`ai` / `human`) auf allen Metadaten | Wird sie später eingeführt, lässt sich für Bestandsdaten nicht mehr rekonstruieren, was ein Mensch korrigiert hat — die erste Reanalyse überschreibt dann alles (§5.6) |
| `analysis_run` mit `prompt_version` | Ohne Protokoll von Anfang an ist später unbekannt, welches Asset mit welchem Modell und welcher Prompt-Version klassifiziert wurde. Gezielte Reanalyse wird damit unmöglich |
| `StorageService`-Interface | Nachträglich eingezogen heißt: jeden Dateizugriff im Code anfassen |

Alles andere darf warten.

## 3. Technologie-Stack

```
Nx-Monorepo
├── apps/api        NestJS    REST-API, Auth (OIDC/BFF), Suche, MCP-Endpoint
├── apps/worker     NestJS    BullMQ-Consumer: Thumbnails, Capture, Klassifizierung
├── apps/web        Angular   Signals, Standalone Components, Tailwind
├── libs/shared     —         Zod-Schemas, Facetten-Vokabular, DTOs (von allen geteilt)
├── libs/classify   —         Provider-Interface + Adapter (Anthropic, später weitere)
└── deploy/chart    —         Helm-Chart für k3s
```

| Baustein | Wahl | Begründung |
|---|---|---|
| Monorepo | Nx | Erstklassige Angular+Nest-Integration; `libs/shared` erlaubt **ein** Zod-Schema für Backend-Validierung, Frontend-Formulare und LLM-Structured-Output. Eine Taxonomie-Änderung bricht dann zur Compile-Zeit auf, nicht zur Laufzeit. |
| Backend | NestJS | Das Backend ist der Hauptteil: Queues, langlaufende Capture- und Analyse-Jobs, MCP-Server. `@nestjs/bullmq` deckt das direkt ab. |
| Frontend | Angular + Tailwind | Vorhandene Expertise. Tailwind statt Material/PrimeNG, weil eine Bildgalerie eigenes Layout braucht und Komponentenbibliotheken hier mehr im Weg stehen als helfen. |
| ORM | **Drizzle** | SQL-Nähe für die kombinierten Facetten-Abfragen. Prisma und TypeORM sind bei handgeschriebenem SQL und pgvector (später) beide schwächer. |
| DB | PostgreSQL (extern) | Volltext per `tsvector`. pgvector wird erst ab Phase 4 gebraucht (§7.6) |
| Queue | **Valkey** + BullMQ | Valkey ist der BSD-lizenzierte Fork unter der Linux Foundation, nachdem Redis 2024 auf RSALv2/SSPL gewechselt ist. Protokollkompatibel zu Redis 7.2 — BullMQ spricht über ioredis mit Lua-Skripten, die unverändert laufen. |
| Bilder | sharp | Thumbnails, Farbextraktion, Normalisierung. |
| Capture | Playwright + ffmpeg | Screenshot, Scroll-Video, Keyframes, DOM/CSS-Extraktion (§8) |
| MCP | `@modelcontextprotocol/sdk` | Streamable-HTTP-Transport, als NestJS-Controller gemountet. |
| Auth | Authentik (OIDC) | Extern angebunden. OIDC in der App statt Traefik-ForwardAuth, weil die Identität als Datensatz gebraucht wird (§4.5) |
| Deployment | Helm-Chart, Sync über **ArgoCD** | Generische Defaults im Repo, Umgebungswerte in der ArgoCD Application (§4.3) |

## 4. Deployment-Architektur (k3s)

```
                         Internet
                            │
                   Cloudflare Tunnel
                            │
                   ┌────────▼─────────┐
                   │   cloudflared    │  Deployment, keine offenen Ports
                   └────────┬─────────┘
                            │
                   ┌────────▼─────────┐
                   │ Traefik          │  IngressRoute
                   │ moodboard.       │
                   │ example.com      │
                   └────────┬─────────┘
                            │
                     ┌──────▼──────┐
                     │     web     │  nginx, statisches Angular-Bundle
                     └──────┬──────┘
                            │
                     ┌──────▼──────┐          ┌─ ─ ─ ─ ─ ─ ─ ─ ┐
                     │     api     │◄────────►│   authentik    │
                     │ REST + MCP  │  OIDC    │    (extern)    │
                     └──┬───────┬──┘          └─ ─ ─ ─ ─ ─ ─ ─ ┘
                        │       │
          ┌─ ─ ─ ─ ─ ─ ─▼─┐  ┌──▼────────┐
          │   postgres    │  │  valkey   │
          │   (extern)    │  │  (queue)  │
          │               │  └──▲────────┘
          └─ ─ ─ ─ ─ ─ ▲─ ┘     │
                       │        │
                    ┌──┴────────┴──────────┐
                    │        worker        │  sharp + Chromium + ffmpeg + LLM
                    │  /dev/shm 1Gi        │
                    └──────────┬───────────┘
                               │
                      ┌────────▼────────────┐
                      │ HostPath            │
                      │ /srv/moodboard/…    │
                      └─────────────────────┘

   ┌─ ─ ┐  gestrichelt = externe Dienste, per Values angebunden
```

### 4.1 Was k3s gegenüber Docker Compose ändert

| Compose-Annahme | k3s-Realität |
|---|---|
| Caddy als Reverse Proxy | **Traefik `IngressRoute`** (§4.4) |
| Bind-Mount `/data` | **HostPath-Volume** (§4.2) |
| `.env`-Datei | **k8s Secrets**, per `existingSecret` in den Values referenziert |
| `docker compose up` | **Helm-Release**, versioniert und über `helm rollback` rückrollbar |

### 4.2 Storage: HostPath

Entscheidung: **HostPath**. Chart-Default: `/srv/moodboard/assets`, per Value überschreibbar.

Vorteile: kein Provisioner, kein PVC-Lebenszyklus, und die Dateien liegen offen im
Node-Dateisystem — unmittelbar inspizierbar und mit vorhandenen Mitteln (rsync, Snapshots, Borg)
backupfähig.

**`nodeAffinity` für `api` und `worker` auf denselben Node.** Beide brauchen Zugriff auf
dieselben Dateien: der Worker schreibt Thumbnails und Captures, die API liest sie aus. Bei einem
Node ist das trivial — aber explizit, damit es bei einer späteren Cluster-Erweiterung nicht
stillschweigend bricht, sondern der Pod sichtbar nicht mehr schedulebar ist.

#### Dateirechte: UID 1000, nicht root

Der Kernel prüft Rechte anhand **numerischer UID/GID**; Benutzernamen existieren im
Container-Namespace unabhängig vom Host. Gehört das Verzeichnis `root:root` mit `755` und läuft
der Container als UID 1000, scheitert jeder Schreibzugriff mit `EACCES`.

Das Fehlerbild ist heimtückisch: **Der Pod startet völlig sauber.** Beim Mounten werden keine
Rechte geprüft — erst der erste Upload schlägt fehl, möglicherweise Tage später, und sieht dann
wie ein Anwendungsfehler aus.

Der Fallstrick: **`fsGroup` im `securityContext` wirkt bei HostPath nicht.** Kubernetes übernimmt
Ownership-Management nur für Volume-Typen, die es unterstützen; `hostPath` gehört nicht dazu. Die
Einstellung wird akzeptiert und ignoriert.

**Warum nicht einfach als root laufen?** Technisch möglich und spart das `chown`. Dagegen spricht
ein konkreter Grund, nicht allgemeine Hygiene: Der Worker lädt **per Design beliebige fremde
Websites** in Chromium. Browser sind die am häufigsten angegriffene Software überhaupt, und in
Containern läuft Chromium üblicherweise mit `--no-sandbox`, weil die browsereigene Sandbox
Capabilities benötigt, die im Pod nicht verfügbar sind. Damit ist der Container die einzige
verbleibende Isolationsschicht — und ein HostPath-Mount durchbricht sie an einer definierten
Stelle. Root + HostPath + `--no-sandbox` + Code von fremden Servern ist die Kombination, bei der
ein Browser-Exploit unmittelbar Schreibzugriff als root auf das Host-Dateisystem erhält.

Der Aufwand für die Alternative ist ein einmaliger Befehl:

```bash
sudo mkdir -p /srv/moodboard/assets
sudo chown -R 1000:1000 /srv/moodboard
```

dazu im Chart `runAsUser: 1000`, `runAsGroup: 1000` als Default. Wer andere HostPath-Dienste
betreibt, überschreibt die UID passend per Value.

Der Umstieg auf S3/MinIO bleibt über das `StorageService`-Interface offen, falls später mehrere
Nodes dazukommen — dann ist es ein Adapter-Tausch plus Datenmigration, kein Umbau.

Layout: `/srv/moodboard/assets/<asset-id>/original.<ext>`, `thumb-{sm,md,lg}.webp`,
`capture.webm`, `poster.webp`, `frames/NN.webp`.

### 4.3 Chart-Values und ArgoCD

Das Chart liefert keine eigenen Postgres- oder Authentik-Instanzen, sondern erwartet sie als
Konfiguration. Valkey ist optional mitgeliefert.

Die `values.yaml` im Repository enthält ausschließlich **generische Defaults**. Die
umgebungsspezifischen Werte — Domain, Issuer-URL, Secret-Namen, UID — werden beim Deployment
über die **ArgoCD Application** überschrieben und liegen damit außerhalb dieses Repositorys.
Eine `values.local.yaml` gibt es deshalb nicht.

```yaml
image:
  registry: ghcr.io/<owner>
  tag: ""                            # default: Chart.AppVersion
  pullSecret: ghcr-pull

ingress:
  kind: IngressRoute                 # IngressRoute | Ingress
  host: moodboard.example.com
  entryPoints: [websecure]
  middlewares: []                    # z. B. compress, security-headers
  tls:
    certResolver: ""                 # oder:
    secretName: ""

postgres:
  existingSecret: moodboard-db       # host, port, database, user, password

oidc:
  issuerUrl: https://auth.example.com/application/o/moodboard/
  clientId: moodboard
  existingSecret: moodboard-oidc     # clientSecret

valkey:
  deploy: true                       # false → externe Instanz nutzen
  host: ""                           # nur bei deploy: false
  port: 6379

storage:
  hostPath: /srv/moodboard/assets
  runAsUser: 1000
  runAsGroup: 1000

llm:
  provider: anthropic
  model: claude-opus-5
  existingSecret: moodboard-llm      # API-Key
  monthlyCostLimitUsd: 25

worker:
  concurrency: 2
  shmSize: 1Gi
  resources:
    requests: { memory: 512Mi, cpu: 250m }
    limits:   { memory: 2.5Gi, cpu: "2" }
```

**Backup bleibt außerhalb der App.** Bei einem Gedächtnis-System ist Datenverlust der einzige
unumkehrbare Fehler, deshalb einmal explizit: Die Datenbank läuft unter CloudNativePG, das
Backups und Point-in-Time-Recovery kann — entscheidend ist, dass der **Restore einmal
durchgespielt** wurde. Ein nie getesteter Restore-Pfad ist kein Backup. Für die Asset-Dateien auf
dem HostPath gilt dasselbe; sie sind nicht aus der Datenbank rekonstruierbar.

### 4.4 Ingress: IngressRoute

`IngressRoute` ist der Standard im Zielcluster und damit Default im Chart; die generische
`Ingress`-Variante bleibt per `ingress.kind` wählbar, damit das Chart nicht an Traefik gebunden
ist.

Praktischer Unterschied: `IngressRoute` erlaubt Middlewares und Router-Regeln als
First-Class-Felder statt über Annotationen, was besonders bei TLS und Header-Manipulation
übersichtlicher bleibt.

### 4.5 Authentik: OIDC in der App, nicht ForwardAuth

Authentik wird **per OIDC in der Anwendung** angebunden (Authorization Code Flow mit PKCE,
BFF-Pattern, HttpOnly-Cookie), nicht über die Traefik-ForwardAuth-Middleware.

Begründung: Die App braucht die Identität als **Datensatz**, nicht nur als Request-Header —
`created_by` an jedem Asset, persönliche API-Tokens für den MCP-Zugriff, Audit-Log. Dazu kommt,
dass MCP-Clients mit einem Bearer-Token statt einer Browser-Session kommen; eine
ForwardAuth-Middleware davor würde sie abweisen.

In Authentik werden dafür eine Application und ein OIDC-Provider `moodboard` mit den
Redirect-URIs angelegt.

### 4.6 Playwright in Kubernetes

Drei Punkte, die im Manifest stehen müssen, sonst scheitert Capture reproduzierbar:

- **`/dev/shm` vergrößern.** Container liefern standardmäßig 64 MB; Chromium stürzt damit bei
  größeren Seiten ab. Lösung: `emptyDir` mit `medium: Memory` und `sizeLimit: 1Gi` als
  `/dev/shm` gemountet. Das ist der häufigste Grund für „läuft lokal, stirbt im Cluster".
- **Resource Limits.** `requests: 512Mi`, `limits: 2.5Gi`. Ein OOM-Kill des Workers darf die
  API nicht mitnehmen — deshalb getrennte Deployments.
- **Nebenläufigkeit auf 2 begrenzt**, damit zwei parallele Video-Captures die Speicherspitze
  nicht verdoppeln.

### 4.7 Speicherbudget (16 GB verfügbar)

Postgres und Authentik sind externe Dienste und hier nicht mitgerechnet.

| Workload | Regelbetrieb | Spitze |
|---|---|---|
| valkey | 100 MB | 200 MB |
| api | 400 MB | 700 MB |
| web (nginx, statisch) | 50 MB | 50 MB |
| worker (Chromium + ffmpeg) | 500 MB | **2,5 GB** |
| cloudflared | 50 MB | 100 MB |
| **Summe** | **~1,1 GB** | **~3,5 GB** |

### 4.8 Build & Registry: GHCR über GitHub Actions

Drei Images: `api`, `worker`, `web`. Build und Push über GitHub Actions nach **GHCR**.

Gegen Docker Hub spricht hier ein handfestes Limit: Der Free-Tier erlaubt genau **ein privates
Repository** — wir brauchen drei. GHCR hat unbegrenzt private Pakete, und in Actions reicht der
automatisch bereitgestellte `GITHUB_TOKEN` zum Pushen, also kein zusätzliches Secret und kein
Rotationsthema. Dazu entfallen die Docker-Hub-Pull-Limits, die bei Image-Pulls im Cluster
gelegentlich zuschlagen.

Tagging: `sha-<commit>` für jeden Build, dazu `v<semver>` bei Releases. Der eigentliche Gewinn
ist der Rollback — `helm rollback` auf das vorige Image-Tag ist eine Sache von Sekunden.

Im Cluster ein `imagePullSecret` (`ghcr-pull`) mit einem Read-only-PAT, sofern die Packages
privat bleiben.

### 4.9 Lokale Entwicklung

Kein k3s auf dem Entwicklungsrechner. Statt Dev- und Prod-Manifeste doppelt zu pflegen:

- `api`, `worker`, `web` laufen über `nx serve` direkt auf dem Host: schnelles HMR, normales
  Debugging, kein Image-Build pro Änderung.
- Postgres und Valkey als Abhängigkeiten — per Docker Compose lokal oder per SSH-Tunnel gegen
  eine bestehende Instanz.
- Das Helm-Chart ist allein Deployment-Artefakt und wird in CI gegen `helm template` validiert.

### 4.10 Betriebsrisiko: IdP als Single Point of Failure

Authentik muss aus dem Internet erreichbar sein (der OIDC-Redirect läuft über den Browser des
Nutzers) und ist damit kritischer Pfad. Fällt Authentik aus, kommt **niemand** mehr in die App,
auch nicht der Admin.

**Gegenmaßnahme:** ein lokaler Notfall-Admin-Zugang, der nicht über SSO läuft — Login nur aus dem
LAN, separat gehashtes Passwort, per Konfigurationsflag abschaltbar, jede Nutzung im Audit-Log.

### 4.11 Datenbank-Migrationen unter GitOps

Mit ArgoCD läuft kein `helm upgrade` von Hand, also brauchen Drizzle-Migrationen einen
definierten Platz im Sync-Ablauf. Sonst startet die neue Anwendungsversion gegen ein altes
Schema — ein Fehler, der sich als scheinbar zufälliger Laufzeitfehler äußert.

Lösung: ein Migrations-`Job` mit `argocd.argoproj.io/hook: PreSync`. ArgoCD führt ihn vor dem
eigentlichen Rollout aus und bricht den Sync ab, wenn er fehlschlägt. Helm-eigene
`pre-upgrade`-Hooks sind hier das falsche Werkzeug, weil ArgoCD das Chart nur rendert und die
Hook-Semantik von Helm nicht anwendet.

Daraus folgt eine Regel für alle Migrationen: Sie müssen **vorwärtskompatibel** sein. Zwischen
PreSync-Job und fertigem Rollout läuft für kurze Zeit die alte Anwendungsversion gegen das neue
Schema. Spalten werden also erst hinzugefügt und später in einem getrennten Release entfernt,
nie beides in einem Schritt.

## 5. Datenmodell

Phase-1-Umfang ist §5.1 bis §5.3 und §5.5. Boards (§5.4) kommen in Phase 3.

### 5.1 Kern

```
user                 id, sub (OIDC), email, display_name, role (admin|member), created_at
asset                id, type, title, description, created_by, created_at, updated_at,
                     source_url, license, status (pending|ready|failed),
                     deleted_at            -- Soft-Delete, 30-Tage-Papierkorb
asset_file           id, asset_id, kind (original|thumb_sm|...|capture|poster|frame),
                     path, mime, width, height, bytes, duration_ms
```

### 5.2 Taxonomie

Kontrolliertes Vokabular **normalisiert** (nicht als JSONB), damit Referenzintegrität gilt und
ein Wert global umbenennbar ist, ohne alle Assets anzufassen:

```
facet                id, key, label, description, is_multi_value
facet_value          id, facet_id, value, label, description, sort_order
asset_facet_value    asset_id, facet_value_id,
                     origin (ai|human),        -- wer hat es gesetzt
                     confidence,               -- nur bei origin=ai
                     set_by, set_at
tag                  id, name, created_by      -- freie Tags, flach
asset_tag            asset_id, tag_id, origin, set_by, set_at
```

### 5.3 Farbe, Suche & Capture-Technik

```
asset_color          asset_id, hex, lab_l, lab_a, lab_b, ratio, position
                     -- Lab-Werte, damit Farbnähe perzeptuell statt im RGB-Raum gesucht wird
asset_search         asset_id, tsv tsvector    -- Volltext, generated column
capture_tech         asset_id, fonts jsonb, css_properties jsonb,
                     libraries jsonb, viewport, captured_at
                     -- Ergebnis der Technik-Extraktion aus §8
asset_embedding      asset_id, model, dim, embedding vector(N), created_at
                     -- erst ab Phase 4 (§7.6), hier nur zur Vollständigkeit
```

### 5.4 Boards — das Übergabepaket an die KI (Phase 3)

Zwei Dinge, die leicht verschmelzen, sind hier bewusst getrennt:

- **Facetten/Tags** beschreiben, *was ein Asset ist*. Automatisch vergebbar, kontextunabhängig.
- Ein **Board** ist eine *kuratierte Kombination für einen Zweck* — und laut Anforderung
  ausdrücklich das **Paket, das der KI zur Bearbeitung übergeben wird**.

Das macht das Board zur wichtigsten Datenstruktur für den Hauptkonsumenten und verlangt mehr als
eine Asset-Liste:

```
board            id, title, briefing, kind (manual|smart), created_by, created_at
                 -- briefing: Freitext. Was soll daraus entstehen?
board_item       board_id, asset_id, position,
                 role,     -- color | layout | typography | motion | imagery | copy | overall
                 weight,   -- primary | secondary | avoid
                 note      -- "nur die Animation, nicht die Farben"
board_filter     board_id, filter_json        -- nur kind=smart
```

**Warum `role` das entscheidende Feld ist:** Bekommt ein Modell sieben Bilder ohne Rollen, muss
es raten, welcher Aspekt jedes Bildes gemeint ist — und produziert Mischmasch aus sieben
Richtungen. Mit `role` ist die Aussage eindeutig: *dieses* Asset liefert die Palette, *jenes*
das Layout, *dieses* nur die Bewegung. Dasselbe Asset kann in zwei Boards verschiedene Rollen
haben.

**Warum `weight: avoid` existiert:** Negativbeispiele sind in Design-Briefings oft präziser als
Positivbeispiele. „So ausdrücklich *nicht*" schließt einen ganzen Lösungsraum aus, den sonst
niemand ausschließt.

Diese drei Tabellen sind rein additiv — Fremdschlüssel auf `asset`, sonst nichts. Sie in Phase 1
anzulegen hätte keinen Vorteil.

### 5.5 Nachvollziehbarkeit

```
analysis_run         id, asset_id, provider, model, prompt_version,
                     input_tokens, output_tokens, cost_usd,
                     raw_response jsonb,       -- rohe LLM-Antwort als Audit-Trail
                     status, error, created_at
audit_log            id, user_id, action, entity, entity_id, diff jsonb, created_at
```

`analysis_run` erfüllt drei Zwecke und gehört deshalb in Phase 1: Reproduzierbarkeit (welches
Modell mit welcher Prompt-Version hat das erzeugt?), gezielte Reanalyse (alles unter
`prompt_version < N` neu laufen lassen) und Kostentransparenz.

### 5.6 Die zentrale Invariante

> `origin = 'human'` gewinnt **immer** gegen `origin = 'ai'`.

Eine Reanalyse darf menschliche Korrekturen niemals überschreiben. Ohne diese Regel wird die
mühsam korrigierte Datenqualität beim nächsten Taxonomie-Update stillschweigend vernichtet — der
häufigste Weg, auf dem solche Systeme das Vertrauen ihrer Nutzer verlieren. Sie wird auf
Datenbankebene durchgesetzt, nicht in der Anwendungslogik.

## 6. Facetten-Vokabular

**Freigegeben.** `is_multi_value` bedeutet: mehrere Werte pro Asset erlaubt.

| Facette | Multi | Werte (Startmenge) |
|---|---|---|
| `type` | nein | image, component, font, palette, website |
| `ui_pattern` | ja | hero, nav, footer, pricing, card, form, table, dashboard, onboarding, auth, empty-state, modal, sidebar, gallery, testimonial, cta, blog-post, product-detail |
| `style` | ja | minimal, brutalist, neo-brutal, glassmorphism, editorial, swiss, retro, memphis, corporate, playful, luxury, tech, organic, maximalist |
| `mood` | ja | ruhig, energetisch, luxuriös, verspielt, technisch, warm, kühl, ernst, freundlich, dramatisch |
| `theme` | nein | light, dark, both |
| `density` | nein | airy, balanced, dense |
| `typography` | ja | serif, sans, mono, display, script, mixed, oversized, condensed |
| `layout` | ja | centered, split, asymmetric, grid, full-bleed, sidebar, stacked, overlapping |
| `motion` | ja | none, fade, slide, parallax, scroll-reveal, hover-transform, 3d, morphing, marquee, sticky-scroll, cursor-follow, video-bg |
| `industry` | ja | saas, fashion, finance, food, health, education, agency, ecommerce, media, gaming, nonprofit, real-estate |
| `project` | ja | *(frei, vom Admin pro Kunde/Projekt gepflegt)* |

Erweiterungen innerhalb einer Facette sind jederzeit billig. Eine **neue Facette** kostet
Prompt-Platz und damit Genauigkeit bei den übrigen — und für Bestandsassets eine Reanalyse.

## 7. Klassifizierungs-Pipeline

### 7.1 Ablauf

```
Upload / Paste / URL / MCP
        │
        ▼
  asset (status=pending)      ◄── sofortige Antwort an den Client
        │
        ▼  BullMQ
  ┌──────────────────────────────┐
  │ 1. normalize                │  EXIF strippen, Format prüfen, Maße lesen
  │ 2. thumbnails               │  sharp → webp sm/md/lg
  │ 3. colors                   │  Palette extrahieren → Lab
  │ 4. capture      (nur URLs)  │  Screenshot, Scroll-Video, Keyframes, Technik  (§8)
  │ 5. classify                 │  LLM-Vision → Facetten + Beschreibung + Tags
  │ 6. index                    │  tsvector aktualisieren
  └──────────────────────────────┘
        │
        ▼
  asset (status=ready)
```

Die Schritte sind getrennte Jobs mit eigenem Retry. Scheitert `classify` (API down,
Rate-Limit), bleiben Thumbnails, Farben und Capture erhalten; das Asset ist nutzbar und wird
nachklassifiziert. Ein Fehler in einem teuren Spätschritt macht nie die billigen Frühschritte
zunichte.

### 7.2 Provider-Austauschbarkeit — das Schema ist der Vertrag

Anforderung: Claude als Default, andere APIs später möglich.

**Nicht gewählt:** ein generischer Multi-Provider-Wrapper (Vercel AI SDK o. ä.) als
Grundarchitektur. Der Preis wäre der kleinste gemeinsame Nenner — und verloren gingen genau die
Features, die hier den Unterschied machen: garantiert schema-valides JSON, Batch-Verarbeitung zum
halben Preis, Prompt-Caching.

**Gewählt:** Abstrahiert wird nicht die API, sondern das **Ergebnis**. Das Zod-Schema in
`libs/shared` ist der Vertrag; jeder Adapter benutzt das **native SDK seines Providers** und darf
dessen Stärken voll ausspielen.

```typescript
// libs/shared — der Vertrag. Einzige Quelle der Wahrheit für Facetten.
export const AnalysisResultSchema = z.object({
  description: z.string().describe('2–4 Sätze, sachlich, für die Volltextsuche'),
  facets: z.object({
    ui_pattern: z.array(UiPatternEnum),
    style:      z.array(StyleEnum),
    theme:      ThemeEnum,
    motion:     z.array(MotionEnum),
    // … aus dem Vokabular generiert
  }),
  free_tags:   z.array(z.string()).max(10),
  ocr_text:    z.string().nullable(),
  confidence:  z.number().min(0).max(1),
});

// libs/classify — das Port-Interface
export interface AssetClassifier {
  readonly providerId: string;
  readonly modelId: string;
  classify(input: ClassifyInput): Promise<ClassifyOutput>;
}
```

`ClassifyInput` trägt ein oder mehrere Bilder (Screenshot, Keyframes) plus optionalen
Textkontext (URL, Titel, extrahierte Capture-Technik). Die Provider-Wahl erfolgt per Chart-Value
(`llm.provider`) über ein NestJS-DI-Token.

Der Anthropic-Adapter nutzt `@anthropic-ai/sdk` mit `client.messages.parse()` und
`zodOutputFormat(AnalysisResultSchema)` — das Ergebnis ist damit schema-validiert, ohne eigenen
Parsing-Code. Adapter für Provider ohne echten Structured-Output-Modus validieren nach dem
Aufruf gegen dasselbe Zod-Schema und werfen bei Verstoß; der Vertrag gilt für alle gleich.

### 7.3 Modellwahl

**Default: `claude-opus-5`** mit `output_config: { effort: 'low' }`.

- Niedriges Effort-Level, weil Klassifizierung zu den Aufgaben gehört, bei denen höherer
  Denkaufwand die Qualität kaum verbessert — im Gegensatz zu Coding- oder Agenten-Aufgaben.
- Zusätzlich aktiviert: serverseitige **Refusal-Fallbacks**
  (`betas: ['server-side-fallback-2026-07-01']`, `fallbacks: 'default'`). Bei fremden
  Screenshots kann ein Safety-Classifier gelegentlich ablehnen; ohne Fallback bliebe das Asset
  unklassifiziert liegen. Mit Fallback läuft derselbe Request automatisch auf einem anderen
  Modell weiter.
- **Prompt-Caching** lohnt beim Einzel-Upload nicht (Cache-TTL 5 Minuten), wohl aber bei
  Batch-Reanalyse — dort wird es gesetzt.

### 7.4 Kosten

Annahme pro Bild-Asset: ~1.500 Input-Tokens Bild, ~2.000 Tokens System-Prompt mit Vokabular,
~1.000 Output-Tokens.

| | Input | Output | pro Asset |
|---|---|---|---|
| Opus 5 ($5 / $25 pro MTok) | 3.500 → $0,018 | 1.000 → $0,025 | **~$0,04** |
| Website-Capture, 8 Keyframes | ~14.000 → $0,070 | 1.000 → $0,025 | **~$0,10** |

Bei 500 Assets im Jahr: **etwa 20–30 USD jährlich.** Kostenoptimierung über die Modellwahl wäre
bei dieser Menge Mikromanagement an der falschen Stelle — die Metadatenqualität ist das Produkt,
und sie entsteht genau hier. Das stärkste Modell ist die richtige Wahl.

Das Monatslimit (`llm.monthlyCostLimitUsd`) ist als Schutz gegen Fehler in Schleifen gedacht,
nicht gegen den Normalbetrieb.

### 7.5 Reanalyse

Erweitert sich das Vokabular, lässt sich über die **Batch-API** (50 % Rabatt, bis 24 h Laufzeit)
alles mit `prompt_version < N` neu klassifizieren. Der eigentliche Vorteil ist hier nicht der
Preis, sondern dass Rate-Limits kein Thema sind. `origin = 'human'` bleibt nach §5.6 unangetastet.

### 7.6 Warum keine Embeddings in Phase 1

Embeddings leisten zwei Dinge: semantische Suche („alles, was warm und erdig wirkt", auch ohne
diese Worte im Text) und „ähnliche Assets". Beides ist hier **verzichtbar**:

- Ein **kontrolliertes Facetten-Vokabular ist bei dieser Datenmenge präziser.**
  `style=editorial AND theme=dark` trifft exakt; ein Embedding liefert eine
  Ähnlichkeitsrangfolge mit unscharfem Rand.
- Die **Volltextsuche über die LLM-Beschreibung** deckt den Rest ab. Schreibt das Modell
  „warme, erdige Töne", findet `tsvector` das. Embeddings helfen nur bei Umschreibungen, die
  nirgends wörtlich vorkommen.
- Der Nutzen semantischer Suche **skaliert mit der Menge**. Bei 50.000 Assets unverzichtbar, bei
  einigen hundert ist alles durchscrollbar.

Entscheidend: **Es gibt keinen Lock-in.** Embeddings werden aus der gespeicherten Beschreibung
berechnet, und die liegt ohnehin in der Datenbank. Sie sind jederzeit über den Bestand
nachrüstbar, ohne Verlust — anders als die Punkte in §2 „Was von Anfang an stehen muss".

Die Infrastruktur wäre auch kein Hindernis: Ein lokales Modell wie bge-m3 braucht auf einer
aktuellen Desktop-CPU rund 100–300 ms pro Text-Embedding bei ~2,5 GB RAM; selbst
Bild-Embeddings per CLIP (~0,5–1 s pro Bild auf CPU) wären bei dieser Menge belanglos. Die
Entscheidung ist also rein inhaltlich, nicht technisch bedingt.

## 8. Website-Capture

### 8.1 Warum ein Job und kein Agent

Es ist dieselbe Bibliothek, die ein Agent über ein Playwright-Werkzeug benutzt — aber ein
grundlegend anderer Nutzungsmodus:

> Ein **Agent ist im Loop**: Seite laden, Ergebnis ansehen, „der Cookie-Banner verdeckt alles"
> erkennen, wegklicken, neu bewerten. Jeder Schritt ist eine Entscheidung auf Basis des
> vorherigen.
>
> Der **Capture-Job hat diesen Luxus nicht.** Er läuft unbeaufsichtigt in einer Queue, muss bei
> derselben URL dasselbe Ergebnis liefern und bei Fehlschlag automatisch sinnvoll wiederholen.
> Das ist ein Programm, kein Werkzeuggebrauch.

Deshalb ist der deterministische Job der Grundpfad. Der Agenten-Ansatz hat trotzdem einen Platz
— siehe §8.4.

### 8.2 Ablauf

```
 1. chromium.launch(headless), Context mit festem Viewport 1440×900,
    deviceScaleFactor 2, recordVideo aktiv
 2. page.goto(url), warten bis Netzwerk ruhig
 3. Cookie-Banner wegklicken          ← Hauptproblem, §8.3
 4. Langsam komplett durchscrollen    ← triggert Lazy-Loading aller Bilder
 5. Zurück nach oben, kurz warten
 6. Vollseiten-Screenshot + Viewport-Screenshot (Poster)
 7. Scroll-Video: skriptgesteuertes gleichmäßiges Scrollen über 8–12 s
 8. page.evaluate(): Technik-Extraktion im Seitenkontext
 9. context.close()  → erst jetzt schreibt Playwright die Videodatei
10. ffmpeg: 8 Keyframes extrahieren, nach MP4 transkodieren
11. Keyframes + Screenshot + Technik-Kontext → LLM-Analyse
```

**WebM/MP4 statt GIF** — ein GIF derselben Länge ist bei schlechterer Qualität ein Vielfaches
groß.

Zwei Schritte machen den Wert dieses Teils aus:

- **Schritt 11: Keyframes statt Einzelbild an die Analyse.** Aus einer Bildserie kann das Modell
  die Bewegung beschreiben und die `motion`-Facette füllen. Ein einzelner Screenshot kann das
  prinzipiell nicht — Animation ist genau das, was auf einem Standbild fehlt.
- **Schritt 8: Technik-Extraktion.** Im Seitenkontext läuft JavaScript, das Dinge sammelt, die
  auf keinem Screenshot sichtbar sind: tatsächlich verwendete `font-family`-Werte, alle
  `transition`- und `animation`-Properties sichtbarer Elemente, Transform-Typen, und Signaturen
  bekannter Bibliotheken (`window.gsap`, `window.ScrollTrigger`, `data-aos`-Attribute, Lenis,
  Framer Motion). Das ist der Unterschied zwischen „sieht weich aus" und
  `scroll-reveal via GSAP ScrollTrigger, 0.6s cubic-bezier(0.16,1,0.3,1)`.

Ergebnis landet in `capture_tech` (§5.3) und geht als Textkontext in die Klassifizierung ein.

### 8.3 Bekannte Grenzen

Diese Punkte sind keine Bugs, sondern Eigenschaften des Verfahrens:

- **Cookie-Banner** sind der häufigste Grund für ein nutzloses Capture — sie verdecken genau den
  Hero. Es gibt keine perfekte Lösung: Heuristiken über bekannte Selektoren und Accept-Buttons,
  optional Consent-o-Matic-Regelsätze. Mit einer Restquote manueller Nacharbeit ist zu rechnen.
- **Zielkonflikt bei Scroll-Animationen:** Für den Screenshot sollen sie *abgeschlossen* sein
  (sonst fotografiert man halb eingeblendete Elemente), für das Video müssen sie *frisch
  getriggert* werden. Daher die Reihenfolge in §8.2: erst durchscrollen und Screenshot, dann
  Seite zurücksetzen und filmen.
- **Sticky Header** erscheinen in Vollseiten-Screenshots je nach Implementierung mehrfach oder
  verdecken Abschnitte.
- **Bot-Erkennung** (Cloudflare, DataDome) blockt headless Chromium teilweise vollständig.
  Stealth-Plugins helfen, aber nicht überall — manche Seiten werden sich nicht erfassen lassen.
  Fehlerfall sauber melden statt stillschweigend ein leeres Bild speichern.
- **Dauer:** 20–60 s pro Capture. Gehört zwingend in die Queue, niemals an den HTTP-Request.

Da Websites sich ändern, werden alle Captures **dauerhaft lokal archiviert**; die Referenz bleibt
gültig, auch wenn die Seite umgebaut wird.

### 8.4 Ausbaustufe: Tiefenanalyse per Agent (Phase 4)

Der deterministische Job kann nur scrollen. Ein Agent mit Browser-Zugriff könnte hovern, Menüs
öffnen und Interaktionen auslösen — und damit Animationen sehen, die beim reinen Scrollen
unsichtbar bleiben. Das ist mächtiger, aber langsam, teuer und nicht reproduzierbar.

Sinnvolle Aufteilung: deterministischer Job als Standard für jedes Capture, dazu später ein
optionaler Knopf „Tiefenanalyse" für einzelne Seiten, die es wert sind.

Bereichsmarkierung („nur der Hero") ebenfalls Phase 4: CSS-Selektor oder Bildausschnitt.

## 9. Rechte & Sichtbarkeit

Rollen: `admin`, `member`.

| Aktion | Regel |
|---|---|
| Sehen | alle sehen alles |
| Anlegen | jeder |
| Metadaten/Tags ändern, auch fremde | **jeder** |
| Löschen | nur eigene; Admin alles. Soft-Delete, 30 Tage Papierkorb |
| Kontrolliertes Vokabular erweitern | nur Admin |
| Freie Tags anlegen | jeder |
| Nutzer verwalten | Admin (in Authentik) |

**Begründung der beiden unsymmetrischen Zeilen:** Gemeinsames Taggen ist bewusst offen, weil
Reibung bei der Taxonomiepflege der häufigste Grund ist, warum solche Systeme verwahrlosen — das
Audit-Log stellt Nachvollziehbarkeit her, ohne zu bremsen. Löschen ist dagegen destruktiv und
bekommt die engere Grenze; der Papierkorb hält das Restrisiko klein.

Zugang: Invite-only über Authentik. Keine Selbstregistrierung, da die App im Internet steht.

## 10. MCP-Interface

Der Zugang für Claude Code und Claude Design. Remote-MCP-Server über Streamable HTTP, als Route
in `apps/api`, authentifiziert über ein persönliches API-Token pro Nutzer.

| Tool | Phase | Zweck |
|---|---|---|
| `search_assets` | 1 | Facetten-Filter + Volltextsuche. Liefert Metadaten und Bild-URLs |
| `get_asset` | 1 | Ein Asset mit allen Metadaten, Farben, Dateien, Capture-Technik |
| `list_vocabulary` | 1 | Das kontrollierte Vokabular — **damit gültige Filterwerte bekannt sind, statt geraten zu werden** |
| `add_asset` | 1 | Asset anlegen, auch per URL — Einwerfen direkt aus einer Session |
| `get_board` | 3 | **Das Briefing-Paket** (§10.1) |
| `get_design_tokens` | 3 | Palette/Typografie als Design Tokens |

**Bilder und Captures sind als Vision-Input abrufbar**, nicht nur als Beschreibung — bei
Design-Referenzen ist das Ansehen der Referenz der halbe Wert.

`list_vocabulary` ist kein Komfort-Tool: Ohne es würde ein Agent Filterwerte erfinden und leere
Ergebnismengen erhalten, ohne zu verstehen, warum.

### 10.1 `get_board` — die Kernschnittstelle (Phase 3)

Laut Anforderung ist das Board das Paket, das der KI zur Bearbeitung übergeben wird. `get_board`
liefert deshalb kein Suchergebnis, sondern ein **fertiges Briefing**:

```
{
  title, briefing,                      // was daraus entstehen soll
  items: [{
    role,        // color | layout | typography | motion | imagery | copy | overall
    weight,      // primary | secondary | avoid
    note,        // "nur die Animation, nicht die Farben"
    asset: { facets, colors, description, image_url, capture_url, capture_tech }
  }],
  derived: {
    palette,          // konsolidiert aus den Items mit role=color
    type_pairings,    // aus role=typography
    motion_summary,   // aus role=motion, inkl. erkannter Bibliotheken
    common_facets,    // was alle primary-Items teilen → die eigentliche Richtung
    conflicts         // widersprüchliche Signale, explizit benannt
  },
  tokens: { json, w3c_design_tokens, css_custom_properties, tailwind_fragment }
}
```

Drei Entwurfsentscheidungen darin:

- **`derived` wird serverseitig berechnet, nicht vom Modell abgeleitet.** Eine konsolidierte
  Palette aus fünf Bildern ist Rechenarbeit, kein Interpretationsspielraum — serverseitig ist
  sie deterministisch und für jeden Konsumenten identisch.
- **`conflicts` benennt Widersprüche statt sie zu glätten.** Enthält ein Board ein `airy`- und
  ein `dense`-Primary, ist das eine Information für den Bearbeiter, kein Mittelwert, der gebildet
  werden sollte.
- **Vier Token-Formate**, damit direkt loscodiert werden kann, statt eine Prosa-Beschreibung zu
  interpretieren.

## 11. Phasen

### Phase 1 — Übersicht, Klassifizierung & Website-Capture

Ziel: Ein Bild oder eine URL landet in der App, wird automatisch erfasst und klassifiziert und
ist über Facetten wiederfindbar. Am Ende dieser Phase ist die App täglich nutzbar und für
Claude Code lesbar.

**Fundament**
- [ ] Nx-Monorepo, Dockerfiles, GitHub Actions → GHCR (§4.8)
- [ ] Helm-Chart mit `IngressRoute`/`Ingress`-Umschalter, cloudflared
- [ ] Anbindung an externes Postgres und Authentik per Values (§4.3)
- [ ] Valkey mit `deploy`-Flag
- [ ] HostPath-Volume + nodeAffinity + UID 1000 (§4.2)
- [ ] OIDC-Login (BFF-Pattern, HttpOnly-Cookie) + Notfall-Admin
- [ ] `StorageService`-Interface (HostPath-Adapter)

**Daten**
- [ ] Datenmodell §5.1–5.3, §5.5 — inkl. `origin` und `analysis_run` von Anfang an
- [ ] Migrations-Job als `argocd.argoproj.io/hook: PreSync` (§4.11)
- [ ] Facetten-Vokabular als Seed + Admin-Pflege

**Einpflegen & Klassifizieren**
- [ ] Upload: Drag&Drop, Clipboard-Paste, Multi-Upload
- [ ] Job-Pipeline: normalize → thumbnails → colors → capture → classify → index
- [ ] Anthropic-Adapter + Provider-Interface

**Website-Capture**
- [ ] Playwright im Worker-Image, `/dev/shm`-Mount, Resource Limits (§4.6)
- [ ] URL einwerfen → Screenshot, Scroll-Video, Keyframes, Technik-Extraktion (§8.2)
- [ ] Cookie-Banner-Heuristik, Fehlerfälle sauber melden (§8.3)
- [ ] Multi-Image-Analyse: Keyframes an die Klassifizierung → `motion` wird echt gefüllt
- [ ] Video-Player in der Detailansicht

**Übersicht**
- [ ] Masonry-Grid, Facetten-Filter, Volltextsuche, Autoren-Filter
- [ ] Detailansicht: Metadaten editierbar, Farben, Capture-Technik
- [ ] Mehrfachauswahl + Bulk-Tagging

**Zugriff & Betrieb**
- [ ] MCP-Server: `search_assets`, `get_asset`, `list_vocabulary`, `add_asset`
- [ ] Restore des Datenbank-Backups einmal durchgespielt (§4.3)

### Phase 2 — Schärfung

- [ ] Komponenten mit echtem Code + Live-Preview
- [ ] Fonts mit Datei-Upload und Live-Rendering
- [ ] Command Palette (Cmd+K)
- [ ] Batch-Reanalyse-UI

### Phase 3 — Boards

- [ ] Board-Tabellen (§5.4) als Migration
- [ ] Board-UI: anlegen, Assets kombinieren, Rollen und Gewichte zuweisen, sortieren, Notizen
- [ ] `briefing`-Feld, Smart Boards
- [ ] `get_board` inkl. `derived` und Token-Export, `get_design_tokens`

### Phase 4 — Ausbau

- [ ] Tiefenanalyse per Agent (§8.4)
- [ ] Bereichsmarkierung bei Website-Captures
- [ ] Semantische Suche + „ähnliche Assets" (§7.6) — **nur wenn die Suche sich als zu eng erweist**
- [ ] Kommentare, Favoriten, Aktivitätsfeed

### Später / offen

- [ ] Öffentliche Read-Only-Board-Links für Kunden
- [ ] Browser-Extension zum Clippen
- [ ] Watch-Folder-Import
- [ ] Weitere LLM-Adapter
- [ ] Mehrere Workspaces

## 12. Offene Punkte

1. **Migrations-Strategie ausarbeiten** (§4.11) — Reihenfolge, Idempotenz, Verhalten bei
   fehlgeschlagener Migration, Rollback.
2. **Authentik-Application** — Application plus OIDC-Provider `moodboard` mit Redirect-URIs
   müssen in der jeweiligen Instanz angelegt werden.
3. **Lokale Entwicklungsumgebung** — Docker Compose für Postgres und Valkey oder SSH-Tunnel auf
   bestehende Instanzen (§4.9).

> Umgebungsspezifische Werte (Domain, Issuer-URL, HostPath, UID, Registry-Owner) sind bewusst
> **nicht** Teil dieses Dokuments. Sie werden über die ArgoCD Application gesetzt; für die
> lokale Arbeit stehen sie in `infra.local.md`, die nicht versioniert wird.
