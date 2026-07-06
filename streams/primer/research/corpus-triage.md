# Corpus triage: Primer feedstock

## Findings first
- The corpus already covers all spine stations: read/friction (`streams/primer/feedstock/gay-primer/pdf-annotation-app/src/components/MarginAnnotations.tsx`, `streams/primer/feedstock/gay-primer/pdf-js`), mark/enrich (`streams/primer/feedstock/Zotero/zotero.sqlite`, example state `streams/primer/feedstock/Zotero/storage/8B895UAE/.zotero-reader-state`, `streams/primer/feedstock/library/indexes/library_index.sqlite`), queue/review (`streams/primer/feedstock/library/papers/queues/read-next.md`, examples `streams/primer/feedstock/mochi/All Decks.apkg` and `streams/primer/feedstock/mochi/second-try.apkg`).
- Best Chinese vertical material is compact and actionable: HSK 1-2 PDFs, Olle Linge's `Hacking Chinese`, plus Chinese-history/context books and a few L2-reading/acquisition records in the library index.
- Deep philosophy has strong Nietzsche and Nick Land coverage; filename-level CCRU coverage was not found, so Land is the current CCRU-genealogy anchor.
- Useful quotes observed: `MarginAnnotations.tsx` line 31 says "Select text in the PDF to create annotations"; `read-next.md` lines 21-22 queues "The Eighty Five Percent Rule for optimal learning" at `Documents/papers/optimal-learning.pdf`.

## Directory map (top 2 levels, sizes from `du -L -hd`)
- `streams/primer/feedstock/Books_Papers_Research` — 3.3G
  - `nietzsche` — 165M; mixed Nietzsche/philosophy, math/pedagogy PDFs, media cruft.
  - `AnnaArchive` — 169M; finance/trading books, mostly not primer-spine except optional decision/forecasting.
  - `image-gen` — 108M; image/reference assets, mostly out of scope.
  - `Sylus_Exuberance` — 57M; asset subtree, out of scope.
  - `mujoco` — 56M; robotics/code, out of scope.
  - `claude-code-main 2` — 51M; code/vendor, out of scope for primer content.
  - `books` — 33M; misc book staging.
  - `claude-code-main` — 29M; duplicate code/vendor, out of scope.
  - `comfyui` — 23M; image workflow, out of scope.
  - `arXiv-2412.06264v1` — 18M; paper source/assets, not a spine priority.
  - `articles` — 17M; saved articles, only descend by title/term.
  - `laws-of-trading` — 13M; single book extraction, not primer core.
  - Other first-level dirs/files under 10M include `TrackingAndVisualizingFaces`, `tmux-3.6a`, `book`, AIMO duplicates, and scattered PDFs.
- `streams/primer/feedstock/Zotero` — 1.2G
  - `storage` — 1.1G; PDFs/HTML plus hidden `.zotero-reader-state` files.
  - `translators` — 13M; Zotero ingestion scripts.
  - `styles` — 960K; citation styles.
  - `cache` — 48K; cache metadata.
- `streams/primer/feedstock/library` — 2.7G
  - `books` — 2.7G; central categorized library.
    - `Economics China Politics History` — 878M; China background/history.
    - `Philosophy Literature` — 590M; Nietzsche/literature/philosophy books.
    - `Finance Trading Investing` — 540M; mostly out of scope.
    - `Other` — 468M; Land, Addiction by Design, Future of Text, misc.
    - `Language Learning` — 116M; HSK and Mandarin learning.
    - `Math Physics Statistics` — 71M; mostly out of scope.
    - `Programming Computer Science` — 67M; mostly out of scope.
    - `AI ML Robotics` — 37M; mostly out of scope.
    - `Creative Media Games` — 30M; mostly out of scope.
    - `Health Medicine Fitness` — 10M; mostly out of scope.
  - `indexes` — 4.6M; `library_index.sqlite` with 3,594 rows.
  - `manifests` — 3.0M; CSV sync/discovery manifests.
  - `reports` — 384K; discovery/sync reports.
  - `tools` — 168K; index/sync scripts.
  - `papers` — 40K; paper queues and templates.
- `streams/primer/feedstock/gay-primer` — 875M
  - `pdf-annotation-app` — 522M; annotation prototype, extracted PDFs, node_modules/vendor.
  - `pdf-js` — 293M; Mozilla PDF.js fork/tests.
  - `.claude-trace` — 58M; old agent trace.
  - `.git` — 2.1M; repo metadata.
- `streams/primer/feedstock/mochi` — 791M
  - `second-try.apkg` — 279.6MB; Anki/Mochi deck package.
  - `old-version.apkg` — 279.6MB; older deck package.
  - `All Decks.apkg` — 231.7MB; aggregate deck package.

## Shortlist (≤25 spine/vertical items)
1. `streams/primer/feedstock/gay-primer/pdf-annotation-app/src/components/MarginAnnotations.tsx` — React margin annotation component; feeds read→friction→mark UX.
2. `streams/primer/feedstock/gay-primer/pdf-annotation-app/scripts/extract-pdf-semantic.ts` — semantic PDF extraction script; feeds read→enrich.
3. `streams/primer/feedstock/gay-primer/pdf-annotation-app/data/The Gay Science -- Nietzsche.pdf` — local test/content PDF already wired into annotation app; feeds philosophy reading + read/mark.
4. `streams/primer/feedstock/gay-primer/pdf-js/test/pdfs/annotation-highlight.pdf` — PDF.js fixture for highlight annotations; feeds mark fidelity.
5. `streams/primer/feedstock/gay-primer/pdf-js/test/pdfs/tracemonkey_with_editable_annotations.pdf` — editable annotation fixture; feeds mark/edit regression cases.
6. `streams/primer/feedstock/gay-primer/gwern-sidenote.md` — long-form sidenote taxonomy; feeds friction/mark layout design.
7. `streams/primer/feedstock/Zotero/zotero.sqlite` — Zotero metadata DB; feeds enrich, queue, and provenance.
8. `streams/primer/feedstock/Zotero/storage/8B895UAE/.zotero-reader-state` — observed hidden reader state beside Zarathustra files; feeds resume/review state modeling.
9. `streams/primer/feedstock/library/indexes/library_index.sqlite` — 3,594-row library index with title/category/path metadata; feeds enrich and queue.
10. `streams/primer/feedstock/library/papers/queues/read-next.md` — existing prioritized read queue; feeds queue→review.
11. `streams/primer/feedstock/library/papers/queues/classify-first.md` — triage queue for uncategorized papers; feeds enrich→queue.
12. `streams/primer/feedstock/mochi/All Decks.apkg` — aggregate Anki deck package; feeds review/SRS substrate.
13. `streams/primer/feedstock/mochi/second-try.apkg` — large deck package variant; feeds review import/compare.
14. `streams/primer/feedstock/library/books/Language Learning/Hacking Chinese A Practical Guide to Learning Mandarin - Olle Linge [Linge.epub` — Mandarin-learning strategy book; feeds Chinese vertical + friction/review.
15. `streams/primer/feedstock/library/books/Language Learning/HSK标准教程 1 - 姜丽萍主编.pdf` — HSK Standard Course 1 textbook; feeds Chinese read→mark→review.
16. `streams/primer/feedstock/library/books/Language Learning/HSK标准教程 2.pdf` — HSK Standard Course 2 textbook; feeds Chinese read→mark→review.
17. `streams/primer/feedstock/Books_Papers_Research/HSK标准教程  1.pdf` — duplicate/source copy of HSK 1; feeds source reconciliation.
18. `streams/primer/feedstock/Books_Papers_Research/置身钉内 14.34.50.pdf` — Chinese-language PDF by filename; feeds Chinese vertical exploratory reading.
19. `streams/primer/feedstock/library/books/Economics China Politics History/Jens Østergaard Petersen, Yuri Pines, Christoph Harbsmeier - Han Feizi, The Art of Statecraft in Early China (Vol.2) A B.pdf` — bilingual Han Feizi/statecraft text; feeds Chinese/context vertical.
20. `streams/primer/feedstock/library/books/Economics China Politics History/Mark Elvin - The Pattern of the Chinese Past (1973, Stanford University Press).pdf` — Chinese history substrate; feeds Chinese-context enrichment.
21. `streams/primer/feedstock/library/books/Philosophy Literature/Nietzsche - Basic Writings [trans. and ed. Walter Kaufmann].epub` — core Nietzsche anthology; feeds philosophy vertical.
22. `streams/primer/feedstock/library/books/Philosophy Literature/On the Genealogy of Morals and Ecce Homo - Walter Kaufmann.epub` — Nietzsche genealogy text; feeds philosophy vertical.
23. `streams/primer/feedstock/library/books/Philosophy Literature/Nietzsche OnTheGenealogy.epub` — large duplicate/alternate Genealogy file; feeds dedupe + philosophy reading.
24. `streams/primer/feedstock/library/books/Other/Nick Land - Fanged Noumena Collected Writings 1987-2007 (2011, Sequence Urbanomic).pdf` — Land collection; feeds CCRU/Land genealogy vertical.
25. `streams/primer/feedstock/Zotero/storage/2DKELXFD/Wilson et al. - 2019 - The Eighty Five Percent Rule for optimal learning.pdf` — optimal-challenge pedagogy paper; feeds SRS/review difficulty calibration.

## Surprises (valuable, non-obvious)
- `streams/primer/feedstock/Zotero/storage/TEPASGA5/Dohare et al. - 2024 - Loss of plasticity in deep continual learning.pdf` — continual-learning/plasticity paper; useful analogy for SRS decay and review scheduling.
- `streams/primer/feedstock/Zotero/storage/YUM26K3M/Dohare et al. - 2024 - Maintaining Plasticity in Deep Continual Learning.pdf` — companion plasticity paper; feeds review-system design.
- `streams/primer/feedstock/Zotero/storage/PZ9EADLT/Parr et al. - 2022 - Active Inference The Free Energy Principle in Mind, Brain, and Behavior.pdf` — Friston/active-inference bridge into cybernetics and prediction-error pedagogy.
- `streams/primer/feedstock/library/books/Other/Addiction by Design Machine Gambling in Las Vegas - Schüll.pdf` — machine-friction/attention mechanics; useful negative design reference for reading-loop incentives.
- `streams/primer/feedstock/library/books/Other/Mapping the Neo-Manosphere(s) New Directions for Research.pdf` — unexpected adjacent genealogy material around online right-wing subcultures; possible context around Land-adjacent web cultures.

## Explicit NOT-FOUND
- No filename-level `CCRU` matches under `Books_Papers_Research`, `library`, or `Zotero/storage`; use Nick Land as the current CCRU-genealogy anchor.
- No filename-level `spaced`, `retrieval`, or `flashcard` matches under `Books_Papers_Research` or `library`; concrete SRS artifacts are the Mochi/Anki `.apkg` packages plus pedagogy papers surfaced through Zotero/library queues.
- No Deleuze/Guattari/Foucault/Debord/Wiener/Ashby files surfaced in the targeted `library/books/Philosophy Literature` and `Books_Papers_Research` filename scan; do not assume that genealogy layer exists locally without a deeper metadata pass.
- No unpacked Mochi deck contents were inspected; only `.apkg` package files were present at directory level.

## Explicit skip list
- `streams/primer/feedstock/Books_Papers_Research/AnnaArchive` — 169M finance/trading cluster; only `Superforecasting` is plausibly adjacent, not core to primer spine.
- `streams/primer/feedstock/Books_Papers_Research/image-gen`, `comfyui`, `Sylus_Exuberance` — visual/image-generation assets; out of scope for read/annotation/SRS.
- `streams/primer/feedstock/Books_Papers_Research/claude-code-main`, `streams/primer/feedstock/Books_Papers_Research/claude-code-main 2`, `tmux-3.6a`, `TrackingAndVisualizingFaces`, `mujoco` — code/robotics/vendor trees; no filename-level primer match except irrelevant memory tool names.
- `streams/primer/feedstock/gay-primer/pdf-annotation-app/node_modules` and `vendor` — dependency/vendor bulk; only app `src`, `scripts`, `data`, and extracted fixtures matter.
- `streams/primer/feedstock/gay-primer/pdf-js/.git`, `.claude-trace`, and most `test` bulk — kept only annotation fixtures and PDF.js structure; skipped repo history/trace noise.
- `streams/primer/feedstock/Zotero/translators`, `styles`, `cache` — Zotero support assets; skipped except noting ingestion/provenance role.
- `streams/primer/feedstock/library/books/Finance Trading Investing`, `Math Physics Statistics`, `Programming Computer Science`, `AI ML Robotics`, `Creative Media Games`, `Health Medicine Fitness` — large categories mostly outside Chinese/philosophy/SRS/annotation; sampled only by targeted filename/metadata queries.
- `streams/primer/feedstock/mochi/All Decks.apkg`, `streams/primer/feedstock/mochi/second-try.apkg`, `streams/primer/feedstock/mochi/old-version.apkg` internals — large archive packages; directory-level triage was enough to identify review substrate without unpacking 791M.
