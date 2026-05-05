# StockScreener Usage Guide

This guide explains how to use the application effectively once it is running.

Primary production/local app pages:

- `/dashboard`
- `/screener`
- `/institutional-flow`
- `/trending`

The landing page at `/` is only the entry point.

## Best Starting Workflow

Use the app in this sequence:

1. Build and organize your watchlists in `Dashboard`.
2. Use `Signal Screener` to evaluate those watchlists.
3. Use `Market Flow Leaders` to spot strong market pressure names.
4. Use `Trending` to discover broader active candidates.
5. Move promising symbols into the right watchlists and re-screen them.

That workflow keeps the pages connected instead of treating them as unrelated tools.

## Dashboard

The dashboard is where you manage symbols and watchlists.

## Add a symbol

1. Open `/dashboard`.
2. Type a ticker or company name in the symbol search box.
3. Choose the target watchlist.
4. Add the symbol.

The symbol is saved to SQLite and will still be there on the next load.

## Remove a symbol

Use the `Remove` button on the symbol card.

That removes it from the currently assigned watchlist.

## Reorder symbols

Drag and drop works only when both conditions are true:

- you are viewing one specific watchlist
- grouping is set to `Watchlist order`

Drag and drop is disabled in:

- `All watchlists`
- grouped trend views

That is intentional. Those modes are for scanning, not manual ordering.

## Move a symbol to another watchlist

Each dashboard card has:

- a watchlist dropdown
- a `Move` button

To move a symbol:

1. Choose the destination watchlist on that card.
2. Click `Move`.

Current behavior:

- move means reassign
- it does not copy the symbol into both watchlists
- a symbol belongs to one watchlist at a time

## Create a watchlist

Use the watchlist controls at the top of the dashboard to create a new watchlist.

Use clear names that reflect purpose, for example:

- `Core`
- `Growth`
- `Semis`
- `High Conviction`
- `Earnings Watch`

## Delete a watchlist

Use the `Delete watchlist` control while a non-`Core` watchlist is selected.

Rules:

- `Core` cannot be deleted
- deleting another watchlist automatically moves its symbols back to `Core`

That keeps data safe and prevents accidental symbol loss.

## View one watchlist vs all watchlists

The dashboard supports both:

- a single watchlist view
- an `All watchlists` view

When `All watchlists` is selected, the dashboard groups cards by watchlist so you can scan the entire book without losing list boundaries.

## Dashboard grouping modes

The dashboard supports:

- `Watchlist order`
- `Trend buckets`

Use `Watchlist order` when:

- you want manual prioritization
- you want drag-and-drop

Use `Trend buckets` when:

- you want to scan leaders vs weaker names quickly
- you do not need manual ordering at that moment

## Global range vs local range

The dashboard has both:

- a global range selector
- per-card range selectors

Use the global selector when comparing the same time window across many names.

Use a local card selector when one symbol needs closer inspection without disturbing the rest of the page.

## Auto-refresh

The dashboard refreshes loaded symbol pricing automatically every 10 seconds.

Use this page for:

- monitoring
- symbol management
- fast chart inspection

Do not use it as the only decision page. Use the screener to turn observation into a structured recommendation.

## Signal Screener

The screener evaluates saved dashboard symbols and turns them into directional recommendations.

## How to use it properly

1. Choose a watchlist or `All watchlists`.
2. Run the screen.
3. Review recommendation buckets.
4. Check calibration fields, not just the headline label.
5. Only then decide whether the symbol deserves action or further monitoring.

## Recommendation meanings

- `Strong Buy`: strongest bullish alignment in the current engine
- `Buy`: bullish but less aggressive than strong buy
- `Watch`: interesting, but not strong enough for action
- `No Trade`: conflicting or weak setup
- `Sell`: bearish setup
- `Strong Sell`: strongest bearish setup
- `Skipped`: symbol could not be evaluated because upstream data failed

The most important distinction is between `Watch` and `No Trade`.

- `Watch` means the setup may become actionable soon
- `No Trade` means the engine sees no clean edge right now

## Do not over-trust the headline label

Look at the supporting fields:

- regime context
- broad-market relative strength
- sector relative strength
- 5-day hit rate
- 20-day expected return
- ATR stop guidance

Those supporting fields matter more than the label by itself.

## Best screener usage pattern

Use the screener in this order:

1. Filter to a watchlist with a clear purpose.
2. Review the `Strong Buy`, `Buy`, and `Watch` names first.
3. Reject anything with weak calibration even if the raw score looks strong.
4. Compare with the dashboard chart before acting.
5. Re-check later rather than forcing trades from mixed signals.

## Watchlist view modes in screener

The screener can render:

- one selected watchlist
- all watchlists together

When `All watchlists` is selected, results are grouped by watchlist so you can preserve context while still seeing the full universe.

## Screener grouping modes

The screener supports:

- `Watchlist order`
- `Signal buckets`

Use `Watchlist order` when:

- your manual sequence matters
- you want to review symbols in the same order as the dashboard

Use `Signal buckets` when:

- you want the fastest scanning view
- you want to isolate strong buys, sells, and no-trade names immediately

## Backtest

The backtest does not run automatically on page load. This is intentional.

Why:

- it is the heaviest feature in the app
- loading it only on demand improves reliability

## When to run backtest

Run it when:

- you want to validate whether the current signal engine is behaving well
- you want evidence across the selected watchlist
- you want to review alpha and net-return tendencies before trusting current recommendations

## How to use backtest results

Focus on:

- hit rates
- expected returns
- alpha vs benchmark
- long vs short bucket behavior

If the engine shows weak recent validation for a watchlist, do not treat live `Buy` labels as high confidence.

## CSV export

Use CSV export after a backtest has been run.

That export is best for:

- offline review
- sorting outside the app
- keeping research snapshots

## Market Flow Leaders

This page is for market-wide buy/sell pressure scanning.

Use it to answer:

- which liquid names are showing unusual activity pressure now
- which names deserve to be added to a watchlist for later screening

Best use:

1. scan the leaders
2. inspect the inline charts
3. move interesting names into a watchlist
4. run them through the technical screener

Treat this page as a discovery and prioritization tool, not final execution logic.

## Trending

This page shows a broader top-activity view than Market Flow Leaders.

Use it when:

- you want new ideas
- you want names with strong recent movement and participation
- you want a faster top-of-market pulse

This page is useful for:

- expanding candidate lists
- finding names not yet on your watchlists
- checking whether market attention is concentrated in a theme

## Inline charts on signal pages

Both `Market Flow Leaders` and `Trending` support:

- a page-wide range selector
- per-card local range controls

Use the global selector to compare the same timeframe across all names.

Use local controls when one symbol deserves a different lookback without changing the whole page.

## Practical Operating Model

If the goal is better buy/sell decisions, use the app like this:

1. Use `Trending` to discover active names.
2. Use `Market Flow Leaders` to find names with stronger pressure characteristics.
3. Add promising names into purpose-built watchlists on `Dashboard`.
4. Run `Signal Screener` on those watchlists.
5. Reject low-confidence setups even when they look interesting visually.
6. Revisit later instead of forcing a trade.

That is the best current use of the application.

## What the application is best at

It is strongest at:

- organizing names into persistent working lists
- giving a fast visual and technical pass across multiple symbols
- filtering out weak setups with `Watch` and `No Trade`
- combining monitoring, screening, and discovery in one workspace

## What the application is not yet doing

Be explicit about current limits:

- it is not a broker
- it does not execute orders
- it does not have guaranteed institutional order-flow feeds
- it depends on Yahoo as an unofficial upstream source
- it does not replace full portfolio risk management

Use it as a decision-support tool, not an autopilot trading system.

## Recommended Watchlist Structure

A practical structure is:

- `Core`: symbols you always monitor
- `Active Setups`: names close to action
- `Sector Themes`: semis, software, energy, banks, and so on
- `High Risk / Event`: names around earnings or special situations

That keeps screening results easier to interpret.

## Troubleshooting

## Screener shows `Skipped`

Meaning:

- the symbol failed upstream data retrieval

What to do:

- retry later
- verify the ticker is valid
- remove stale or invalid symbols from watchlists

## Drag and drop is not working

Check:

- are you in one watchlist, not `All watchlists`
- is grouping set to `Watchlist order`

If not, drag is intentionally disabled.

## Railway behaves differently from local

Check:

- is Railway using the latest deployed commit
- is `web-dashboard` set as the Railway service root
- is `/data` mounted persistently
- is `DATA_DIR=/data` set
- does Railway have stale symbol data in its SQLite volume

## Best Habits

- keep watchlists purposeful instead of dumping everything into one list
- use `No Trade` as a useful outcome, not a failure
- validate with backtests before trusting live scores too much
- use grouped views for scanning and single-watchlist views for editing
- move symbols between watchlists as their role changes

## Summary

The best way to use this application is:

- organize in `Dashboard`
- evaluate in `Signal Screener`
- discover in `Market Flow Leaders` and `Trending`
- keep the process disciplined

The app works best when it is used as a structured workflow rather than a single page of charts.
