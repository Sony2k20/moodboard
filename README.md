# Mood Board App

Ein selbst gehostetes, team-weites **Design-Gedächtnis**. Bilder, Screenshots, Farbpaletten,
Schriftarten und Website-Referenzen werden eingepflegt, automatisch per LLM klassifiziert und
über ein kontrolliertes Facetten-Vokabular wiederfindbar gemacht.

Der wichtigste Konsument ist nicht der Mensch, sondern **Claude Code**: Ein MCP-Server liefert
strukturierte Design-Referenzen direkt in die Entwicklung — statt „sieht gut aus" eine Antwort
wie `{pattern: hero, layout: split-left-text, motion: parallax-on-scroll, palette: [...]}`.

## Status

**Konzeptphase.** Noch kein Anwendungscode. Das abgestimmte Konzept liegt vollständig in
[`CONCEPT.md`](./CONCEPT.md) — Datenmodell, Facetten-Vokabular, Klassifizierungs-Pipeline,
Deployment-Architektur und Phasenschnitt.

## Leitidee

> Die Qualität der strukturierten Metadaten ist das Produkt. Das Frontend ist Zubehör.

Ein Bild mit dem Tag „schön" ist wertlos. Wertvoll wird es durch maschinenlesbare Facetten,
eine extrahierte Farbpalette und — bei Website-Referenzen — die tatsächlich verwendete
Animationstechnik. Jede Entwurfsentscheidung im Konzept fällt zugunsten der Metadatenqualität.

## Geplanter Stack

| Bereich | Wahl |
|---|---|
| Monorepo | Nx (Angular + NestJS) |
| Backend | NestJS, BullMQ, Drizzle |
| Frontend | Angular, Tailwind |
| Datenbank | PostgreSQL (CloudNativePG) |
| Queue | Valkey |
| Klassifizierung | Claude (`@anthropic-ai/sdk`), Provider austauschbar |
| Website-Capture | Playwright + ffmpeg |
| Auth | Authentik (OIDC) |
| Deployment | k3s, Helm, Traefik `IngressRoute`, Cloudflare Tunnel |

Begründungen zu jeder Wahl in [`CONCEPT.md`](./CONCEPT.md) §3.

## Phasen

1. **Übersicht, Klassifizierung & Website-Capture** — Asset oder URL einwerfen, automatisch
   klassifizieren, über Facetten wiederfinden, per MCP lesbar machen
2. **Schärfung** — Komponenten mit Code, Fonts, Command Palette, Batch-Reanalyse
3. **Boards** — kuratierte Asset-Kombinationen mit Rollen und Gewichtung als Briefing-Paket
   für die KI
4. **Ausbau** — Tiefenanalyse per Agent, Bereichsmarkierung, semantische Suche

## Entwicklung

Folgt mit dem Projektgerüst.
