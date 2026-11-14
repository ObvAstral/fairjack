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

Prerequisiti: Node.js 22.22+ e un wallet EIP-1193 con firme EIP-712.

```bash
npm ci
npm --prefix frontend ci
```

Avvia il nodo dalla root:

```bash
npm run node
```

```bash
npm run deploy:local
```

Poi lascia attivi backend e frontend in due terminali separati:

```bash
npm run relayer:dev
```

```bash
npm run frontend
```

Il deploy crea token, **MockVRFWrapper solo su Hardhat Local**, pool e una riserva
iniziale di 0.5 ETH di test. Scrive gli indirizzi in `frontend/.env.local` e
`relayer/deployment.json`. **Le sessioni richiedono questo nuovo deploy**: la
precedente versione VRF non espone le nuove funzioni.
La rete locale ha chain ID `31337` e RPC `http://127.0.0.1:8545`.

Per il collaudo bastano due account locali, staker e player:

1. Mint e allowance FJT; deposita ad esempio 1.000 FJT nella house pool.
2. Controlla la riserva nel pannello oracolo: il deploy locale la finanzia già.
3. Con il player, mint FJT e apri una **sessione di gioco**: default 30 minuti,
   budget totale 100 FJT, puntata massima 25 FJT. Se manca allowance, conferma
   prima un approve finito (gas a tuo carico), poi firma la sessione.
4. Crea una partita da 25 FJT. Il **dealer** simula la risposta del mock ed
   elabora le carte automaticamente. Il mock resta privo di garanzie crittografiche.
5. Hit e Stand usano la chiave temporanea della sessione, senza popup. Il dealer
   segue ogni nuova richiesta fino alla distribuzione o al payout.
6. Per il timeout resta nel turno player e usa **Supera deadline (locale)**:
   il dealer liquida la mano. In modalità wallet usa **Claim timeout**.
   Non si può reclamare durante l'attesa dell'oracolo.

Il frontend aggiorna lo stato della partita. Il dealer paga le transazioni di
elaborazione e può reclamare un timeout già maturato per le partite che segue.
In **Modalità wallet** restano disponibili conferme manuali, simulazione locale
e pulsante Elabora carte. Questa modalità serve anche se il backend è offline.

## Sessioni, relayer e dealer

La sessione autorizza esclusivamente **nuova partita, Hit e Stand**. Il contratto
verifica firme EIP-712, nonce, scadenza, proprietà della partita e budget; non
si affida alla sola validazione del server. La chiave temporanea non può cambiare
allowance, prelevare share o trasferire liberamente token. Le vincite arrivano
all'indirizzo del player, non al relayer.

Una nuova sessione sostituisce la precedente. Il budget misura la somma delle
puntate accettate, anche in caso di vincita: non è un limite alla perdita netta.
Il budget esaurito impedisce nuove puntate ma consente di completare le mani già
finanziate fino alla scadenza. Dopo scadenza o refresh, firma una nuova sessione
e apri l'ID della partita esistente per riprenderla. La chiave resta soltanto
in memoria; non viene inviata al backend né salvata nel browser.

**Revoca dal wallet** resta disponibile anche con un invio pendente o il relayer
offline: è una transazione del player e il gas è a suo carico. Le funzioni
dirette del contratto restano accessibili dal wallet principale. Se una risposta
HTTP si perde, usa **Verifica operazione**: viene recuperata la richiesta già
firmata, senza generare un'altra puntata.

Il backend TypeScript usa Fastify e SQLite (`node:sqlite`), registra le transazioni
firmate prima del broadcast e le riconcilia dopo un riavvio. API sotto `/api`:
`GET /config`, `POST /sessions`, `POST /actions`, `GET /operations/:id`.
I payload firmati sono definiti in `shared/sessions.ts`; importi e nonce sono
stringhe intere in unità base. Le risposte pubbliche non includono transazioni
raw, payload firmati o chiavi. Il frontend usa il proxy Vite in sviluppo.

Il **dealer** è il componente del backend che elabora le risposte VRF, ritenta
le richieste differite con backoff e liquida i timeout maturati. Segue soltanto
le partite create attraverso il relayer e persistite nel database; non sceglie
Hit/Stand, non sostituisce richieste VRF e continua l'elaborazione dopo la
scadenza di una sessione. Su Hardhat il mock è automatico per default dopo un
deploy locale; `DEALER_AUTO_FULFILL=false` consente il collaudo manuale.
La simulazione automatica è rifiutata su reti pubbliche.

Localmente il gas payer è l'account **19** standard di Hardhat, separato da
deployer e player. Se usi account locali personalizzati, configura una chiave
dedicata in `relayer/.env`. Il budget gas locale predefinito è 1 ETH/giorno;
non comprende i pagamenti VRF, che continuano a provenire dalla riserva della pool.

Se la chain viene ripristinata o cambia deploy, il backend interrompe gli invii
invece di riprodurre vecchi job: esegui il nuovo deploy, riavvia il relayer e
ricarica il frontend. Conserva `relayer/data/relay.sqlite` e i relativi file WAL
tra normali riavvii del servizio. Non avviare più istanze con lo stesso gas payer.

### Backend su Sepolia e hosting del sito

Copia `relayer/.env.example` in `relayer/.env`. Configura **sul server** RPC,
chain ID 11155111, pool del nuovo deploy e `RELAYER_PRIVATE_KEY` di un account
dedicato finanziato con ETH Sepolia. Imposta esplicitamente
`RELAYER_MAX_GAS_PER_TX`, `RELAYER_MAX_FEE_GWEI` e `RELAYER_DAILY_BUDGET_ETH`.
La chiave non deve comparire in variabili `VITE_*` né essere usata da altri
processi che inviano transazioni. Sono applicati limiti per IP/account, budget
per sessione e tetto giornaliero del gas, persistente nel database.

```bash
npm run frontend:build
npm run relayer:build
npm run relayer:start
```

Il backend serve anche `frontend/dist`. In produzione esponilo dietro HTTPS
con una sola istanza, storage persistente e `RELAYER_ALLOWED_ORIGIN` uguale
all'origine pubblica del sito. Usa `RELAYER_HOST=0.0.0.0` se richiesto dall'hosting.
Configura `RELAYER_TRUST_PROXY` con gli IP/CIDR dei tuoi reverse proxy, separati
da virgole, per applicare il rate limit all'IP reale del client.
Il saldo e il limite giornaliero del relayer sono separati dalla riserva VRF.
Le attese della blockchain e di Chainlink restano visibili nel tavolo.

### Nonce del wallet dopo un riavvio locale

Riavviare `npm run node` azzera la chain locale, ma il wallet può conservare i
nonce delle transazioni precedenti. Per esempio, `Expected nonce to be 4 but
got 10` significa che la chain attende il nonce 4 e il wallet sta usando 10.
Con automining Hardhat rifiuta questo salto.

Su chain ID 31337 il frontend legge il nonce `pending` via RPC prima di ogni
invio e lo propone esplicitamente ai wallet che lo accettano. Gli invii dei
pannelli condividono una coda per evitare di usare contemporaneamente lo stesso
nonce. Il contatore viene riletto anche dopo un rifiuto o un reset della chain.
Su Sepolia la gestione del nonce resta affidata al wallet.

**MetaMask gestisce autonomamente il nonce e può ignorare quello proposto
dall'app**: il frontend non può cancellarne la cronologia. Se si verifica
l'errore, mostra il nonce atteso, quello ricevuto e le istruzioni di recupero.
Seleziona **Hardhat Local** e l'account di test interessato nel wallet, poi usa
**Settings → Developer tools → Delete activity and nonce data** in MetaMask
Extension (nelle versioni precedenti: **Settings → Advanced → Clear activity
and nonce data**). Questa operazione cancella la cronologia locale del wallet
per la rete selezionata; i dettagli sono nella
[guida ufficiale MetaMask](https://support.metamask.io/configure/accounts/how-to-clear-your-account-activity-reset-account).

Se hai riavviato il nodo, esegui nuovamente `npm run deploy:local` e ripeti mint,
allowance e deposito: anche contratti e saldi della chain precedente sono stati
azzerati. Ricaricare la pagina o riconnettere il wallet da solo non cancella la
sua cronologia dei nonce.

## Nuovo deploy su Ethereum Sepolia

Questa versione cambia ABI e stato: **serve un nuovo deploy**.
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
callback Chainlink: il dealer elabora il risultato; non esiste simulazione su Sepolia.
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
npm run relayer:build
npm run relayer:test
npm --prefix frontend run lint
```

`abi:sync` rigenera `frontend/src/contracts/abis.ts` dagli artefatti compilati,
così costruttore, errori e getter del frontend corrispondono ai contratti.
La suite include il wrapper ufficiale Chainlink con coordinator mock e copre pagamenti native dalla pool, prenotazioni concorrenti, risposte
fuori ordine, autenticazione della callback, risposta zero, elaborazione unica,
richieste differite, Hit/Stand, timeout, carte e contabilità dei payout.
I test delle sessioni coprono replay, limiti, revoca, firme ERC-1271 e rinnovo.
Quelli relayer/dealer usano la chain Hardhat reale e lo stesso client del
frontend: più partite con una sola firma iniziale, duplicati concorrenti,
risposte HTTP perse, recupero da SQLite, richieste differite e reset della chain.

L'integrazione non costituisce un audit di sicurezza. `npm audit` continua a
segnalare advisory nel toolchain e in dipendenze transitive, incluse librerie
legacy distribuite dal pacchetto Chainlink. Non sono stati applicati override
forzati delle librerie Solidity o aggiornamenti generali del toolchain.
