# FairJack

FairJack è un prototipo di blackjack decentralizzato su Ethereum.

## FairJack v1

La versione include:

- blackjack semplificato;
- ERC20 token di test;
- Staked House Pool;
- shares per gli staker;
- validator con collateral;
- commit-reveal;
- timeout/slashing base;
- hit/stand;
- dealer automatico;
- payout automatico;
- frontend minimale.

## Deadline, penalità e slashing

Ogni fase che richiede un'azione esterna ha una scadenza on-chain:

- 15 minuti per raccogliere i commit;
- 15 minuti per raccogliere i reveal;
- 5 minuti per ogni decisione `hit` o `stand` del player. Un `hit` valido
  rinnova questa scadenza.

Dopo la scadenza chiunque può chiamare `claimTimeout(gameId)`. Un validator
che non invia il commit o trattiene il reveal perde i 100 token di collateral
riservati alla partita; la puntata viene rimborsata al player se il player ha
rispettato i propri obblighi. Un player che non invia commit/reveal o non
decide in tempo perde invece l'intera puntata. Le somme confiscate entrano nel
bilancio dell'house pool e tutte le risorse riservate alla partita vengono
rilasciate una sola volta.

## Struttura

- `contracts/`: smart contract Solidity
- `test/`: test Hardhat
- `scripts/`: script di deploy
- `frontend/`: frontend React + Vite + TypeScript

## Avvio locale completo

Prerequisiti: Node.js 22+, npm e un wallet browser EIP-1193 (per esempio MetaMask).

Installa una volta le dipendenze:

```bash
npm install
npm --prefix frontend install
```

Poi usa tre terminali, tutti dalla root del progetto.

Terminale 1 — nodo locale (deve restare aperto):

```bash
npm run node
```

Terminale 2 — deploy. Il comando crea anche `frontend/.env.local` con indirizzi, chain ID e RPC:

```bash
npm run deploy:local
```

Terminale 3 — frontend:

```bash
npm run frontend
```

Apri l'indirizzo mostrato da Vite, normalmente `http://localhost:5173`. Nel wallet aggiungi/seleziona la rete **Hardhat Local** con RPC `http://127.0.0.1:8545`, chain ID `31337` e simbolo `ETH`. Il pulsante nel frontend prova ad aggiungerla automaticamente.

Importa almeno quattro account usando le chiavi private stampate da `npm run node`. Sono chiavi pubbliche di test: non usarle mai su una rete reale. Un account farà da staker/player e tre account da validator; usarne cinque rende i ruoli più chiari.

### Collaudo completo dal browser

1. Su ogni account necessario usa **Mint** per creare FJT e **Allowance massima** (oppure un'allowance esatta).
2. Con lo staker deposita, per esempio, 1.000 FJT nell'house pool. Verifica anche un deposito successivo e un ritiro di share.
3. Con tre account diversi registra tre validator con 200 FJT di collateral. Prova anche aggiunta e ritiro del collateral; la disiscrizione funziona solo senza partite attive.
4. Con un account diverso dai validator crea una partita da 25 FJT. Il pool deve avere almeno 50 FJT di liquidità disponibile.
5. Nella partita genera e invia il commit del player. Cambia account nel wallet e ripeti per ciascuno dei tre validator indicati dal pannello. Il segreto è conservato automaticamente nel browser per l'account corrente.
6. Dopo il quarto commit inizia il reveal. Ripassa sui quattro account ed esegui ogni reveal. Dopo l'ultimo compaiono due mani da due carte.
7. Dal player usa **Hit** una o più volte oppure **Stand**. Stand risolve automaticamente il dealer e mostra esito/payout; il bust dopo Hit chiude subito la partita.
8. Crea partite separate per i timeout. Ometti il commit o il reveal del soggetto che vuoi penalizzare, premi **Supera deadline (locale)** e poi **Claim timeout** da qualunque account. Per il timeout del turno player completa commit/reveal, non giocare, supera la deadline e reclama.
9. Verifica i casi di errore direttamente dalla UI: bet sotto 1 o sopra 100, allowance insufficiente, meno di tre validator idonei, ritiro di liquidità bloccata, commit/reveal dall'account sbagliato e claim timeout prima della deadline.

Per ripartire da zero interrompi il nodo, riavvialo e ripeti deploy e frontend. Se MetaMask conserva nonce/stato della chain precedente, usa “Cancella attività e dati delle schede” nelle impostazioni avanzate del wallet oppure rimuovi e riaggiungi la rete locale.

## Deploy su Sepolia

### Deploy ufficiale

La versione corrente è distribuita su **Ethereum Sepolia** (chain ID `11155111`):

| Contratto | Indirizzo |
| --- | --- |
| MockERC20 | [`0x8D95D8fB19f295fD08Bb10264C9cafe5bB7d9EC0`](https://sepolia.etherscan.io/address/0x8D95D8fB19f295fD08Bb10264C9cafe5bB7d9EC0) |
| FairJackPool | [`0x083d6c4402A5D9fAdfD6Bc99d0f6c4DE265aa6D0`](https://sepolia.etherscan.io/address/0x083d6c4402A5D9fAdfD6Bc99d0f6c4DE265aa6D0) |

Per usare il deploy ufficiale senza distribuire nuovi contratti, copia la configurazione di esempio:

```bash
cp frontend/.env.example frontend/.env.local
```

Configura `frontend/.env.local` in questo modo:

```dotenv
VITE_TOKEN_ADDRESS=0x8D95D8fB19f295fD08Bb10264C9cafe5bB7d9EC0
VITE_POOL_ADDRESS=0x083d6c4402A5D9fAdfD6Bc99d0f6c4DE265aa6D0
VITE_CHAIN_ID=11155111
VITE_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
VITE_NETWORK_NAME=Sepolia
VITE_NATIVE_CURRENCY_NAME=Sepolia Ether
VITE_NATIVE_CURRENCY_SYMBOL=ETH
VITE_BLOCK_EXPLORER_URL=https://sepolia.etherscan.io
```

Installa le dipendenze e avvia il frontend dalla root del progetto:

```bash
npm install
npm --prefix frontend install
npm run frontend
```

Apri l'indirizzo mostrato da Vite, normalmente `http://localhost:5173`, connetti il wallet e seleziona Sepolia. Gli account che inviano transazioni devono avere Sepolia ETH per il gas.

### Nuovo deploy

Il deploy Sepolia usa due configurazioni distinte:

- `SEPOLIA_RPC_URL` e `SEPOLIA_PRIVATE_KEY` restano lato Hardhat e non devono essere pubblicate;
- `SEPOLIA_PUBLIC_RPC_URL` viene scritto nel bundle del frontend e deve quindi essere un endpoint browser-safe, senza credenziali riservate.

Salva RPC privato e chiave del deployer nel keystore cifrato di Hardhat:

```bash
npx hardhat keystore set SEPOLIA_RPC_URL
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
```

Il deployer deve avere Sepolia ETH. Configura poi l'RPC pubblico per la sola sessione corrente ed esegui il deploy:

```bash
export SEPOLIA_PUBLIC_RPC_URL="https://endpoint-sepolia-browser-safe"
npm run deploy:sepolia
npm run frontend
```

Lo script verifica il chain ID `11155111`, distribuisce `MockERC20` e `FairJackPool` e genera `frontend/.env.local` con indirizzi e metadati della rete. Il file è ignorato da Git.

Per collaudare una partita servono almeno quattro account con Sepolia ETH: un player e tre validator distinti. Il token FJT è liberamente mintabile perché è un token didattico. Su Sepolia il tempo non può essere avanzato artificialmente: i test di timeout richiedono di attendere realmente le deadline on-chain di 5 o 15 minuti.

## Comandi principali

Compilazione contratti:

```bash
npm install
npx hardhat compile
```

Avvio frontend:

```bash
cd frontend
npm install
npm run dev
```

Test e build completi:

```bash
npm test
npm run frontend:build
```
