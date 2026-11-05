# Mám EET? – průvodce EET 2.0 pro podnikatele

Statický web v češtině. Podnikateli po nejvýše 8 otázkách řekne:

1. zda musí od 1. 1. 2027 evidovat tržby v EET 2.0,
2. zda může zvolit režim EET OFF a kolik ho to bude stát,
3. co udělat a do kdy (kontrolní seznam s termíny, lze vytisknout).

Jde o informativní průvodce, nikoli o daňové poradenství. Pravidla jsem naposledy ověřil **5. 11. 2026**
proti eet.gov.cz, zákonu č. 180/2026 Sb. a brožuře MF.

Odpovědi zůstávají jen v paměti otevřené stránky. Nic se neukládá (žádné cookies ani `localStorage`)
a nic se neodesílá. Stránka nemá analytiku a hlavička Content-Security-Policy povoluje jen soubory
z vlastního webu.

## Struktura

| Soubor | Co obsahuje |
|---|---|
| `rules.json` | **Všechna** pravidla, částky, limity, termíny a texty. U každé položky je zdroj (URL) a datum ověření (`verified`). |
| `rules.js` | Rozhodovací logika. Čisté funkce bez DOM: `evaluate`, `visibleQuestions`, `compareCosts`, `buildChecklist`. |
| `app.js` | Uživatelské rozhraní: dotazník, výsledek, kalkulačka, kontrolní seznam, patička. |
| `index.html`, `styles.css` | Stránka a vzhled (mobil od 360 px, tmavý režim, tisková verze). |
| `test/rules.test.js` | Testy pro `node --test`. |
| `tools/e2e-scenare.mjs` | Volitelný průchod 7 scénáři v prohlížeči (Playwright). |

## Spuštění

Web potřebuje běžet přes webový server, protože prohlížeč nenačte `rules.json` ani ES moduly
ze `file://`. V adresáři projektu spusťte:

```bash
python3 -m http.server 8000
```

Pak otevřete http://localhost:8000/. Funguje i jakýkoli jiný statický server, např. `npx serve`.

## Testy

Testy potřebují Node.js 20 nebo novější a žádné závislosti.

```bash
node --test
```

Testy pokrývají 7 povinných scénářů a další pravidla: výjimky podle oborů, výjimku pro nevidomé
podnikatele, dobírku, převod u pultu, hranici 1 000 000 Kč, MOJE eet, kalkulačku a kontrolní seznam.
Kontrolují také, že:
- každý výsledek má aspoň jeden odkaz na oficiální zdroj,
- každá položka v `rules.json` se zdrojem má oficiální URL a datum ověření,
- v `rules.js` a `app.js` nejsou natvrdo zapsané částky, limity ani data.

Průchod scénáři v prohlížeči (volitelný, potřebuje balíček `playwright` a Chromium):

```bash
BASE_URL=http://127.0.0.1:8000/ node tools/e2e-scenare.mjs /tmp
```

## Jak upravit `rules.json`, když finanční správa změní výklad

1. **Najděte položku.** Každé pravidlo je v `rules.json` jen jednou:
   - `paymentMethods`: způsoby placení. `recorded: true` znamená, že se platba eviduje.
   - `sectors`: obory vyjmuté ze zákona. `exempt: true` znamená výjimku.
   - `eetOff`: limit příjmů (`incomeLimit`), rok příjmů (`incomeYear`), přirážka (`surchargeMonthly`),
     daňová složka (`taxComponentBaseMonthly`, `taxComponentWithOffMonthly`) a termín přihlášení
     (`registrationDeadline`).
   - `mojeEet`: datum spuštění, maximální počet evidenčních jednotek, cena.
   - `blindExemption`: výjimka pro nevidomé podnikatele (§ 11 odst. 4 zákona).
   - `checklist`: kroky kontrolního seznamu s termíny (`deadline`, `deadlineKind: "hard"` pro zákonný
     termín, `"recommended"` pro doporučení).
   - `results`, `questions`, `ui`: texty na obrazovkách.
2. **Změňte hodnotu nebo text.** Čísla zapisujte jako čísla (`1400`), data ve tvaru `RRRR-MM-DD`.
   V textech lze použít zástupné symboly v závorkách, např. `{limit}`, `{surchargeAnnual}`, `{deadline}`,
   `{launch}`. Doplní se z čísel výše, takže částku stačí změnit na jednom místě.
3. **Aktualizujte zdroj.** U změněné položky upravte `source` (URL oficiální stránky, ideálně s kotvou
   na konkrétní odstavec), `sourceTitle` a `verified` (datum, kdy jste zdroj četli). Zdroje se přijímají
   jen z domén `eet.gov.cz`, `mf.gov.cz` a `financnisprava.gov.cz`, jinak test selže.
4. **Aktualizujte datum kontroly** v `meta.lastVerified`. Zobrazuje se v patičce.
5. **Nové pravidlo:** přidejte položku do příslušného seznamu se stejnými klíči jako ostatní. Nový obor
   nebo způsob placení se v dotazníku objeví sám. Pokud jde o novou podmínku (nová otázka nebo nové
   větvení), je potřeba upravit i `rules.js` a dopsat test.
6. **Spusťte `node --test`** a upravte očekávané hodnoty v testech, pokud se změnila částka v povinném
   scénáři (např. přirážka 16 800 Kč ročně).

Pravidla, která oficiální zdroje k 5. 11. 2026 nepotvrdily, v `rules.json` záměrně nejsou:
- výjimka pro hotovostní tržby do 300 000 Kč (test hlídá, že se tam neobjeví),
- limit 2 zaměstnanců pro aplikaci MOJE eet,
- obecná výjimka pro držitele průkazu ZTP/P. Zákon ji dává jen při průkazu kvůli nevidomosti,
  těžké ztrátě zraku nebo hluchoslepotě.

## Nasazení na GitHub Pages

1. Nahrajte obsah této složky do kořene repozitáře na GitHubu (větev `main`).
2. V repozitáři otevřete **Settings → Pages**.
3. V části **Build and deployment** zvolte **Source: Deploy from a branch**, větev `main` a složku `/ (root)`. Uložte.
4. Za minutu až dvě bude web na adrese `https://<uživatel>.github.io/<repozitář>/`.

Build není potřeba. Soubor `.nojekyll` vypíná zpracování Jekyllem. Všechny cesty jsou relativní,
takže web funguje i v podadresáři.

## Oficiální zdroje

- EET 2.0: https://eet.gov.cz/
- Kdo musí evidovat tržby: https://eet.gov.cz/cs/koho-se-eet-tyka/kdo-musi-evidovat-trzby
- Co je z evidence vyjmuto: https://eet.gov.cz/cs/koho-se-eet-tyka/co-je-z-evidence-trzeb-vyjmuto
- Režim EET OFF: https://eet.gov.cz/cs/eet-off/co-je-rezim-eet-off
- Harmonogram: https://eet.gov.cz/cs/o-eet/jaky-je-harmonogram-eet-2-0
- Zákon č. 180/2026 Sb. (úplné znění): https://eet.gov.cz/assets/cs/cmsmedia/pro-vyvojare/Uplne_zneni_Zakon_o_EET.pdf
- Brožura MF: https://mf.gov.cz/assets/attachments/2026-09-09_Brozura-EET-2-0-jednoduse-moderne-a-prehledne.pdf
- Infolinka finanční správy: 953 109 109 (Po–Čt 9–17, Pá 9–14)
