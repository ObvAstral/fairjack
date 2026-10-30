# FairJack

Prototipo didattico di blackjack on-chain con puntate ERC20 FJT, house pool con
share e **Chainlink VRF v2.5 pagato dalla pool**. Il contratto non ha owner,
validator applicativi, collateral o commit/reveal.

## Deploy precedenti e configurazione attuale

Gli indirizzi Sepolia della versione con validator e commit-reveal sono
**STORICI / OBSOLETI per questa versione** e sono conservati soltanto
[nell'archivio del vecchio deploy](docs/deployments/sepolia-legacy.md).
La relazione `report.pdf` descrive anch'essa la versione precedente.

Per il frontend VRF usa gli indirizzi generati da un nuovo deploy.
`frontend/.env.example` è un modello con indirizzi vuoti, non una configurazione
di un deploy già effettuato. Il file generato `frontend/.env.local` riporta
protocollo, rete, chain ID e timestamp nell'intestazione.

## Randomness e ciclo della partita

La pool usa il **direct funding in ETH** attraverso il wrapper Chainlink:

1. `startPoolGame(bet)` incassa FJT, blocca `2 × bet`, prenota il budget ETH
   dell'oracolo e paga una richiesta per le quattro carte iniziali.
2. Il wrapper restituisce la randomness alla callback autenticata. La callback
   salva soltanto il risultato: non pesca carte e non trasferisce token.
3. Chiunque può chiamare `processRandomness(gameId)` per distribuire le carte.
   Da quel momento il player ha cinque minuti per scegliere Hit o Stand.
4. Ogni `hit(gameId)` registra irrevocabilmente Hit e paga una **nuova** richiesta.
   Dopo risposta ed elaborazione viene aggiunta una sola carta. Il bust chiude
   subito la partita; altrimenti comincia un nuovo intervallo di cinque minuti.
5. `stand(gameId)` paga una nuova richiesta se il dealer ha meno di 17. Un solo
   risultato completa tutta la mano automatica del dealer. Se ha già almeno 17,
   il contratto può chiudere subito senza pagare un'altra richiesta.
6. Una vittoria paga `2 × bet`, un push restituisce `bet`, una sconfitta assegna
   la puntata alla pool. Settlement e timeout liberano le prenotazioni una volta.

Ogni risposta è associata a request ID e partita, anche con consegne fuori
ordine. Un valore casuale uguale a zero è valido. Il mazzo virtuale Fisher-Yates
rimuove ogni carta pescata in lavoro limitato: non ci sono carte duplicate o
cicli illimitati per scartare collisioni. Nessun seed già pubblico viene usato
per decisioni future del player.

Gli stati ABI sono `Created=0`, `WaitingForRandomness=1`, `RandomnessReady=2`,
`PlayerTurn=3`, `DealerTurn=4`, `Finished=5`. La fase della richiesta è
`InitialDeal=0`, `PlayerHit=1`, `Dealer=2`.

## Riserva ETH e share FJT

Le share rappresentano **solo i FJT della house pool**. Depositi e prelievi FJT
sono sospesi finché esistono partite attive: nessuno può comprare o vendere
share al vecchio prezzo dopo aver osservato un risultato VRF non ancora
liquidato. La riserva ETH resta finanziabile durante le partite. Il contratto mantiene
una riserva ETH di servizio distinta, finanziabile da chiunque con `fundOracle()`
o un trasferimento ETH. Questi contributi sono **irrevocabili**: non mintano
share, non sono riscattabili e nessun amministratore può prelevarli. Non c'è
conversione automatica FJT/ETH né una promessa di autofinanziamento.

Il player non allega ETH alle azioni per pagare VRF; paga il normale gas delle
proprie transazioni, inclusa l'eventuale elaborazione. Pagare l'oracolo non
sponsorizza il gas delle transazioni inviate dal wallet.

Il limite ETH per richiesta è immutabile e scelto al deploy. All'avvio viene
prenotato un budget conservativo di **12 richieste al costo massimo**: quattro
carte iniziali, fino a dieci Hit e una fase dealer. Una mano non bust ha al
massimo 11 carte (le 12 carte più piccole sommano almeno 24), quindi il budget
copre tutte le sequenze ammesse. Ogni pagamento riduce il saldo e il budget
prenotato; il residuo viene liberato alla chiusura. Nuove partite non possono
consumare i fondi prenotati a quelle attive.

Se il wrapper rifiuta la richiesta o il prezzo supera il limite, una nuova
partita torna indietro senza incassare la puntata. Per una partita esistente
l'azione rimane registrata e in attesa, senza penalizzare il player. Chiunque
può chiamare `requestPendingRandomness(gameId)` quando il servizio è nuovamente
disponibile: invia la **prima** richiesta di quell'azione, senza sostituire una
richiesta già esistente. Aumenti di prezzo oltre il limite possono prolungare
l'attesa anche se il budget è stato prenotato.

## Timeout e limiti

`claimTimeout(gameId)` è permissionless e funziona esclusivamente durante
`PlayerTurn`, dopo i cinque minuti: il player perde la puntata. Il tempo è
sospeso mentre una richiesta è differita, attesa o pronta da elaborare.
Non esistono annullamenti, rimborsi per timeout dell'oracolo o re-roll: un
risultato sfavorevole non può essere scartato. Una mancata consegna permanente
può quindi mantenere bloccati puntata e fondi riservati.

È un prototipo: FJT è liberamente mintabile e non rappresenta valore reale.
Una riserva ETH su una rete reale può essere consumata da utenti che creano
puntate in token gratuiti; i massimali non rendono sostenibile questa economia.
Le regole del gioco e il margine atteso devono essere valutati prima di usare
capitale reale. Le carte iniziali del dealer sono pubbliche: VRF non fornisce
una carta coperta. Il mock locale non offre alcuna garanzia crittografica.

## Avvio locale

Prerequisiti: Node.js 22.13+ e un wallet EIP-1193.

```bash
npm ci
npm --prefix frontend ci
```

Tre terminali dalla root:

```bash
npm run node
```

```bash
npm run deploy:local
```

```bash
npm run frontend
```

Il deploy crea token, **MockVRFWrapper solo su Hardhat Local**, pool e una riserva
iniziale di 0.5 ETH di test. Scrive gli indirizzi in `frontend/.env.local`.
La rete locale ha chain ID `31337` e RPC `http://127.0.0.1:8545`.

Per il collaudo bastano due account locali, staker e player:

1. Mint e allowance FJT; deposita ad esempio 1.000 FJT nella house pool.
2. Controlla la riserva nel pannello oracolo: il deploy locale la finanzia già.
3. Crea una partita da 25 FJT senza allegare ETH per VRF.
4. Premi **Simula risposta (locale)** e poi **Elabora carte**. I risultati
   del mock sono arbitrari e la simulazione è disponibile solo sulla rete locale.
5. Hit ripete richiesta/risposta/elaborazione per una sola carta. Dopo Stand,
   ripeti se il dealer deve pescare; altrimenti il payout è immediato.
6. Per il timeout resta nel turno player, usa **Supera deadline (locale)**,
   poi **Claim timeout**. Non si può reclamare durante l'attesa dell'oracolo.

Il frontend aggiorna automaticamente lo stato della partita. L'elaborazione
resta una transazione esplicita, inviabile da qualsiasi account o da un keeper.

## Nuovo deploy su Ethereum Sepolia

Questa versione cambia costruttore, ABI e stato: **serve un nuovo deploy**.
Gli indirizzi precedenti sono riportati solo come
[deploy storico OBSOLETO](docs/deployments/sepolia-legacy.md), non come indirizzi
attuali da copiare.
I vecchi indirizzi del protocollo commit/reveal non sono compatibili. I contratti
precedenti non sono aggiornabili: prima di abbandonarli occorre gestire le
partite e i prelievi attraverso le loro funzioni esistenti.

```bash
npx hardhat keystore set SEPOLIA_RPC_URL
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
```

Configura valori non segreti nell'ambiente della shell. `.env.example` documenta
i parametri; lo script legge `process.env` e non carica automaticamente quel file.

```bash
export SEPOLIA_PUBLIC_RPC_URL="https://ethereum-sepolia-rpc.publicnode.com"
export VRF_WRAPPER_ADDRESS="0x195f15F2d49d693cE265b4fB0fdDbE15b1850Cc1"
export VRF_MAX_REQUEST_COST_ETH="0.005"
export ORACLE_RESERVE_ETH="0.1"
npm run deploy:sepolia
```

Dopo il deploy controlla l'intestazione di `frontend/.env.local`: deve indicare
**FairJack VRF**, **Sepolia** e chain ID **11155111**. Salva una copia di questa
configurazione prima di fare un deploy locale, che sovrascrive lo stesso file.
Riavvia Vite dopo aver cambiato configurazione.

`ORACLE_RESERVE_ETH` è un contributo iniziale opzionale del deployer (default
Sepolia: zero). Senza saldo sufficiente chiunque può finanziare la pool dopo il
deploy dal frontend. Con limite 0.005 ETH il budget per nuova partita è 0.06 ETH.
Il limite è un tetto, non una previsione del prezzo effettivo.

Su Sepolia lo script usa il wrapper Chainlink esistente e **non distribuisce il
mock**. Non serve una subscription propria o un account gestore. Attendi la
callback Chainlink e poi elabora il risultato; non esiste simulazione su Sepolia.
I parametri, i prezzi e gli indirizzi ufficiali sono documentati da Chainlink:

- [Direct funding VRF v2.5](https://docs.chain.link/vrf/v2-5/overview/direct-funding)
- [Reti supportate e wrapper](https://docs.chain.link/vrf/v2-5/supported-networks)
- [Sicurezza delle richieste](https://docs.chain.link/vrf/v2-5/security)

## Verifiche e ABI

```bash
npm test
npm run abi:sync
npx tsc --noEmit
npm run frontend:build
npm --prefix frontend run lint
```

`abi:sync` rigenera `frontend/src/contracts/abis.ts` dagli artefatti compilati,
così costruttore, errori e getter del frontend corrispondono ai contratti.
La suite include il wrapper ufficiale Chainlink con coordinator mock e copre pagamenti native dalla pool, prenotazioni concorrenti, risposte
fuori ordine, autenticazione della callback, risposta zero, elaborazione unica,
richieste differite, Hit/Stand, timeout, carte e contabilità dei payout.

L'integrazione non costituisce un audit di sicurezza. `npm audit` continua a
segnalare advisory nel toolchain e in dipendenze transitive, incluse librerie
legacy distribuite dal pacchetto Chainlink. Non sono stati applicati override
forzati delle librerie Solidity o aggiornamenti generali del toolchain.
