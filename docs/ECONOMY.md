# Economy

Gold, goods, ports and the tavern (slice 5c). Ships and the shipyard follow in 5d. Code: `world/goods.ts`, `world/economy.ts` (data), `gameplay/harbour.ts` (rules), `ui/port*.ts` (panel). The repo has no cargo table from the original game, so the goods and port tables below are our own.

## Goods
Ten goods, one unit of any good takes one unit of hold (`stats.hold`): erzak (provisions) 8, rom 20, şeker 25, pamuk 30, tütün 35, kahve 45, maun 55, abanoz 75, baharat 95, ipek 120 gold.

## Ports
Each port multiplies the base price of a few goods: **produced** goods cost 0.82–0.89 there, **wanted** goods 1.12–1.20; everything else costs the base. Every good is made in some port and wanted in another (guarded by `tests/trade.test.ts`). The multipliers are in `PORT_ECONOMY`; `yardClass` (best ship class its yard builds) is used by the shipyard in 5d.

## Prices
- The mid price is `base × port multiplier × (1 + pressure)`. Buying pays 6 % above it, selling gets 6 % below (`TRADE.spread`), so buying and selling in one port always loses money.
- **Pressure** keeps the market honest: every unit bought raises the good's price in that port by `1/20 000`, every unit sold lowers it (clamped to −50 %…+100 %), and it fades by half every 600 game seconds. A lot is priced at the mean of the price before and after it, so a full galleon hold moves a single good by ~10 %. State per port and good is `{ p, t }` in `GameState.market`; prices are computed on demand from it and the game time (nothing runs per frame, and a save is just that JSON).
- The best run of one full hold of a single good between a port that makes it and one that wants it earns about 26 % (Tartane), 22 % (Sloop), 17 % (Brig), 4 % (Galleon) and loses a little for a Battleship: the big hulls saturate the market, so they split the hold across goods (`tests/trade.test.ts` pins 15–35 % for the Tartane…Brig and a floor for the rest, with two goods sharing the hold). Neighbouring ports are a minute or two of sailing apart.

## Crew
The tavern signs on sailors at 10 gold each, up to the ship's `stats.crew` (asking for more signs on as many as fit), and discharges them (the last sailor stays). Crew speeds up the guns (`GAME_DESIGN.md`), so hiring after a fight is how a battered ship gets back to its full rate of fire.

## Port panel
Docking (`F`) opens a tabbed panel: **Pazar** (a row per good: buy and sell price, hold, `+1 +10 Maks −1 −10 Hepsi`; green names are cheap, orange dear), **Tersane** (5d), **Taverna**. The panel gets an `onCommand` callback, so `ui` sends `PortCommand`s and only reads `GameView.port`; refusals come back as codes (`no-gold`, `no-space`, `no-stock`, `crew-full`, `no-crew`, `not-docked`) and the panel words them in Turkish.

## Open
Hiring is cheap next to trade profit (a full Brig crew is 1 600 gold), and later ships cost little against what a full hold earns, so the ladder of 16 ships will be climbed quickly: sailing time, risk (pirates), a price that grows with class or level, and the shipyard's trade-in (5d) are the levers. Every good takes one unit of hold regardless of value, so silk and spice always win the hold. Quests, reputation and nation prices (5e); a trade ledger; selling prizes (5d); the price tables have not been played through by a human.
