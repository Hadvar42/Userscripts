# Userscripts

> **Hinweis:** Die Skripte und übrigen Inhalte dieses Repositorys wurden mit KI-Unterstützung (Claude von Anthropic) erstellt.

Tampermonkey-Skripte mit zusätzlichen Filtern für Freelancer-Projektbörsen.

| Skript | Seite | Installieren |
|---|---|---|
| freelance.de – Erweiterte Projektfilter | [freelance.de](https://www.freelance.de/projekte) | [freelance-de-filter.user.js](https://raw.githubusercontent.com/Hadvar42/Userscripts/main/freelance-de-filter.user.js) |
| freelancermap.de – Erweiterte Projektfilter | [freelancermap.de](https://www.freelancermap.de/projekte) | [freelancermap-filter.user.js](https://raw.githubusercontent.com/Hadvar42/Userscripts/main/freelancermap-filter.user.js) |

Mit installiertem [Tampermonkey](https://www.tampermonkey.net/) öffnet ein Klick auf den Link den Installationsdialog. Updates holt sich Tampermonkey danach selbst über `@updateURL`.

## Funktionen

Auf den Projektseiten erscheint unten rechts ein Button **Filter** mit dem Einstellungsfenster. Jeder Filter lässt sich einzeln auf **Ausblenden** oder **Ausgrauen** stellen.

- Stichwörter im Titel, in der Firma oder im Ort ausschließen (Text oder `/regulärer Ausdruck/i`)
- Alter der Anzeige in Tagen, mit Markierung der Altersgrenze in der Liste
- Projektstart in mehr als N Tagen
- Arbeitnehmerüberlassung (und auf freelancermap: Festanstellung)
- Remote: auf freelance.de nur Remote, auf freelancermap Mindest-Remote-Anteil in Prozent
- Skills (nur freelance.de, freelancermap zeigt in der Liste keine Skills)
- Wunsch-Stichwörter im Titel hervorheben

## Entwicklung

Bei jeder Änderung `@version` erhöhen, sonst erkennt Tampermonkey kein Update.
