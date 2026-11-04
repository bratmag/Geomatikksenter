# JobXML zigzag

I **Feltdata**: oppdater listen, huk av jobben, velg FXL dersom prosjektet har flere og trykk **JobXML zigzag**. Filen lagres som `jobb - Gemini.jxl` på PC-en. Ingen konverterte filer lastes opp til Connect i denne flyten.

Eksisterende autentisering, `listJxlSources`, `getFieldDataJxl` og `downloadKofFile` gjenbrukes. Field Data-kilden er `rootDataFileJxl` fra Survey Job. Binære JOB-filer konverteres ikke lokalt. Jobber uten tilgjengelig JXL beholdes i listen; et nedlastingsforsøk viser den eksisterende meldingen om at JXL ikke er klar. Alle jobbene i det eksisterende API-svaret undersøkes, i stedet for bare de første 40. Det eksisterende listekallet har fortsatt en grense på 1500 jobber.

Prosjektmappene gjennomsøkes med `listProjectExplorer`. Én FXL velges automatisk. Flere krever et eksplisitt valg; ingen gir beskjed om opplasting. Feil ved listing av en mappe avviser automatisk FXL-valg, slik at et ufullstendig søk ikke regnes som én entydig kandidat. FXL lastes ned på nytt ved konvertering. Forslag basert på jobbens kodelistehenvisning er ikke implementert.

`gemini-jxl.js` implementerer reglene fra den verifiserte `JobXML zigzag.xsl`. XML behandles som et dokument slik at rådata og eksisterende linjer bevares. Konverterte punktkoder arkiveres i kommentarer, mens kode og attributter flyttes til linjen. Hele konverteringen må lykkes før nedlasting. Start/End/Close støttes; øvrige kontrollkoder og attributtkonflikter avvises med punkt og streng i feilmeldingen.

## Verifikasjon

Sett `NODE_PATH` til den installerte pakken som inneholder Playwright, og kjør `tests/Test-Gemini.ps1` fra prosjektet. Chrome brukes uten synlig vindu. Testene trenger originalfilene på de lokale stiene i overleveringsnotatet. Prøvedata kopieres ikke inn i Git; XSLT-fasiter genereres i `.local-gemini-test`.

Testene sammenligner hele XML-treet mot den fungerende XSL-en for både originaljobben og live-diagnosefilen. De kontrollerer også en annen FXL, flettede strenger, Start/End/Close, feiltilfeller og sperre mot gjentatt konvertering. Nettlesertesten bruker simulerte Workspace/Connect-svar og verifiserer nedlasting samt ett/flere/ingen FXL.

## Innebygde geoidemodeller

`jobxml-coordinates.js` fullfører koordinater før zigzag-konverteringen hvis Field Data har levert ufullstendige Reductions. Modell velges fra jobbens `GeoidName`; kunden skal ikke velge eller laste opp GGF. Begge modellene ligger i `geoids/`, lastes ved behov og kontrolleres med SHA-256 før bruk:

| Modell | Navnevarianter | SHA-256 |
| --- | --- | --- |
| Norway18B | Norway18B, NN2000_18B, NN2000 (Norway18B), med valgfri .ggf | cdc3e37e4887a4f2d034ed91b360e8f17d75e2b3515ee426ce32f769f16c0417 |
| Norway25A | Norway25A, NN2000_25A, NN2000 (Norway25A), med valgfri .ggf | 3d83548ee6556f858d93e4e7f9c8408fcc381ed38379bec861221f6730a5ae49 |

GGF-leseren er begrenset til disse to kontrollerte filvariantene: little-endian float32, 711 × 701 verdier, rader fra nord mot sør, bilineær interpolasjon. Manglende gridverdier (9999), ukjent modell og punkter utenfor dekningen avvises. Modellen brukes som tabell, uten et fast høydeavvik.

Komplette Reductions bevares. Når ComputedGrid allerede finnes for alle aktive punkter, kan manglende Reductions bygges fra disse uten nye geodetiske beregninger. Ellers er rekonstruksjonen begrenset til entydige, ukalibrerte EUREF89-jobber med Transverse Mercator, null treparametertransformasjon og rå, vertikale GpsRTK/GpsRTKQuickMark-punkter. Jobbens ellipsoide- og projeksjonsparametere leses fra XML; ReducedHeight fra punktets AntennaRecord trekkes fra før geoidkorreksjonen. Ukjente målemetoder, tilt, lokal kalibrering og andre datumtransformasjoner avvises. Dette er ingen generell Trimble-reduksjonsmotor.

Matematisk grunnlag: [PROJs Transverse Mercator-definisjon](https://proj.org/en/stable/operations/projections/tmerc.html). GGF-strukturen er undersøkt direkte i brukerens filer og kontrollert mot TA. Formatbakgrunn: [HYPACK/Xylem](https://www.xylem.com/siteassets/brand/hypack/resources/newsletter/2010/07-july/new-geoid-model-for-france-and-information-about-geoid-file-formats.pdf). Flaggenes generelle betydning er ikke antatt; bare de to leverte variantene godtas.

Kjør `node tests/jobxml-coordinates.test.cjs` med samme NODE_PATH som øvrige tester. Testen trenger de to Asfalt 5-filene på brukerens oppgitte lokale stier. På alle 12 punkter mot Asfalt 5_TA er største avvik i nord 0,000093 m, øst 0,000002 m og høyde under 0,000001 m. Hele fetch/koordinat/zigzag-kjeden, modellvalg og avvisning av ustøttede tilfeller testes. En kontrollfil skrives i `.local-gemini-test/asfalt 5 - geoid-kontrollert.jxl`.

Norway25A bruker den leverte gridfilen og samme kontrollerte leser; en egen TA-eksport med Norway25A er foreløpig ikke tilgjengelig for uavhengig ende-til-ende-sammenligning. Ny Gemini-import av den reparerte filen må også bekreftes.
