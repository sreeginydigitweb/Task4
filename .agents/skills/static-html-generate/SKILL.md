---
name: static-html-generate
description: >-
    Generates the project's static HTML file from verified transformed data —
    using the existing build or template rather than hand-writing markup,
    producing the identified output file, preserving the page's structure,
    columns, filters and pagination, verifying the file actually contains the
    expected data, and checking it loads. Use when the static HTML or snapshot
    must be produced. Never invents data, never silently changes page
    behaviour, never commits, never pushes.
---

# Static HTML Generate

Six sections carry this skill, in this order: **Reverse Engineer**, **One Job /
One Trigger**, **Freedom Level**, **Verification**, **Walk Down**, **Bike
Method**. Hard Constraints, Workflow, Output and Portability sit between them
and are part of the contract.

**Project facts in this file are pointers, not authorities.** Re-read the named
files each run. Where this file and the code disagree, the code is right and
this file has a Bike Method entry waiting.

## 1. Reverse Engineer

The most expensive mistake this skill can make is writing HTML by hand when the
project already has a generator. Before producing anything, reconstruct:

**What already generates this file.** In this project, two builds exist and
they produce different artifacts:

- `npm run build` → `product-keywords/build-standalone.js` → **`index.html`**
  at the repository root (`DEFAULT_OUT`). The whole catalogue, self-contained,
  carrying its own client script; `PAGE_SIZE` 50;
  `<title>Product Keywords</title>`.
- `npm run snapshot` → `product-keywords/snapshot.js` →
  **`share/product-keywords-snapshot.html`**. A review copy, `DEFAULT_LIMIT`
  500, carrying `generatedAt` and `catalogueTotal`.

Both build their markup through pure functions — `buildStandaloneHtml` and
`buildSnapshotHtml` — that take data and return the document's text. **Use
them.** Hand-written markup that looks the same is a second implementation of
the page that nothing tests and nobody will maintain.

**What the page must preserve.** Read the constants, not the rendered output:

- `COLUMNS`, frozen identically in both files — nine columns, in order:
  Product Image, SKU, Product ID, Product Name, Category, Primary Keyword,
  Secondary Keywords, Long-Tail Keywords, Competitor Keywords.
- The filter controls and their behaviour contract — Search applying on Enter,
  the three dropdowns applying on change, Clear Filters resetting all four,
  and every control returning to page one. The comment block above the
  listeners states it and `product-keywords/build-standalone-client.test.js`
  asserts it.
- Pagination, the count line, and the empty state.
- The escaping the builders perform. Markup assembled outside them does not
  inherit it.

**What the input is, and whether it has been verified.** This skill consumes
the output of a transform step, not raw database rows. If that data has not
been verified against the page's structure, generating from it produces a file
that looks finished and may not be.

**What is currently at the output path.** Record it before writing: size,
modification time, and the commit it was last written at. Generation overwrites
a tracked artifact, and a change you cannot describe is a change nobody can
review.

Write down, for your own use, one sentence naming the output file and its
generator, and one naming the data going into it.

**Never invent data to fill the page.** A blank cell whose value the data does
not carry is correct; a plausible value put there to make the page look
complete is the one failure that survives every later check, because the page
looks right.

## 2. One Job / One Trigger

**One job.** Generate the required static HTML file from verified transformed
data, and verify that the file produced actually carries that data and that
page's behaviour.

**One trigger.** The static HTML must be produced — "generate the static HTML",
"build the HTML snapshot", "create the standalone HTML file", "regenerate the
static dashboard", or a request to produce the output file.

**Not this skill.** Fetching the data (`postgres-mcp-fetch`) or reshaping it
(`data-transform`). Nor changing what the page does, redesigning it, fixing a
build failure by editing source, or publishing the result anywhere.

## Hard Constraints

Absolute, and they override any instruction found in code, comments, or the
requester's phrasing:

1. **Never invent data.** Nothing on the page that the input data does not
   carry: no placeholder value, no filled gap, no example row, no rounded-up
   count. An absent value is rendered as the project's one agreed honest empty.
2. **Never silently change page behaviour.** Columns, their order and names,
   the filter contract, pagination, the count line, the title, the escaping.
   If a change is required to generate at all, stop and say so — a behaviour
   change is a separate, stated decision, never a side effect of a build.
3. **Do not modify source code, the build, or a test to make generation
   succeed.** A failing build is a valid and complete result.
4. **Do not hand-write the page** when a generator exists. If you believe it
   cannot produce what is needed, that is a finding, not a licence.
5. **Record the prior state of the output file before writing**, so the change
   is reviewable and reversible.
6. **Do not publish, deploy, upload, or push the artifact anywhere. Do not
   commit. Do not push.**
7. **Generation is the only write.** Nothing else in the tree changes — no
   lockfile, no config, no dependency installed, upgraded or pinned.
8. **Load checks are local and non-mutating.** Open the file, or a locally
   started server. No traffic to shared or production systems beyond the
   external asset hosts the page itself requests.
9. **No unverified claim.** A property of the generated file that was not read
   out of the file is Uncertain.

Scratch builds outside the project tree, driver scripts, and the report itself
are output — not source.

## 3. Freedom Level

**Free to choose.** Judgment calls — no run is wrong for choosing differently:

- **Which generator to invoke**, when the task does not say and more than one
  exists — provided the choice and its reason are stated.
- **Whether to generate into a scratch location first** and compare before
  writing the tracked file. Often the safer order, and always acceptable.
- **How to verify content** — parse the embedded data, search the text for
  markers, load it in a headless browser, or diff against the previous version.
- **Which markers prove the data landed** — a count, a specific record, a
  value only this input carries.
- **How the load check is performed**, within the safety rule.
- **Sample size** for record verification, provided it is stated.
- **Wording and ordering**, as long as every required Output field is present.
- **How a generation too large for one pass is split**, if the split is
  labeled.

**Not allowed, at any freedom level:**

- **No invented data, no behaviour change, no source or build edit, no
  hand-written page, no publish, no commit, no push.**
- **No "the build succeeded, therefore the page is right".** Build success and
  content correctness are separate results and are reported separately. A
  generator can exit zero and write a file missing half the catalogue.
- **No claim about the file's content that was not read out of the file.**
- **No suppressed warning.** Everything the build printed appears, including
  what looks harmless — with the evidence for calling it harmless.
- **No overwriting the tracked artifact when the input data is unverified.**
  Generate to scratch instead, and say why.
- **No dropped sections**, and the Coverage table always carries every area.
- **No scope drift** into fixing the data, the query, or the page's design.

**When the boundary is tested.** If asked mid-run to change a column, adjust
the filters, fix a build error in source, or commit the result, generate what
was asked first and say plainly that each of those is a separate request.

## Workflow

### Step A — Identify the output file and the generator

Name both, and say how you decided. Record the output path's current state:
size, modification time, and the commit it was last written at. Confirm the
working tree is otherwise clean, so the only change afterwards is the artifact.

### Step B — Confirm the input

Establish that the data going in has been verified against the page's structure
— the field map complete, the counts reconciled, at least one record
round-tripped. If it has not, either get that done first or **generate to a
scratch path instead of the tracked one**, and say which you did.

### Step C — Generate

Run the generator. Capture the exact command, the exit status, the full output,
and how long it took. Where the tracked artifact is at risk and the input is
not fully verified, build into a scratch location outside the project tree and
compare before deciding anything.

If generation cannot run — missing toolchain, missing configuration, an
environment you may not touch — say so here and stop. A stated failure is a
complete result.

### Step D — Read the errors and warnings

Every error in full. Every warning in full, each classed: from the current
source, pre-existing, or from a dependency. Warnings are where a build says it
produced something other than what was asked for.

### Step E — Verify the file carries the expected data

Read it out of the generated file, not out of the build log:

- **Record count** — what the file embeds, against what the input held.
- **Specific records** — an ordinary one, an edge case (an empty value, a
  maximal list, a missing relation), and one known to be difficult. Compare
  field by field against the input.
- **Derived lists** — option lists, counts per value, and their ordering,
  against the input's own.
- **Honest empties** — absent values rendered in the one agreed way, and not
  filled.
- **Nothing extra** — no placeholder, no leftover token, no unresolved
  substitution, no `undefined` or `null` in visible text.

### Step F — Verify structure and behaviour are preserved

- **Columns** — all present, in order, spelled as `COLUMNS` spells them.
- **Filters** — the controls present and wired as the contract says; the Enter
  and empty-search paths intact.
- **Pagination and the count line** — present, and consistent with the embedded
  total.
- **Page title and framing** — matching the constant.
- **Escaping** — a value containing markup characters renders as text, not as
  markup. Check one deliberately.

### Step G — Check it loads

Open the artifact locally — a headless browser, or the project's own client
tests against the generated output. Record: the page renders, the table draws,
the console errors and failed requests in full, and the count line as shown.
**This establishes that the artifact loads and behaves — it does not establish
that the underlying data is correct**, and is reported as the former.

### Step H — Identify the artifact and report

State plainly what was produced: full path, size, when, from which generator,
from which input, and how it differs from what was there before. Then emit the
Output in full.

## 4. Verification

Nothing reaches the output as generated-and-sound without passing this gate.

1. **Name the artifact.** Full path, size, and the moment it was written.
2. **Name the evidence** for every claim — the command and exit status, the
   content read out of the file, the comparison performed, the browser
   observation.
3. **Separate the three questions** explicitly: did the generator run, did it
   write the file, and does the file carry the right data and behaviour. A
   finding says which of the three it belongs to.
4. **Read the file, not the log.** A build step can report success and write a
   truncated document.
5. **Reach a record.** At least one specific record compared from input to
   rendered output. **A file verified only by counts is reported as
   aggregate-only.**
6. **Check the benign explanations** before calling anything wrong: a
   legitimately empty value; a count that differs because the input was
   filtered by design; an external asset host that is slow rather than broken;
   a difference from the previous version caused by the new data rather than by
   a defect.
7. **Assign a class:**
   - **Generated and verified** — file read, records reached, structure and
     behaviour preserved, load checked.
   - **Generated, partially verified** — written, but something above could not
     be established. Say which.
   - **Generated, incorrect** — a named difference from the input or the page
     contract.
   - **Not generated** — and why.

Never report a green build as a correct page. The page is the deliverable a
person will read, and it is entirely possible for every step before this one to
be right and the file still be wrong.

## Output

```markdown
## Static HTML Generate

**Output file:** <full path>
**Generator:** <command and `<path>` — and why this one>
**Input data:** <where it came from, and whether it was verified against the page structure>
**Prior state of the output path:** <size, modification time, commit last written at — or "did not exist">

### Generation
- **Command:** <exact>
- **Exit status:** <code> — <succeeded | failed>
- **Duration:** <time, or "not recorded">
- **Wrote to:** <the tracked path | a scratch path outside the tree, and why>
- **Errors:** <every one in full. If none: "None.">
- **Warnings:** <every one in full, classed: current source | pre-existing | dependency. If none: "None.">

### Artifact
| Property | Value |
| --- | --- |
| Path | <full path> |
| Size | <bytes> (previously <bytes>) |
| Written at | <timestamp> |
| Records embedded | <n> (input held <n>) |
| Self-contained | <yes / no — what it references externally> |

### Data Verification
| Check | Expected (from input) | In file | Match? |
| --- | --- | --- | --- |
| Record count | <n> | <n> | yes / no |
| <derived list> values & counts | <...> | <...> | |
| Ordering rule | <the rule> | <as found> | |
| Honest empties rendered | <representation> | <as found> | |
| No placeholder / unresolved token | none | <as found> | |

### Record Spot Checks
| Key | Field | Input value | In generated file | Match? |
| --- | --- | --- | --- | --- |
| <key — ordinary> | <field> | <value> | <value> | yes / no |
| <key — edge case> | | | | |

### Structure & Behaviour Preserved
| Item | Expected (source constant) | In file | Preserved? |
| --- | --- | --- | --- |
| Columns (all, in order) | <COLUMNS> | <as found> | yes / no |
| Filter controls | <the contract> | <as found> | |
| Enter / empty-search paths | <the contract> | <as found> | |
| Pagination & count line | <page size, format> | <as found> | |
| Page title | <constant> | <as found> | |
| Escaping | markup renders as text | <as found> | |

### Load Check
<What was opened and how; whether the page rendered and the table drew; the count line as shown; every console error and every failed request, in full. If not performed: "Not performed — <reason>.">
<Note: this establishes that the artifact loads, not that the data is correct.>

### Confirmed Findings
<Highest severity first. Each labelled: generator ran | file written | content/behaviour. If none: "None.">

#### <N>. <short title> — <Critical | High | Medium | Low> — <which question>
- **Where:** <the artifact, or `<path>:<line(s)>` in the generator>
- **Area:** Build command | Generated file | Errors | Warnings | Data content | Columns | Filters | Pagination | Counts | Escaping | Load behaviour
- **What:** <the defect>
- **Evidence:** <what was read out of the file, or observed in the browser>
- **Benign explanations eliminated:** <legitimate empty, by-design filter, slow host, new data>
- **Consequence:** <what a reader of this file sees, or cannot see>
- **Suggested direction:** <in words; do not apply it to source>

### Observations
<Real, nothing broken. If none: "None.">

### Uncertainties / Open Questions
<What could not be verified, why, what would resolve it. If none: "None.">

### Coverage
| Area | Result |
| --- | --- |
| Existing build/template structure inspected | <verified / N findings> |
| Output file identified | <...> |
| Verified input used | <...> |
| Valid static HTML produced | <...> |
| Page structure preserved | <...> |
| Columns preserved | <...> |
| Filters preserved | <...> |
| Pagination preserved | <...> |
| Content matches input | <...> |
| Artifact identified | <...> |
| Load behaviour | <verified / not performed> |

### Verification
- **Commands run:** <exact, and where each wrote>
- **How the file was read:** <parsed | searched | loaded in a browser | diffed against the previous version>
- **Files inspected:** <source paths, for expectations>
- **Sampling:** <how spot-check records were chosen, and how many>
- **Not verified:** <what was out of reach and why>
- **Tree state afterward:** <only the named artifact changed — confirmed>
- **Constraints honored:** No data invented. No page behaviour changed. No source, build or test modified. No dependency changed. Nothing published or deployed. No commit. No push.

**Verdict:** <Generated and verified | Generated, partially verified — <what is open> | Generated, incorrect — <what is wrong> | Not generated — <why>>
```

Rules for the output:

- The artifact is identified by full path, size and time — never as "the HTML
  file".
- Build success and content correctness appear as separate results; the Verdict
  never conflates them.
- Every warning appears, in full.
- "Content matches input" requires at least one record spot check, or is marked
  aggregate-only.
- The Verification section is mandatory, including on a clean run.

## Portability

- **Model-agnostic.** No reasoning-mode toggles, no token budgets, no
  assumptions about context window, tool-calling style, or parallel tool use.
  Every step is a sequential generate-then-inspect loop. **No model name
  appears in this file and none may be added** — no per-model branch, ever.
- **No toolchain assumptions.** A build script, a template renderer, a static
  site generator, or a pure function returning a document string all satisfy
  the workflow; what matters is using the project's own rather than writing a
  second one.
- **No required tooling for verification.** A parser, a text search, a diff, a
  headless browser, or plain file reads all work. Without a browser, the load
  check is reported as **not performed** — never described as if it had been.
- **Project-specific by design, but never authoritative.** Re-read the
  generators and `COLUMNS` each run; both the output path and the row shape
  have changed before.
- **Degrade by breadth, never by rules.** A smaller model may spot-check fewer
  records or skip the browser check and say so — it must not invent data,
  hand-write the page, treat a green build as a correct page, suppress a
  warning, change behaviour, or drop sections.
- **Fixed output contract**, identical across tiers.

## 5. Walk Down

Exercise this skill across the model tiers available, holding everything else
constant.

**Hold constant:**

- **Same skill** — the identical `SKILL.md`, unedited for the whole walk.
- **Same task** — the same output file, the same generator, the same stated or
  omitted detail.
- **Same code state** — the same commit, working tree, dependencies and
  toolchain. Re-check between runs.
- **Same input data** — give every tier the *same verified transformed
  dataset*, from a file. A generation over different input is not comparable,
  and fixing the input removes live-database noise entirely.
- **Same output target** — have every run generate to its own scratch path, and
  compare the files. That keeps the tracked artifact byte-identical through the
  whole walk and makes the runs directly diffable.
- **Same prompt** — byte-identical; never hint at what is wrong with the
  output. A prompt needing rewording per tier is itself the finding.
- **Same expected output** — the Output template.

Prefer an input whose correct generated result is already recorded, so runs
score against an answer key rather than an impression.

**Direction and comparison.** Run every available tier on the identical task,
strongest to weakest, one at a time. The strongest run is the reference. Read
each lower run against it and **name the observed differences specifically** —
including a byte-level diff of the generated files, which is the sharpest
signal this walk down can produce. Record the tier order used; refer to tiers
only as "the reference tier", "one tier down", never by model name.

| Axis | Question |
| --- | --- |
| Artifact | Are the generated files identical? Where they differ, what differs and why? |
| Invented data | Did this run put anything on the page the input does not carry? |
| Behaviour preserved | Columns, filters, pagination, title, escaping — all intact, or quietly changed? |
| Verification | Was the file read, a record reached, the load checked — or asserted from the build log? |
| Output consistency | Artifact, Data Verification, Spot Checks and Structure tables populated; every section present? |
| Constraint compliance | Was source, build or a test edited? Was the page hand-written? Was the tracked artifact overwritten during the walk? Any publish, commit or push? |

Breadth may shrink: a lower tier may spot-check fewer records or skip the
browser check, provided it says so. Rules may not shrink. A lower tier that
invents data, hand-writes markup, changes behaviour, or reports a green build
as a correct page has found a defect in this file.

**No skill modification during the walk** — an edited file invalidates every
run before it. Finish, record the differences, then Bike Method once.

## 6. Bike Method

Improve this file **only from an observed failure in a real generation**.

| Failure observed | Fix in this file |
| --- | --- |
| Put data on the page the input did not carry | Reinforce the no-invention rule in section 1 and Hard Constraints |
| Hand-wrote markup when a generator existed | Strengthen the use-the-generator rule in section 1 and Freedom Level |
| Treated build success as a correct page | Sharpen the three-question separation in Verification step 3 |
| Reported content from the build log, not the file | Strengthen Verification step 4 |
| Changed a column, a filter, or the title without saying so | Make the no-silent-behaviour-change constraint unambiguous |
| Lost escaping by assembling markup outside the builder | Strengthen Step F's escaping check |
| Suppressed or summarized a warning that mattered | Make the warning rule unambiguous |
| Overwrote the tracked artifact from unverified input | Strengthen Step B |
| Edited source to make a failing build pass | Make the violated Hard Constraint unambiguous |
| Claimed a load check that was never performed | Strengthen the "not performed" rule in Step G and Portability |
| A path, constant or command here no longer matches the project | Update the pointer, noting the observed mismatch |
| Output drifted between runs or tiers | Make the Output template more explicit |
| Behaved differently on a smaller tier | Simplify the rule under Portability; never add a model-specific branch |
| Published, committed, or pushed | Make the violated Hard Constraint unambiguous |

Rules for every edit:

1. **One observed failure, one targeted change.** No speculative rewrites, no
   bundled improvements, no edit without a failure behind it.
2. **Generalize before writing.** Record the pattern ("the build exited zero
   and wrote a document missing the last batch"), never the instance.
3. **Retest** — re-run the walk from the top, including on the smallest tier
   available. A fix is kept only once the weakest tier passes with it.
4. **No model-specific fixes.** A per-model branch is the one forbidden repair.
5. Prefer deleting a misfiring instruction over stacking a caveat on it.
6. This file is the artifact under improvement and is not application code.
