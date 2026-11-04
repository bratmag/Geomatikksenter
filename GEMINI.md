# JobXML zigzag

I **Feltdata**: oppdater listen, huk av jobben, velg FXL dersom prosjektet har flere og trykk **JobXML zigzag**. Filen lagres som `jobb - Gemini.jxl` på PC-en. Ingen konverterte filer lastes opp til Connect i denne flyten.

Eksisterende autentisering, `listJxlSources`, `getFieldDataJxl` og `downloadKofFile` gjenbrukes. Field Data-kilden er `rootDataFileJxl` fra Survey Job. Binære JOB-filer konverteres ikke lokalt. Jobber uten tilgjengelig JXL beholdes i listen; et nedlastingsforsøk viser den eksisterende meldingen om at JXL ikke er klar. Alle jobbene i det eksisterende API-svaret undersøkes, i stedet for bare de første 40. Det eksisterende listekallet har fortsatt en grense på 1500 jobber.

Prosjektmappene gjennomsøkes med `listProjectExplorer`. Én FXL velges automatisk. Flere krever et eksplisitt valg; ingen gir beskjed om opplasting. Feil ved listing av en mappe avviser automatisk FXL-valg, slik at et ufullstendig søk ikke regnes som én entydig kandidat. FXL lastes ned på nytt ved konvertering. Forslag basert på jobbens kodelistehenvisning er ikke implementert.

`gemini-jxl.js` implementerer reglene fra den verifiserte `JobXML zigzag.xsl`. XML behandles som et dokument slik at rådata og eksisterende linjer bevares. Konverterte punktkoder arkiveres i kommentarer, mens kode og attributter flyttes til linjen. Hele konverteringen må lykkes før nedlasting. Start/End/Close støttes; øvrige kontrollkoder og attributtkonflikter avvises med punkt og streng i feilmeldingen.

## Verifikasjon

Sett `NODE_PATH` til den installerte pakken som inneholder Playwright, og kjør `tests/Test-Gemini.ps1` fra prosjektet. Chrome brukes uten synlig vindu. Testene trenger originalfilene på de lokale stiene i overleveringsnotatet. Prøvedata kopieres ikke inn i Git; XSLT-fasiter genereres i `.local-gemini-test`.

Testene sammenligner hele XML-treet mot den fungerende XSL-en for både originaljobben og live-diagnosefilen. De kontrollerer også en annen FXL, flettede strenger, Start/End/Close, feiltilfeller og sperre mot gjentatt konvertering. Nettlesertesten bruker simulerte Workspace/Connect-svar og verifiserer nedlasting samt ett/flere/ingen FXL.

Publisering og ende-til-ende-test med innlogget Connect og import i Gemini gjenstår.
