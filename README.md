# Userscripts

> **Hinweis:** Die Skripte und übrigen Inhalte dieses Repositorys wurden mit KI-Unterstützung (Claude von Anthropic) erstellt.

Tampermonkey-Skript mit zusätzlichen Filtern für die Freelancer-Projektbörsen [freelance.de](https://www.freelance.de/projekte) und [freelancermap.de](https://www.freelancermap.de/projekte).

**Installieren:** [projektfilter.user.js](https://raw.githubusercontent.com/Hadvar42/Userscripts/main/projektfilter.user.js)

Mit installiertem [Tampermonkey](https://www.tampermonkey.net/) öffnet ein Klick auf den Link den Installationsdialog. Updates holt sich Tampermonkey danach selbst über `@updateURL`.

## Funktionen

Auf den Projektseiten erscheint unten rechts ein Button **Filter** mit dem Einstellungsfenster. Jeder Filter lässt sich einzeln auf **Ausblenden** oder **Ausgrauen** stellen.

**Gemeinsam für beide Seiten** (einmal eingeben, gilt überall):

- Stichwörter im Titel, in der Firma oder im Ort ausschließen (Text oder `/regulärer Ausdruck/i`)
- Projektstart ab einem Datum ausschließen
- Arbeitnehmerüberlassung ausschließen
- Projekte ohne Remote-Möglichkeit ausschließen
- Wunsch-Stichwörter im Titel hervorheben

**Je Seite getrennt:**

| | freelance.de | freelancermap.de |
|---|---|---|
| Alter der Anzeige in Tagen, mit Markierung der Altersgrenze in der Liste | ✓ | ✓ |
| Skills ausschließen | ✓ | – (Liste zeigt keine Skills) |
| Mindest-Remote-Anteil in Prozent | – (Seite zeigt nur Remote ja/nein) | ✓ |
| Festanstellung ausschließen | – | ✓ |

## Entwicklung

Bei jeder Änderung `@version` erhöhen, sonst erkennt Tampermonkey kein Update.

Die früheren Einzelskripte `freelance-de-filter.user.js` und `freelancermap-filter.user.js` sind in `projektfilter.user.js` aufgegangen.
