# Economy

Gold, goods, ports, the tavern (5c) and the shipyard (5d). Code: `world/goods.ts`, `world/economy.ts` (data), `gameplay/harbour.ts` (rules), `ui/port*.ts` (panel). The repo has no cargo table from the original game, so the goods and port tables below are our own.

## Goods
Ten goods, one unit of any good takes one unit of hold (`stats.hold`): erzak (provisions) 8, rom 20, şeker 25, pamuk 30, tütün 35, kahve 45, maun 55, abanoz 75, baharat 95, ipek 120 gold.

## Ports
Each port multiplies the base price of a few goods: **produced** goods cost 0.82–0.89 there, **wanted** goods 1.12–1.20; everything else costs the base. Every good is made in some port and wanted in another (guarded by `tests/trade.test.ts`). The multipliers are in `PORT_ECONOMY`; `yardClass` (best ship class its yard builds) decides what its shipyard sells.

## Prices
- The mid price is `base × port multiplier × (1 + pressure)`. Buying pays 6 % above it, selling gets 6 % below (`TRADE.spread`), so buying and selling in one port always loses money.
- **Pressure** keeps the market honest: every unit bought raises the good's price in that port by `1/20 000`, every unit sold lowers it (clamped to −50 %…+100 %), and it fades by half every 600 game seconds. A lot is priced at the mean of the price before and after it, so a full galleon hold moves a single good by ~10 %. State per port and good is `{ p, t }` in `GameState.market`; prices are computed on demand from it and the game time (nothing runs per frame, and a save is just that JSON).
- The best run of one full hold of a single good between a port that makes it and one that wants it earns about 26 % (Tartane), 22 % (Sloop), 17 % (Brig), 4 % (Galleon) and loses a little for a Battleship: the big hulls saturate the market, so they split the hold across goods (`tests/trade.test.ts` pins 15–35 % for the Tartane…Brig and a floor for the rest, with two goods sharing the hold). Neighbouring ports are a minute or two of sailing apart.

## Crew
The tavern signs on sailors at 10 gold each, up to the ship's `stats.crew` (asking for more signs on as many as fit), and discharges them (the last sailor stays). Crew speeds up the guns (`GAME_DESIGN.md`), so hiring after a fight is how a battered ship gets back to its full rate of fire.

## Port panel
Docking (`F`) opens a tabbed panel: **Pazar** (a row per good: buy and sell price, hold, `+1 +10 Maks −1 −10 Hepsi`; green names are cheap, orange dear), **Tersane** (see below), **Taverna**. The panel gets an `onCommand` callback, so `ui` sends `PortCommand`s and only reads `GameView.port`; refusals come back as codes (`no-gold`, `no-space`, `no-stock`, `crew-full`, `no-crew`, `not-docked`) and the panel words them in Turkish.

## Shipyard (5d)
`gameplay/shipyard.ts`, tab `ui/portYard.ts`. A port's yard sells every ship of its `yardClass` (1 = battleship … 7 = tartane) and smaller: Redmond sells all 16, Douwesen, Conceicao and Quebradas class 2 and up, Oxbay class 3, Falaise 4, Isla Muelle, Greenford and Khoal Roa 5, the two smugglers' ports only the four class-6/7 ships (Tartane, Barque, Yacht, Lugger).
- **Price** is the original table's `price × 1000` gold (a Brig 80 000). The yard buys the ship you sail for `50 % × price × (0.4 + 0.6 × hull share)` (a whole Brig 40 000, a wreck 16 000), and you pay the difference (`net`).
- **Refusals:** the yard does not build it (`not-sold`), it is your own ship, your cargo does not fit the new hold (sell it first: `hold-too-small`), or not enough gold. The panel shows the reason on the disabled button.
- **The swap:** the new ship comes whole (full hull, clean rigging, no leaks or fire); the cargo, gold, place and mooring stay; the crew is trimmed to the new ship's company (a bigger ship starts under-manned: hire at the tavern); the enemies afloat are removed, since they were picked for the old ship, and new ones come after the usual delay. The deck crew and the model are rebuilt (`sailingMode` preloads the model with `requestShipAsset` before the game swaps).
- **Repair:** a moored hull now mends only 0.2 %/s (was 2 %), so the yard's paid "Onar" matters: `25 % × price × missing hull + 5 % × price × missing rigging`, and it also puts out leaks and fire. Rigging, leaks and fire still mend quickly at the quay (`damage.ts`).

- **Selling** a ship is part exchange: there is no sale without buying another, and trading down pays the difference (the `Fark` column goes negative and the tooltip says what you get). You cannot be without a ship, and there is no second hull.
- **A new ship is new:** full hull, clean rigging, no leaks or fire, whatever state the old one was in; you pay the full price less the trade-in, which already counts the old hull's damage (a wreck is worth 0.2 of its price). Repair costs at least as much as it adds to the trade-in (`tests/shipyard.test.ts`), so mending before selling never pays. Because the prices are the original game's, some ships are stronger than dearer ones (a Frigate outguns a Corvette for more gold, a Caravel is cheap for its hull): a design inheritance, not an exploit.
- **Crew:** a smaller ship keeps only its own company (the tooltip says how many go ashore), a bigger one starts short-handed. A ship that arrives in port with under a quarter of its company finds volunteers on the quay (`COMPANY.volunteers`), so a lost boarding can never strand the player.

## Open
Hiring is cheap next to trade profit (a full Brig crew is 1 600 gold), and later ships cost little against what a full hold earns, so the ladder of 16 ships will be climbed quickly: sailing time, risk (pirates), a price that grows with class or level, and the shipyard's trade-in (5d) are the levers. Every good takes one unit of hold regardless of value, so silk and spice always win the hold. Quests, reputation and nation prices (5e); a trade ledger; taking a prize ship instead of scuttling it; the price tables have not been played through by a human.
