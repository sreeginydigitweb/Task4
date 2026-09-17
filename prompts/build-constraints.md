# Build constraints - Task 4

The limits this build was carried out under, recorded so a later reader can
tell what the code was told to do from what it decided for itself.

## Scope

- Use **ledsone only**. Do not connect to `order_management_copy`. Do not use
  `listing_generator` from another database.
- Read-only. No CREATE, no INSERT, no UPDATE, no DELETE, no migrations, no
  schema changes.
- No CRUD, no admin interface, no keyword editing, no dashboard extras.
- Do not modify the Inventory System repository. Task 4 stays separate.
- No frontend framework. Node + `pg` + hand-rendered HTML.

## The keyword rule, verbatim in substance

> The four requested keyword categories are NOT confirmed as stored categories
> in ledsone. Therefore: do not create fake values. Do not derive EXACT →
> Primary, PHRASE/BROAD → Secondary, word count → Long-Tail, anything →
> Competitor, unless explicitly instructed later.
>
> If a requested category has no corresponding data in ledsone, display an
> honest empty value. Use one consistent representation. The UI must not claim
> that a keyword is Primary, Secondary, Long-Tail or Competitor unless that
> classification actually exists in ledsone.

This is the reason `classifyKeywords()` returns `null` for all four categories,
and the reason `source.test.js` asserts that it does. Neither is an oversight.

`amazon_campaigns.keywords.match_type` was specifically ruled out as a source
for Primary/Secondary: *"Those are business rules and have NOT been approved
yet."*

## Representation chosen

`Not recorded`, used everywhere. The instruction offered either an em dash or
`Not recorded` and required one consistent choice; `Not recorded` was picked
because it states that the business has not captured the value, where a dash
could be read as a value of its own. It matches the existing `NOT_IN_SOURCE`
convention in the Inventory System.

## One addition beyond the seven requested columns

An eighth column, "Keywords recorded in ledsone (unclassified)".

The instruction required both that the seven requested columns stay visible and
that the application *"fetch and display the actual keyword data that can be
safely related to the product from ledsone"*. With all four keyword columns
honestly empty, the eighth column is where the real data goes - under a heading
that states it carries no classification, rather than being spread across the
four category columns as though it had been classified.

## Git

> DO NOT commit or push yet. I will review your BUILD report and give explicit
> confirmation before commit/push.

The repository was initialised so that `git status` could be reported. Nothing
has been committed. Nothing has been pushed. No remote is configured.
